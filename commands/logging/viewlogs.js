// /viewlogs - Shows all configured log channels
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "viewlogs",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('viewlogs')
    .setDescription('View all configured log channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  cooldown: 5,

  async execute(interaction) {
    const logChannels = db.getGuild('log_channels', interaction.guild.id);

    const logTypes = {
      moderation: '🔨 Moderation',
      joinLeave: '📥 Join/Leave',
      staffDm: '📨 Staff DMs',
      errors: '🚨 Errors',
    };

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('📋 Log Channel Configuration')
      .setTimestamp();

    for (const [key, label] of Object.entries(logTypes)) {
      const channelId = logChannels[key];
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
      embed.addFields({
        name: label,
        value: channel ? channel.toString() : '`Not configured`',
        inline: true,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
