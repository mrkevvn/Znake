'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "watchlist",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage the staff watchlist — flagged users are reported when they send messages.')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a user to the watchlist.')
        .addUserOption(opt => opt.setName('user').setDescription('The user to watch').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for watching').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send alerts to (defaults to mod log)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a user from the watchlist.')
        .addUserOption(opt => opt.setName('user').setDescription('The user to unwatch').setRequired(false))
        .addStringOption(opt => opt.setName('userid').setDescription('User ID (if not in server)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('View all users currently on the watchlist.')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id) && !isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need a staff role to manage the watchlist.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const data = db.read('watchlist');
    if (!data[guildId]) data[guildId] = {};

    // ── ADD ───────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const alertChannel = interaction.options.getChannel('channel');

      const logChannels = db.getGuild('log_channels', guildId);
      const alertChannelId = alertChannel?.id || logChannels.moderation || null;

      data[guildId][target.id] = {
        reason,
        addedBy: interaction.user.id,
        addedByTag: interaction.user.globalName || interaction.user.username,
        addedAt: Date.now(),
        alertChannelId,
      };
      db.write('watchlist', data);

      const tag = target.globalName || target.username;
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('👁️ User Added to Watchlist')
            .addFields(
              { name: 'User', value: `${tag} (<@${target.id}>)`, inline: true },
              { name: 'Reason', value: reason, inline: false },
              { name: 'Alert Channel', value: alertChannelId ? `<#${alertChannelId}>` : 'None configured', inline: true },
              { name: 'Added by', value: `${interaction.user}`, inline: true }
            )
            .setFooter({ text: 'Staff will be alerted whenever this user sends a message.' })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── REMOVE ────────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('userid')?.trim();

      if (!user && !rawId) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ No Target').setDescription('Provide a user or user ID.').setTimestamp()],
        });
      }

      if (!user) {
        try { user = await interaction.client.users.fetch(rawId); }
        catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ User Not Found').setDescription(`Could not find user \`${rawId}\`.`).setTimestamp()] }); }
      }

      if (!data[guildId][user.id]) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('⚠️ Not on Watchlist').setDescription('That user is not currently being watched.').setTimestamp()],
        });
      }

      delete data[guildId][user.id];
      db.write('watchlist', data);

      const tag = user.globalName || user.username;
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('✅ Removed from Watchlist')
            .setDescription(`**${tag}** is no longer being watched.`)
            .addFields({ name: 'Removed by', value: `${interaction.user}`, inline: true })
            .setTimestamp(),
        ],
      });
    }

    // ── LIST ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const entries = Object.entries(data[guildId] || {});

      if (entries.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('👁️ Watchlist')
              .setDescription('No users are currently being watched.')
              .setTimestamp(),
          ],
        });
      }

      const lines = [];
      for (const [userId, entry] of entries) {
        let tag = '*Unknown User*';
        try {
          const u = await interaction.client.users.fetch(userId);
          tag = u.globalName || u.username;
        } catch { /* not on Discord */ }

        const ts = entry.addedAt ? `<t:${Math.floor(entry.addedAt / 1000)}:R>` : 'Unknown';
        lines.push(
          `**${tag}** (\`${userId}\`)\n` +
          `> Reason: ${entry.reason}\n` +
          `> Added by: **${entry.addedByTag || 'Unknown'}** • ${ts}\n` +
          `> Alert channel: ${entry.alertChannelId ? `<#${entry.alertChannelId}>` : 'None'}`
        );
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('👁️ Watchlist')
            .setDescription(lines.join('\n\n'))
            .addFields({ name: 'Total', value: `${entries.length} user${entries.length !== 1 ? 's' : ''}`, inline: true })
            .setTimestamp(),
        ],
      });
    }
  },
};
