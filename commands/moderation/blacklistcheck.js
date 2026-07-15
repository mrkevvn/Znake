'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isBlacklisted, getBlacklistEntry } = require('../../utils/isBlacklisted');
const config = require('../../config.json');

module.exports = {
  name: "blacklistcheck",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('blacklistcheck')
    .setDescription('Check whether a specific user is blacklisted and see their entry details.')
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('The Discord user ID to check')
        .setRequired(true)
    ),
  cooldown: 5,

  async execute(interaction) {
    const hasPerms = isOwner(interaction.user.id) ||
      interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPerms) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need **Administrator** permission to check the blacklist.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.options.getString('userid').trim();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let tag = '*Unknown User*';
    try {
      const user = await interaction.client.users.fetch(userId);
      tag = user.globalName || user.username;
    } catch { /* user not on Discord */ }

    const blacklisted = isBlacklisted(userId);
    const entry = blacklisted ? getBlacklistEntry(userId) : null;

    const embed = new EmbedBuilder()
      .setColor(blacklisted ? config.errorColor : config.successColor)
      .setTitle('🔍 Blacklist Check')
      .addFields(
        { name: 'User', value: `${tag} (<@${userId}>)`, inline: false },
        { name: 'ID', value: `\`${userId}\``, inline: true },
        { name: 'Status', value: blacklisted ? '🔒 Blacklisted' : '✅ Not Blacklisted', inline: true }
      )
      .setTimestamp();

    if (blacklisted && entry) {
      embed.addFields(
        { name: 'Reason', value: entry.reason || 'No reason provided', inline: false },
        { name: 'Blacklisted by', value: entry.addedByTag || 'Unknown', inline: true },
        { name: 'Since', value: entry.addedAt ? `<t:${Math.floor(entry.addedAt / 1000)}:F> (<t:${Math.floor(entry.addedAt / 1000)}:R>)` : 'Unknown', inline: true }
      );
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
