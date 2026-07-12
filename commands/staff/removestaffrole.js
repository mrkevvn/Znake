// /removestaffrole - Removes a role from the staff roles list
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "removestaffrole",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('removestaffrole')
    .setDescription('Remove a role from the staff roles list')
    .addRoleOption(opt => opt.setName('role').setDescription('The role to remove from staff').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('role');
    const staffDb = db.read('staff_roles');
    const guildRoles = staffDb[interaction.guild.id] || [];

    if (!guildRoles.includes(role.id)) {
      return interaction.reply({ embeds: [embeds.warning('Not Staff', `${role} is not a configured staff role.`)], flags: MessageFlags.Ephemeral });
    }

    staffDb[interaction.guild.id] = guildRoles.filter(id => id !== role.id);
    db.write('staff_roles', staffDb);

    await interaction.reply({ embeds: [embeds.success('Staff Role Removed', `${role} has been removed from staff roles.`)] });
  },
};
