'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const blacklistService = require('../../utils/blacklist');
const config = require('../../config.json');

module.exports = {
  name: "blacklist",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Permanently block a user or guild from using any bot commands.')
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('The Discord user ID to blacklist')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('guildid')
        .setDescription('The Discord guild ID to blacklist')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for blacklisting')
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
            .setDescription('You need **Administrator** permission to blacklist users or guilds.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.options.getString('userid')?.trim();
    const guildId = interaction.options.getString('guildid')?.trim();
    const reason = interaction.options.getString('reason') || 'No reason provided';

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
      .setColor(config.errorColor || '#ED4245')
      .setTitle('🔒 Blacklist System')
      .setTimestamp();

    const results = [];

    // Process User blacklist
    if (userId) {
      if (userId === interaction.user.id) {
        results.push(`❌ **User (${userId})**: You cannot blacklist yourself.`);
      } else if (isOwner(userId)) {
        results.push(`❌ **User (${userId})**: Bot owners cannot be blacklisted.`);
      } else if (blacklistService.isBlacklisted({ type: 'user', id: userId })) {
        results.push(`⚠️ **User (${userId})**: Already blacklisted.`);
      } else {
        const added = blacklistService.addBlacklist({
          type: 'user',
          id: userId,
          reason,
          addedBy: interaction.user.id
        });
        if (added) {
          let tag = '*Unknown User*';
          try {
            const user = await interaction.client.users.fetch(userId);
            tag = user.globalName || user.username;
          } catch {}
          results.push(`✅ **User**: ${tag} (\`${userId}\`) has been blacklisted.`);
        } else {
          results.push(`❌ **User (${userId})**: Failed to add user to blacklist.`);
        }
      }
    }

    // Process Guild blacklist
    if (guildId) {
      if (blacklistService.isBlacklisted({ type: 'guild', id: guildId })) {
        results.push(`⚠️ **Guild (${guildId})**: Already blacklisted.`);
      } else {
        const added = blacklistService.addBlacklist({
          type: 'guild',
          id: guildId,
          reason,
          addedBy: interaction.user.id
        });
        if (added) {
          let guildName = '*Unknown Guild*';
          try {
            const guild = await interaction.client.guilds.fetch(guildId);
            guildName = guild.name;
          } catch {}
          results.push(`✅ **Guild**: ${guildName} (\`${guildId}\`) has been blacklisted.`);
        } else {
          results.push(`❌ **Guild (${guildId})**: Failed to add guild to blacklist.`);
        }
      }
    }

    embed.setDescription(results.join('\n'));
    embed.addFields({ name: 'Reason', value: reason });

    return interaction.editReply({ embeds: [embed] });
  },
};
