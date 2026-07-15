// /antiinvite - Toggle the anti-invite system
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "antiinvite",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('antiinvite')
    .setDescription('Toggle the anti-invite link system')
    .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable anti-invite').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const enabled = interaction.options.getBoolean('enabled');
    const security = db.getGuild('security', interaction.guild.id);
    security.antiInvite = enabled;
    db.setGuild('security', interaction.guild.id, security);

    await interaction.reply({
      embeds: [embeds.success('Anti-Invite Updated', `Anti-invite has been **${enabled ? 'enabled' : 'disabled'}**.\n${enabled ? 'Discord invite links will be automatically deleted.' : ''}`)]
    });
  },
};
