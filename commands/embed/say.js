// /say - Makes the bot send a plain message or embed to a channel
const { MessageFlags, SlashCommandBuilder, ChannelType } = require('discord.js');
const { sayConfig, executeSay } = require('../../utils/sayShared');
const embeds = require('../../utils/embeds');
const config = require('../../config.json');

module.exports = {
  name: "say",
  category: "moderation",
  cooldown: sayConfig.cooldownDuration ?? 3,
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send a message or embed to a channel')
    .addStringOption(opt => opt
      .setName('message')
      .setDescription('The message or embed description to send')
      .setRequired(true))
    .addChannelOption(opt => opt
      .setName('channel')
      .setDescription('Channel to send to (defaults to current channel)'))
    .addBooleanOption(opt => opt
      .setName('embed')
      .setDescription('Send as an embed? (default: false)'))
    .addStringOption(opt => opt
      .setName('reply_to')
      .setDescription('Message ID or Link to reply to (optional reply context)'))
    .addStringOption(opt => opt
      .setName('title')
      .setDescription('Embed title (only used when embed is true)'))
    .addStringOption(opt => opt
      .setName('color')
      .setDescription('Embed hex color e.g. #5865F2 (only used when embed is true)')),

  async execute(interaction) {
    // ── Extract Options ───────────────────────────────────────────
    let rawMessage = '';
    let channelOption = null;
    let embedOption = null;
    let replyToOption = null;
    let titleOption = null;
    let colorOption = null;

    const isInteraction = typeof interaction.options?.getString === 'function';

    if (isInteraction) {
      rawMessage = interaction.options.getString('message');
      channelOption = interaction.options.getChannel('channel');
      embedOption = interaction.options.getBoolean('embed');
      replyToOption = interaction.options.getString('reply_to');
      titleOption = interaction.options.getString('title') || null;
      colorOption = interaction.options.getString('color') || null;
    } else {
      // Fallback for prefix command execution (Message object)
      // Extract arguments from message content (e.g. !say <message>)
      const args = interaction.content.slice(config.prefix?.length || 1).trim().split(/ +/);
      args.shift(); // remove command name
      rawMessage = args.join(' ');
    }

    // ── Determine Target Channel ────────────────
    let targetChannel = interaction.channel;
    if (channelOption) {
      try {
        targetChannel = await interaction.guild.channels.fetch(channelOption.id);
      } catch {
        const errorEmbed = embeds.error('Channel Not Found', 'Could not find that channel in this server.');
        if (isInteraction) {
          return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } else {
          return interaction.reply({ embeds: [errorEmbed] });
        }
      }
    }

    // ── Determine Reply Context ──────────────────
    let targetMessage = null;
    let targetMessageId = null;

    if (interaction.reference && interaction.reference.messageId) {
      targetMessageId = interaction.reference.messageId;
    } else if (replyToOption) {
      const urlMatch = replyToOption.match(/(?:discord\.com\/channels\/\d+\/\d+\/)(\d+)/);
      targetMessageId = urlMatch ? urlMatch[1] : replyToOption;
    }

    if (targetMessageId) {
      targetMessage = await targetChannel.messages.fetch(targetMessageId).catch(() => null);
    }

    // ── Delegate Execution to Shared Helper ────────────────────────
    await executeSay(interaction, {
      rawMessage,
      targetChannel,
      embedOption,
      titleOption,
      colorOption,
      targetMessage
    });
  },
};
