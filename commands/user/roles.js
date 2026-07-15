// /roles - Lists all roles a member has
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

module.exports = {
  name: "roles",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('View the roles a member has')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user to check (defaults to yourself)')),
  cooldown: 5,

  async execute(interaction) {
    const member = interaction.options.getMember('user') || interaction.member;

    const roles = member.roles.cache
      .filter(r => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position);

    const embed = new EmbedBuilder()
      .setColor(member.displayHexColor || config.embedColor)
      .setTitle(`🏷️ Roles for ${member.user.globalName || member.user.username}`)
      .setDescription(roles.size > 0 ? roles.map(r => r.toString()).join(' ') : 'This member has no roles.')
      .setFooter({ text: `${roles.size} role(s)` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
