// /setgoodbye - Configure the goodbye message system
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "setgoodbye",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('setgoodbye')
    .setDescription('Configure the goodbye message when members leave')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send goodbye messages').setRequired(true))
    .addStringOption(opt => opt.setName('message').setDescription('Goodbye message. Use {user}, {username}, {server}, {count}'))
    .addStringOption(opt => opt.setName('title').setDescription('Embed title'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  cooldown: 5,

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const title = interaction.options.getString('title');

    const welcome = db.getGuild('welcome', interaction.guild.id);
    welcome.goodbyeChannelId = channel.id;
    welcome.goodbyeEnabled = true;
    if (message !== null) welcome.goodbyeMessage = message;
    if (title !== null) welcome.goodbyeTitle = title;
    db.setGuild('welcome', interaction.guild.id, welcome);

    const embedColor = config.embedColor || '#5865F2';
    const serverIcon = interaction.guild.iconURL({ dynamic: true }) || null;

    // Build premium configuration embed
    const configEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('⚙️ Goodbye Module Configured')
      .setDescription('The goodbye system has been updated successfully with the configuration shown below.')
      .setThumbnail(serverIcon)
      .addFields(
        { name: '🔌 Module Status', value: '🟢 **Enabled**', inline: true },
        { name: '📍 Destination Channel', value: `<#${channel.id}>`, inline: true },
        { name: '✨ Title Text', value: `\`\`\`\n${welcome.goodbyeTitle || '👋 Goodbye!'}\n\`\`\``, inline: false },
        { name: '💬 Custom Message', value: `\`\`\`\n${welcome.goodbyeMessage || '**{username}** has left the server. We now have {count} members.'}\n\`\`\``, inline: false },
        { name: '💡 Available Placeholders', value: '`{user}` - Mention user\n`{username}` - User\'s name\n`{server}` - Server name\n`{count}` - Member count', inline: false }
      )
      .setTimestamp()
      .setFooter({ text: `${interaction.guild.name} • System Dashboard`, iconURL: serverIcon });

    await interaction.reply({ embeds: [configEmbed] });
  },
};
