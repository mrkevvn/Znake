'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isStaff } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const config = require('../../config.json');

module.exports = {
  name: "massban",
  category: "moderation",
  default_member_permissions: "BanMembers",
  data: new SlashCommandBuilder()
    .setName('massban')
    .setDescription('Ban multiple users at once by pasting their IDs.')
    .addStringOption(opt =>
      opt.setName('userids')
        .setDescription('Space or comma-separated list of user IDs to ban')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for the mass ban')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('days')
        .setDescription('Days of messages to delete per user (0-7, default 0)')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  cooldown: 10,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id) && !isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need a staff role to use mass ban.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const rawIds = interaction.options.getString('userids');
    const reason = interaction.options.getString('reason') || 'Mass ban — no reason provided';
    const days = interaction.options.getInteger('days') ?? 0;

    // Parse IDs — split on spaces, commas, newlines, and strip non-numeric chars
    const ids = [...new Set(
      rawIds.split(/[\s,]+/)
        .map(id => id.replace(/\D/g, '').trim())
        .filter(id => id.length >= 17 && id.length <= 19)
    )];

    if (ids.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ No Valid IDs')
            .setDescription('No valid Discord user IDs were found in your input.\nIDs are 17–19 digit numbers.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Remove self and bot from the list silently
    const safeIds = ids.filter(id => id !== interaction.user.id && id !== interaction.guild.members.me.id);
    const skippedSelf = ids.length - safeIds.length;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('massban_confirm')
        .setLabel(`Ban ${safeIds.length} user${safeIds.length !== 1 ? 's' : ''}`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('massban_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('⚠️ Confirm Mass Ban')
          .addFields(
            { name: 'Users to ban', value: `${safeIds.length}`, inline: true },
            { name: 'Message deletion', value: `${days} day${days !== 1 ? 's' : ''}`, inline: true },
            { name: 'Reason', value: reason, inline: false },
            { name: 'IDs', value: `\`\`\`${safeIds.slice(0, 20).join(', ')}${safeIds.length > 20 ? `… (+${safeIds.length - 20} more)` : ''}\`\`\``, inline: false }
          )
          .setFooter({ text: `${skippedSelf > 0 ? `${skippedSelf} ID(s) skipped (self/bot). ` : ''}This prompt expires in 30 seconds.` })
          .setTimestamp(),
      ],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    const filter = i =>
      i.user.id === interaction.user.id &&
      ['massban_confirm', 'massban_cancel'].includes(i.customId);

    let btn;
    try {
      btn = await interaction.channel.awaitMessageComponent({ filter, time: 30_000 });
    } catch {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle('⏱️ Timed Out')
            .setDescription('Mass ban cancelled — no response within 30 seconds.')
            .setTimestamp(),
        ],
        components: [],
      });
    }

    if (btn.customId === 'massban_cancel') {
      return btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle('🚫 Cancelled')
            .setDescription('Mass ban was cancelled. No users were banned.')
            .setTimestamp(),
        ],
        components: [],
      });
    }

    await btn.update({
      embeds: [
        new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('🔨 Banning...')
          .setDescription(`Banning **${safeIds.length}** users. Please wait.`)
          .setTimestamp(),
      ],
      components: [],
    });

    let banned = 0;
    let failed = 0;
    const failedIds = [];

    for (const userId of safeIds) {
      try {
        await interaction.guild.bans.create(userId, {
          deleteMessageSeconds: days * 86400,
          reason: `[Mass Ban] ${interaction.user.username}: ${reason}`,
        });
        banned++;

        // Log each ban individually
        try {
          const user = await interaction.client.users.fetch(userId);
          await logModerationAction(interaction.client, interaction.guild, 'BAN', user, interaction.user, `[Mass Ban] ${reason}`);
        } catch { /* user fetch failed, skip log */ }
      } catch {
        failed++;
        failedIds.push(userId);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(banned > 0 ? config.successColor : config.errorColor)
      .setTitle('🔨 Mass Ban Complete')
      .addFields(
        { name: '✅ Banned', value: `${banned} user${banned !== 1 ? 's' : ''}`, inline: true },
        { name: '❌ Failed', value: `${failed} user${failed !== 1 ? 's' : ''}`, inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setTimestamp();

    if (failedIds.length > 0) {
      embed.addFields({
        name: 'Failed IDs',
        value: `\`\`\`${failedIds.slice(0, 10).join(', ')}${failedIds.length > 10 ? `… (+${failedIds.length - 10} more)` : ''}\`\`\``,
      });
    }

    return interaction.editReply({ embeds: [embed], components: [] });
  },
};
