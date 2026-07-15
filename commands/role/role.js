// /role - Add, remove, create, delete roles
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff, canModerate } = require('../../utils/permissions');

module.exports = {
  name: "role",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Manage roles')
    .addSubcommand(sub => sub.setName('add')
      .setDescription('Add a role to a member')
      .addUserOption(opt => opt.setName('user').setDescription('The member').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('The role to add').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove')
      .setDescription('Remove a role from a member')
      .addUserOption(opt => opt.setName('user').setDescription('The member').setRequired(true))
      .addRoleOption(opt => opt.setName('role').setDescription('The role to remove').setRequired(true)))
    .addSubcommand(sub => sub.setName('create')
      .setDescription('Create a new role')
      .addStringOption(opt => opt.setName('name').setDescription('Role name').setRequired(true))
      .addStringOption(opt => opt.setName('color').setDescription('Hex color e.g. #FF0000'))
      .addBooleanOption(opt => opt.setName('hoist').setDescription('Display separately in member list?'))
      .addBooleanOption(opt => opt.setName('mentionable').setDescription('Mentionable by everyone?')))
    .addSubcommand(sub => sub.setName('delete')
      .setDescription('Delete a role')
      .addRoleOption(opt => opt.setName('role').setDescription('The role to delete').setRequired(true))),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand(false);
    if (!sub) return interaction.reply({ embeds: [embeds.error('No Subcommand', 'Use: `add`, `remove`, `create`, or `delete`.')], flags: MessageFlags.Ephemeral });

    // ── ADD ─────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const target = interaction.options.getMember('user');
      const role = interaction.options.getRole('role');
      if (!target) return interaction.reply({ embeds: [embeds.error('Not Found', 'Member not found.')], flags: MessageFlags.Ephemeral });
      if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [embeds.error('Hierarchy', 'You cannot modify this member\'s roles.')], flags: MessageFlags.Ephemeral });
      if (interaction.guild.members.me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ embeds: [embeds.error('Bot Hierarchy', 'I cannot assign roles higher than my own.')], flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();
      try {
        await target.roles.add(role);
        return interaction.editReply({ embeds: [embeds.success('Role Added', `${role} has been added to ${target}.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error('Failed', `Could not add role: ${err.message}`)] });
      }
    }

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const target = interaction.options.getMember('user');
      const role = interaction.options.getRole('role');
      if (!target) return interaction.reply({ embeds: [embeds.error('Not Found', 'Member not found.')], flags: MessageFlags.Ephemeral });
      if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [embeds.error('Hierarchy', 'You cannot modify this member\'s roles.')], flags: MessageFlags.Ephemeral });

      await interaction.deferReply();
      try {
        await target.roles.remove(role);
        return interaction.editReply({ embeds: [embeds.success('Role Removed', `${role} has been removed from ${target}.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error('Failed', `Could not remove role: ${err.message}`)] });
      }
    }

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (sub === 'create') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ embeds: [embeds.noPermission('Manage Roles')], flags: MessageFlags.Ephemeral });
      }
      const name = interaction.options.getString('name');
      const color = interaction.options.getString('color') || null;
      const hoist = interaction.options.getBoolean('hoist') ?? false;
      const mentionable = interaction.options.getBoolean('mentionable') ?? false;

      await interaction.deferReply();
      try {
        const role = await interaction.guild.roles.create({ name, color, hoist, mentionable, reason: `Created by ${interaction.user.username}` });
        return interaction.editReply({ embeds: [embeds.success('Role Created', `${role} has been created successfully.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error('Failed', `Could not create role: ${err.message}`)] });
      }
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ embeds: [embeds.noPermission('Manage Roles')], flags: MessageFlags.Ephemeral });
      }
      const role = interaction.options.getRole('role');
      if (interaction.guild.members.me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.reply({ embeds: [embeds.error('Bot Hierarchy', 'I cannot delete this role as it is higher than my own.')], flags: MessageFlags.Ephemeral });
      }
      const roleName = role.name;

      await interaction.deferReply();
      try {
        await role.delete(`Deleted by ${interaction.user.username}`);
        return interaction.editReply({ embeds: [embeds.success('Role Deleted', `Role **${roleName}** has been deleted.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error('Failed', `Could not delete role: ${err.message}`)] });
      }
    }
  },
};
