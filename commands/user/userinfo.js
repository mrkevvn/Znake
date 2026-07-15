// /userinfo - Displays info about a user (or yourself)
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

module.exports = {
  name: "userinfo",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('View information about a user')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user to look up (defaults to yourself)')),
  cooldown: 5,

  async execute(interaction) {
    const target = interaction.options.getMember('user') || interaction.member;
    const user = target.user;

    await user.fetch(); // Fetch banner etc.

    const roles = target.roles.cache
      .filter(r => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r.toString());

    const embed = new EmbedBuilder()
      .setColor(target.displayHexColor || config.embedColor)
      .setTitle(`👤 ${user.globalName || user.username}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        { name: '🆔 User ID', value: user.id, inline: true },
        { name: '🤖 Bot', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: '📅 Account Created', value: discordTimestamp(user.createdAt, 'R'), inline: true },
        { name: '📥 Joined Server', value: discordTimestamp(target.joinedAt, 'R'), inline: true },
        { name: '🎨 Display Color', value: target.displayHexColor || '#000000', inline: true },
        { name: '📛 Nickname', value: target.nickname || 'None', inline: true },
        { name: `🏷️ Roles [${roles.length}]`, value: roles.length > 0 ? roles.slice(0, 20).join(', ') : 'None', inline: false }
      )
      .setTimestamp();

    if (user.banner) {
      embed.setImage(user.bannerURL({ dynamic: true, size: 512 }));
    }

    await interaction.reply({ embeds: [embed] });
  },
};
