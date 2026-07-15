// /autorole - Configure automatic role assignment on member join
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "autorole",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Configure the autorole system')
    .addSubcommand(sub => sub.setName('set')
      .setDescription('Set the role to auto-assign to new members')
      .addRoleOption(opt => opt.setName('role').setDescription('Role to auto-assign').setRequired(true)))
    .addSubcommand(sub => sub.setName('disable')
      .setDescription('Disable the autorole system'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [embeds.noPermission('Manage Roles')], flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const autorole = db.getGuild('autorole', interaction.guild.id);

    if (sub === 'set') {
      const role = interaction.options.getRole('role');

      if (interaction.guild.members.me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ embeds: [embeds.error('Bot Hierarchy', 'I cannot assign this role as it is higher than my own.')], flags: MessageFlags.Ephemeral });
      }

      autorole.roleId = role.id;
      autorole.enabled = true;
      db.setGuild('autorole', interaction.guild.id, autorole);

      return interaction.reply({ embeds: [embeds.success('Autorole Set', `${role} will now be automatically assigned to all new members.`)] });
    }

    if (sub === 'disable') {
      autorole.roleId = null;
      autorole.enabled = false;
      db.setGuild('autorole', interaction.guild.id, autorole);
      return interaction.reply({ embeds: [embeds.success('Autorole Disabled', 'Autorole has been disabled. New members will not receive a role automatically.')] });
    }
  },
};
