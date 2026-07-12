// /antilink - Toggle the anti-link system
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "antilink",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('antilink')
    .setDescription('Toggle the anti-link system (blocks all URLs)')
    .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable anti-link').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const enabled = interaction.options.getBoolean('enabled');
    const security = db.getGuild('security', interaction.guild.id);
    security.antiLink = enabled;
    db.setGuild('security', interaction.guild.id, security);

    await interaction.reply({
      embeds: [embeds.success('Anti-Link Updated', `Anti-link has been **${enabled ? 'enabled' : 'disabled'}**.\n${enabled ? 'All URLs and links will be automatically deleted.' : ''}`)]
    });
  },
};
