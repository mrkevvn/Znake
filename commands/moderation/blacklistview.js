'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const blacklistService = require('../../utils/blacklist');
const config = require('../../config.json');

module.exports = {
  name: "blacklistview",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('blacklistview')
    .setDescription('View all users and servers currently blacklisted from using bot commands.'),
  cooldown: 5,

  async execute(interaction) {
    const hasPerms = isOwner(interaction.user.id) ||
      interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPerms) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor || '#ED4245')
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need **Administrator** permission to view the blacklist.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const blacklistData = blacklistService.getBlacklistData();
    const userEntries = Object.entries(blacklistData.users || {});
    const guildEntries = Object.entries(blacklistData.guilds || {});

    const embed = new EmbedBuilder()
      .setColor(config.errorColor || '#ED4245')
      .setTitle('🔒 Blacklist Database')
      .setTimestamp();

    // 1. Blacklisted Users Section
    const userLines = [];
    for (const [userId, entry] of userEntries) {
      let tag = '*Unknown User*';
      try {
        const user = await interaction.client.users.fetch(userId);
        tag = user.globalName || user.username;
      } catch {}

      const ts = entry.addedAt ? `<t:${Math.floor(entry.addedAt / 1000)}:R>` : 'Unknown';
      const addedByTag = entry.addedBy ? `<@${entry.addedBy}>` : 'Unknown';

      userLines.push(
        `**${tag}** (\`${userId}\`)\n` +
        `> **Reason**: ${entry.reason || 'No reason provided'}\n` +
        `> **Added by**: ${addedByTag} • ${ts}`
      );
    }

    // 2. Blacklisted Servers Section
    const guildLines = [];
    for (const [guildId, entry] of guildEntries) {
      let guildName = '*Unknown Guild*';
      try {
        const guild = await interaction.client.guilds.fetch(guildId);
        guildName = guild.name;
      } catch {}

      const ts = entry.addedAt ? `<t:${Math.floor(entry.addedAt / 1000)}:R>` : 'Unknown';
      const addedByTag = entry.addedBy ? `<@${entry.addedBy}>` : 'Unknown';

      guildLines.push(
        `**${guildName}** (\`${guildId}\`)\n` +
        `> **Reason**: ${entry.reason || 'No reason provided'}\n` +
        `> **Added by**: ${addedByTag} • ${ts}`
      );
    }

    embed.addFields(
      {
        name: `👤 Blacklisted Users (${userEntries.length})`,
        value: userLines.length > 0 ? userLines.slice(0, 10).join('\n\n') : 'No users are currently blacklisted.',
        inline: false
      },
      {
        name: `🏰 Blacklisted Servers (${guildEntries.length})`,
        value: guildLines.length > 0 ? guildLines.slice(0, 10).join('\n\n') : 'No servers are currently blacklisted.',
        inline: false
      }
    );

    return interaction.editReply({ embeds: [embed] });
  },
};
