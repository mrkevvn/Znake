// /about - Shows information about the bot
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const { formatDuration } = require('../../utils/formatters');

module.exports = {
  name: "about",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('Learn about this bot'),
  cooldown: 10,

  async execute(interaction, client) {
    const botName = client.user.username;
    const avatar = client.user.displayAvatarURL({ size: 1024, forceStatic: true });

    const uptime = formatDuration(client.uptime);
    const guilds = client.guilds.cache.size;

    const users = client.users.cache.size;
    const commands = client.commands.size;

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`ℹ️ About ${botName}`)
      .setThumbnail(avatar)
      .setDescription(
        `**${botName}** is a full-featured Discord management bot built with **Discord.js v14**.\n\n` +
          `It provides moderation tools, tickets, giveaways, logging, and more—designed to be fast, clean, and reliable.`
      )
      .addFields(
        {
          name: '📦 Build',
          value: `Version: \`${config.version}\`\nLibrary: \`discord.js v14\``,
          inline: false,
        },
        {
          name: '📊 Live Stats',
          value: `Guilds: \`${guilds}\`\nUsers: \`${users}\`\nCommands: \`${commands}\``,
          inline: false,
        },
        {
          name: '⏱️ Uptime',
          value: `\`${uptime}\``,
          inline: true,
        },
        {
          name: '💾 Storage',
          value: 'JSON files (local)',
          inline: true,
        },
        {
          name: '🌐 Runtime',
          value: `Node.js \`${process.version}\``,
          inline: true,
        }
      )
      .setFooter({ text: `Tip: use /help • Cooldown: ${module.exports.cooldown}s` })
      .setTimestamp();


    await interaction.reply({ embeds: [embed] });
  },
};

