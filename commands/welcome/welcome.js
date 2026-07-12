// /welcome - Test and view the welcome/goodbye system configuration
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "welcome",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Manage, test, and view the welcome/goodbye system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('Display the welcome & goodbye system configuration dashboard'))
    .addSubcommand(sub =>
      sub.setName('test')
        .setDescription('Send a test welcome or goodbye message and view a preview')
        .addStringOption(opt =>
          opt.setName('type').setDescription('Type of message to test').setRequired(true)
            .addChoices({ name: 'Welcome', value: 'welcome' }, { name: 'Goodbye', value: 'goodbye' }))),
  cooldown: 5,

  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();
    const { guild, member } = interaction;
    const embedColor = config.embedColor || '#5865F2';
    const serverIcon = guild.iconURL({ dynamic: true }) || null;
    const userAvatar = member.user.displayAvatarURL({ dynamic: true });

    const welcomeSettings = db.getGuild('welcome', guild.id);

    if (subcommand === 'info') {
      // Build dashboard configuration info embed
      const welcomeStatus = welcomeSettings.enabled && welcomeSettings.channelId ? '🟢 **Enabled**' : '🔴 **Disabled**';
      const welcomeChannel = welcomeSettings.channelId ? `<#${welcomeSettings.channelId}>` : '`Not Configured`';
      const welcomeTitle = welcomeSettings.title || '`👋 Welcome to {server}!` (Default)';
      const welcomeMsg = welcomeSettings.message || '`Welcome to **{server}**, {user}! You are member #{count}.` (Default)';
      const welcomeFooter = welcomeSettings.footer || '`Not Configured`';

      const goodbyeStatus = welcomeSettings.goodbyeEnabled && welcomeSettings.goodbyeChannelId ? '🟢 **Enabled**' : '🔴 **Disabled**';
      const goodbyeChannel = welcomeSettings.goodbyeChannelId ? `<#${welcomeSettings.goodbyeChannelId}>` : '`Not Configured`';
      const goodbyeTitle = welcomeSettings.goodbyeTitle || '`👋 Goodbye!` (Default)';
      const goodbyeMsg = welcomeSettings.goodbyeMessage || '`**{username}** has left the server. We now have {count} members.` (Default)';

      const dashboardEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('📊 Welcome & Goodbye System Dashboard')
        .setDescription('Configure these settings using `/setwelcome` and `/setgoodbye`.')
        .setThumbnail(serverIcon)
        .addFields(
          { name: '👋 Welcome Module', value: `• **Status:** ${welcomeStatus}\n• **Channel:** ${welcomeChannel}`, inline: true },
          { name: '🚪 Goodbye Module', value: `• **Status:** ${goodbyeStatus}\n• **Channel:** ${goodbyeChannel}`, inline: true },
          { name: '\u200B', value: '📊 **Welcome Details**' },
          { name: '✨ Title Text', value: `\`\`\`\n${welcomeTitle}\n\`\`\``, inline: false },
          { name: '💬 Message Text', value: `\`\`\`\n${welcomeMsg}\n\`\`\``, inline: false },
          { name: '🏷️ Footer Text', value: `\`\`\`\n${welcomeFooter}\n\`\`\``, inline: false },
          { name: '\u200B', value: '📊 **Goodbye Details**' },
          { name: '✨ Title Text', value: `\`\`\`\n${goodbyeTitle}\n\`\`\``, inline: false },
          { name: '💬 Message Text', value: `\`\`\`\n${goodbyeMsg}\n\`\`\``, inline: false },
          { name: '💡 Available Placeholders', value: '`{user}` - Mention user\n`{username}` - User\'s name\n`{server}` - Server name\n`{count}` - Member count', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: `${guild.name} • Server Settings`, iconURL: serverIcon });

      return interaction.reply({ embeds: [dashboardEmbed], flags: MessageFlags.Ephemeral });
    }

    if (subcommand === 'test') {
      const type = interaction.options.getString('type');

      if (type === 'welcome') {
        // Run the actual event handler
        await require('../../events/guildMemberAdd').execute(client, member);

        // Parse preview
        const rawMsg = welcomeSettings.message || 'Welcome to **{server}**, {user}! You are member #{count}.';
        const parsedMsg = rawMsg
          .replace('{user}', member.user.toString())
          .replace('{username}', member.user.username)
          .replace('{server}', guild.name)
          .replace('{count}', guild.memberCount);

        const previewTitle = welcomeSettings.title || `👋 Welcome to ${guild.name}!`;

        const headerEmbed = new EmbedBuilder()
          .setColor(config.successColor || '#57F287')
          .setTitle('✅ Welcome Test Dispatched')
          .setDescription(`A test welcome message was successfully sent to <#${welcomeSettings.channelId || interaction.channelId}>.\n\n**Below is a realistic preview of the message:**`)
          .setTimestamp();

        const previewEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(previewTitle)
          .setDescription(parsedMsg)
          .setThumbnail(userAvatar)
          .setTimestamp();

        if (welcomeSettings.footer) {
          previewEmbed.setFooter({ text: welcomeSettings.footer });
        }

        return interaction.reply({ embeds: [headerEmbed, previewEmbed], flags: MessageFlags.Ephemeral });
      }

      if (type === 'goodbye') {
        // Run the actual event handler
        await require('../../events/guildMemberRemove').execute(client, member);

        // Parse preview
        const rawMsg = welcomeSettings.goodbyeMessage || '**{username}** has left the server. We now have {count} members.';
        const parsedMsg = rawMsg
          .replace('{user}', member.user.toString())
          .replace('{username}', member.user.username)
          .replace('{server}', guild.name)
          .replace('{count}', guild.memberCount);

        const previewTitle = welcomeSettings.goodbyeTitle || '👋 Goodbye!';

        const headerEmbed = new EmbedBuilder()
          .setColor(config.successColor || '#57F287')
          .setTitle('✅ Goodbye Test Dispatched')
          .setDescription(`A test goodbye message was successfully sent to <#${welcomeSettings.goodbyeChannelId || interaction.channelId}>.\n\n**Below is a realistic preview of the message:**`)
          .setTimestamp();

        const previewEmbed = new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle(previewTitle)
          .setDescription(parsedMsg)
          .setThumbnail(userAvatar)
          .setTimestamp();

        return interaction.reply({ embeds: [headerEmbed, previewEmbed], flags: MessageFlags.Ephemeral });
      }
    }
  },
};
