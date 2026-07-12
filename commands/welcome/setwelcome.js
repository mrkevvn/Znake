// /setwelcome - Configure the welcome message system
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "setwelcome",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('Configure the welcome message')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send welcome messages').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Welcome message. Use {user}, {username}, {server}, {count}'))
    .addStringOption(opt => opt.setName('title').setDescription('Embed title'))
    .addStringOption(opt => opt.setName('footer').setDescription('Embed footer text'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  cooldown: 5,

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const title = interaction.options.getString('title');
    const footer = interaction.options.getString('footer');

    const welcome = db.getGuild('welcome', interaction.guild.id);
    welcome.channelId = channel.id;
    welcome.enabled = true;
    if (message !== null) welcome.message = message;
    if (title !== null) welcome.title = title;
    if (footer !== null) welcome.footer = footer;
    db.setGuild('welcome', interaction.guild.id, welcome);

    const embedColor = config.embedColor || '#5865F2';
    const serverIcon = interaction.guild.iconURL({ dynamic: true }) || null;

    // Build premium configuration embed
    const configEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('⚙️ Welcome Module Configured')
      .setDescription('The welcome system has been updated successfully with the configuration shown below.')
      .setThumbnail(serverIcon)
      .addFields(
        { name: '🔌 Module Status', value: '🟢 **Enabled**', inline: true },
        { name: '📍 Destination Channel', value: `<#${channel.id}>`, inline: true },
        { name: '✨ Title Text', value: `\`\`\`\n${welcome.title || '👋 Welcome to {server}!'}\n\`\`\``, inline: false },
        { name: '💬 Custom Message', value: `\`\`\`\n${welcome.message || 'Welcome to **{server}**, {user}! You are member #{count}.'}\n\`\`\``, inline: false },
        { name: '🏷️ Footer Text', value: `\`\`\`\n${welcome.footer || 'Not Configured'}\n\`\`\``, inline: false },
        { name: '💡 Available Placeholders', value: '`{user}` - Mention user\n`{username}` - User\'s name\n`{server}` - Server name\n`{count}` - Member count', inline: false }
      )
      .setTimestamp()
      .setFooter({ text: `${interaction.guild.name} • System Dashboard`, iconURL: serverIcon });

    await interaction.reply({ embeds: [configEmbed] });
  },
};
