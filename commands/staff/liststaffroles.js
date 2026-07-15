// /liststaffroles - Lists all configured staff roles
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "liststaffroles",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('liststaffroles')
    .setDescription('View all configured staff roles'),
  cooldown: 5,

  async execute(interaction) {
    const staffDb = db.read('staff_roles');
    const guildRoles = staffDb[interaction.guild.id] || [];

    if (guildRoles.length === 0) {
      return interaction.reply({ embeds: [embeds.info('No Staff Roles', 'No staff roles have been configured. Use `/setstaffrole` to add one.')] });
    }

    const roleList = guildRoles
      .map(id => {
        const role = interaction.guild.roles.cache.get(id);
        return role ? `${role} (${id})` : `~~Deleted Role~~ (${id})`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`👮 Staff Roles — ${interaction.guild.name}`)
      .setDescription(roleList)
      .setFooter({ text: `${guildRoles.length} staff role(s)` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
