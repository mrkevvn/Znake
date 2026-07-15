// /say - Makes the bot send a plain message or embed to a channel via Modal
const {
  MessageFlags, SlashCommandBuilder, ChannelType, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const { sayConfig, checkPermissions, isChannelBlacklisted, executeSay } = require('../../utils/sayShared');
const embeds = require('../../utils/embeds');
const config = require('../../config.json');

const MODAL_CUSTOM_ID = 'say_modal';

const COLOR_NAMES = {
  red: '#ED4245',
  green: '#57F287',
  blue: '#5865F2',
  blurple: '#5865F2',
  yellow: '#FEE75C',
  orange: '#F9A825',
  white: '#FFFFFF',
  black: '#000000',
  grey: '#99AAB5',
  gray: '#99AAB5',
  pink: '#EB459E',
  teal: '#1ABC9C',
  gold: '#F1C40F',
};

function parseChannel(input, guild) {
  if (!input || !guild) return null;
  const mentionMatch = input.match(/^<#(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : input.trim();
  if (!/^\d{17,20}$/.test(id)) return null;
  return guild.channels.cache.get(id) || null;
}

function parseColor(input) {
  if (!input || !input.trim()) return null;
  const raw = input.trim().toLowerCase();
  if (COLOR_NAMES[raw]) return COLOR_NAMES[raw];
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex.toUpperCase();
  return null;
}

function parseEmbedFlag(input) {
  if (!input || !input.trim()) return null;
  const v = input.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  return null;
}

function buildModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_CUSTOM_ID)
    .setTitle('Send Message / Embed Builder')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Message')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Type the message you want the bot to send...')
          .setRequired(true)
          .setMaxLength(4000),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel')
          .setLabel('Channel')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#general or 123456789012345678')
          .setRequired(true)
          .setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('embed')
          .setLabel('Embed (true or false)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('true or false')
          .setRequired(true)
          .setValue('false')
          .setMaxLength(5),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Title (optional, embed only)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Announcement')
          .setRequired(false)
          .setMaxLength(256),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Color (optional, embed only)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#5865F2 or blurple')
          .setRequired(false)
          .setMaxLength(20),
      ),
    );
}

function validateModalFields(fields, guild) {
  const errors = [];

  const rawMessage = fields.getTextInputValue('message')?.trim();
  if (!rawMessage) errors.push('Message cannot be empty.');

  const channelInput = fields.getTextInputValue('channel')?.trim();
  const targetChannel = parseChannel(channelInput, guild);
  if (!channelInput) {
    errors.push('Channel is required.');
  } else if (!targetChannel) {
    errors.push('Channel not found. Use a channel mention (`#general`) or channel ID.');
  } else if (isChannelBlacklisted(targetChannel.id)) {
    errors.push('That channel is blacklisted from receiving say messages.');
  } else {
    const textTypes = [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    ];
    if (!textTypes.includes(targetChannel.type)) {
      errors.push('Messages can only be sent to text channels or threads.');
    } else if (!targetChannel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
      errors.push('I do not have permission to send messages in that channel.');
    }
  }

  const embedInput = fields.getTextInputValue('embed')?.trim();
  const asEmbed = parseEmbedFlag(embedInput);
  if (embedInput && asEmbed === null) {
    errors.push('Embed must be `true` or `false`.');
  }

  const titleInput = fields.getTextInputValue('title')?.trim() || null;
  const colorInput = fields.getTextInputValue('color')?.trim() || null;
  let color = null;
  if (colorInput) {
    color = parseColor(colorInput);
    if (!color) {
      errors.push('Invalid color. Use a hex code (`#5865F2`) or a name (`blurple`, `red`, `green`).');
    }
  }

  return {
    errors,
    rawMessage,
    targetChannel,
    asEmbed: asEmbed ?? false,
    title: titleInput,
    color,
  };
}

module.exports = {
  name: 'say',
  category: 'moderation',
  cooldown: sayConfig.cooldownDuration ?? 3,
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send a message or embed to a channel')
    .addStringOption(opt => opt
      .setName('reply_to')
      .setDescription('Message ID or Link to reply to (optional)')
      .setRequired(false)),

  async execute(interaction) {
    if (!checkPermissions(interaction.member)) {
      return interaction.reply({
        embeds: [embeds.error('Permission Denied', 'You do not have the required permissions to run this command. Must be an Administrator or have the allowed role.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const replyToOption = interaction.options.getString('reply_to') || null;

    const modal = buildModal();
    await interaction.showModal(modal);

    let submitted;
    try {
      submitted = await interaction.awaitModalSubmit({
        time: 300_000,
        filter: (i) => i.customId === MODAL_CUSTOM_ID && i.user.id === interaction.user.id,
      });
    } catch {
      return;
    }

    await submitted.deferReply({ flags: MessageFlags.Ephemeral });

    const { errors, rawMessage, targetChannel, asEmbed, title, color } = validateModalFields(
      submitted.fields,
      interaction.guild,
    );

    if (errors.length > 0) {
      return submitted.editReply({
        embeds: [embeds.error('Validation Failed', errors.join('\n'))],
      });
    }

    let targetMessage = null;
    if (replyToOption) {
      const urlMatch = replyToOption.match(/(?:discord\.com\/channels\/\d+\/\d+\/)(\d+)/);
      const messageId = urlMatch ? urlMatch[1] : replyToOption;
      if (/^\d{17,20}$/.test(messageId)) {
        targetMessage = await targetChannel.messages.fetch(messageId).catch(() => null);
      }
    }

    const user = interaction.user;
    const member = interaction.member;

    let cleanMessage = rawMessage;
    const hasMentionEveryone = member?.permissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
    if (!hasMentionEveryone) {
      cleanMessage = cleanMessage.replace(/@everyone/g, 'everyone').replace(/@here/g, 'here');
    }

    const sendPayload = {};

    if (asEmbed) {
      const embed = new EmbedBuilder()
        .setColor(color || config.embedColor || '#5865F2')
        .setDescription(cleanMessage)
        .setTimestamp();

      if (title) embed.setTitle(title);

      if (user) {
        embed.setAuthor({
          name: user.username,
          iconURL: user.displayAvatarURL({ dynamic: true }),
        });
      }

      sendPayload.embeds = [embed];
    } else {
      sendPayload.content = cleanMessage;
    }

    try {
      if (targetMessage) {
        await targetMessage.reply(sendPayload);
      } else {
        await targetChannel.send(sendPayload);
      }

      const successEmbed = embeds.success(
        'Message Sent',
        `Your message was sent successfully to ${targetChannel}.`,
      );
      await submitted.editReply({ embeds: [successEmbed] });
    } catch (err) {
      await submitted.editReply({
        embeds: [embeds.error('Send Failed', `Could not send message: \`${err.message}\``)],
      });
    }
  },
};
