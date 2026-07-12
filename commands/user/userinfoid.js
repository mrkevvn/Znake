// /userinfoid - Looks up a user by their ID
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

module.exports = {
  name: "userinfoid",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('userinfoid')
    .setDescription('Look up a user by their Discord ID')
    .addStringOption(opt =>
      opt.setName('id').setDescription('The Discord user ID').setRequired(true)),
  cooldown: 5,

  async execute(interaction) {
    const userId = interaction.options.getString('id');

    await interaction.deferReply();

    try {
      const user = await interaction.client.users.fetch(userId, { force: true });
      const member = interaction.guild.members.cache.get(userId);

      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`👤 ${user.globalName || user.username}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: '🆔 User ID', value: user.id, inline: true },
          { name: '🤖 Bot', value: user.bot ? 'Yes' : 'No', inline: true },
          { name: '📅 Account Created', value: discordTimestamp(user.createdAt, 'R'), inline: true },
          { name: '📥 In Server', value: member ? 'Yes' : 'No', inline: true }
        )
        .setTimestamp();

      if (member) {
        embed.addFields(
          { name: '📥 Joined Server', value: discordTimestamp(member.joinedAt, 'R'), inline: true },
          { name: '📛 Nickname', value: member.nickname || 'None', inline: true }
        );
      }

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ embeds: [
        new EmbedBuilder().setColor(config.errorColor)
          .setTitle('❌ User Not Found')
          .setDescription(`Could not find a user with ID \`${userId}\`.`)
      ]});
    }
  },
};
