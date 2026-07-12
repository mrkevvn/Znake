'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const blacklistService = require('../../utils/blacklist');
const config = require('../../config.json');

module.exports = {
  name: "blacklistremove",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('blacklistremove')
    .setDescription('Remove a user or guild from the blacklist, restoring access to bot commands.')
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('The Discord user ID to unblacklist')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('guildid')
        .setDescription('The Discord guild ID to unblacklist')
        .setRequired(false)
    ),
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
            .setDescription('You need **Administrator** permission to manage the blacklist.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.options.getString('userid')?.trim();
    const guildId = interaction.options.getString('guildid')?.trim();

    if (!userId && !guildId) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor || '#ED4245')
            .setTitle('❌ Missing Parameter')
            .setDescription('You must provide at least a `userid` or a `guildid`.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder()
      .setColor(config.successColor || '#57F287')
      .setTitle('🔓 Blacklist System (Remove)')
      .setTimestamp();

    const results = [];

    // Process User remove
    if (userId) {
      if (!blacklistService.isBlacklisted({ type: 'user', id: userId })) {
        results.push(`⚠️ **User (${userId})**: Not currently blacklisted.`);
      } else {
        const removed = blacklistService.removeBlacklist({ type: 'user', id: userId });
        if (removed) {
          let tag = '*Unknown User*';
          try {
            const user = await interaction.client.users.fetch(userId);
            tag = user.globalName || user.username;
          } catch {}
          results.push(`✅ **User**: ${tag} (\`${userId}\`) has been unblacklisted.`);
        } else {
          results.push(`❌ **User (${userId})**: Failed to remove user from blacklist.`);
        }
      }
    }

    // Process Guild remove
    if (guildId) {
      if (!blacklistService.isBlacklisted({ type: 'guild', id: guildId })) {
        results.push(`⚠️ **Guild (${guildId})**: Not currently blacklisted.`);
      } else {
        const removed = blacklistService.removeBlacklist({ type: 'guild', id: guildId });
        if (removed) {
          let guildName = '*Unknown Guild*';
          try {
            const guild = await interaction.client.guilds.fetch(guildId);
            guildName = guild.name;
          } catch {}
          results.push(`✅ **Guild**: ${guildName} (\`${guildId}\`) has been unblacklisted.`);
        } else {
          results.push(`❌ **Guild (${guildId})**: Failed to remove guild from blacklist.`);
        }
      }
    }

    embed.setDescription(results.join('\n'));

    return interaction.editReply({ embeds: [embed] });
  },
};
