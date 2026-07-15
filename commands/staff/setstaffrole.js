// /setstaffrole - Adds a role to the staff roles list
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "setstaffrole",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('setstaffrole')
    .setDescription('Add a role to the staff roles list')
    .addRoleOption(opt => opt.setName('role').setDescription('The role to designate as staff').setRequired(true)),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('role');
    const staffDb = db.read('staff_roles');

    if (!staffDb[interaction.guild.id]) staffDb[interaction.guild.id] = [];
    if (staffDb[interaction.guild.id].includes(role.id)) {
      return interaction.reply({ embeds: [embeds.warning('Already Staff', `${role} is already a staff role.`)], flags: MessageFlags.Ephemeral });
    }

    staffDb[interaction.guild.id].push(role.id);
    db.write('staff_roles', staffDb);

    await interaction.reply({ embeds: [embeds.success('Staff Role Added', `${role} has been added as a staff role.`)] });
  },
};
