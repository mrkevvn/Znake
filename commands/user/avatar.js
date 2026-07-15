// /avatar - Shows a user's avatar
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');

module.exports = {
  name: "avatar",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('View a user\'s avatar')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The user whose avatar to view (defaults to yourself)')),
  cooldown: 5,

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🖼️ ${user.username}'s Avatar`)
      .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open PNG')
        .setURL(user.displayAvatarURL({ format: 'png', size: 1024 }))
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setLabel('Open WebP')
        .setURL(user.displayAvatarURL({ format: 'webp', size: 1024 }))
        .setStyle(ButtonStyle.Link)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
