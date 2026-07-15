// /antispam - Toggle the anti-spam system
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "antispam",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Toggle the anti-spam auto-moderation system')
    .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable anti-spam').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const enabled = interaction.options.getBoolean('enabled');
    const security = db.getGuild('security', interaction.guild.id);
    security.antiSpam = enabled;
    db.setGuild('security', interaction.guild.id, security);

    await interaction.reply({
      embeds: [embeds.success('Anti-Spam Updated', `Anti-spam has been **${enabled ? 'enabled' : 'disabled'}**.\n${enabled ? 'Members who send 5+ messages within 5 seconds will be automatically timed out.' : ''}`)]
    });
  },
};
