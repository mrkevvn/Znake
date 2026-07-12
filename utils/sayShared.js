// sayShared.js - Shared logic for /say slash command and context menu Say command
const { MessageFlags, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const embeds = require('./embeds');
const cooldown = require('./cooldown');
const config = require('../config.json');

// Get configuration or set default values
const sayConfig = config.sayCommand || {
  allowedRoleId: null,                // Configurable role ID
  cooldownDuration: 3,                // Cooldown duration (default 3–5 seconds)
  embedDefault: false,                // Embed default
  deleteCommandToggle: true,          // Delete command toggle
  blacklistChannels: []               // Blacklisted channels
};

/**
 * Check if the member has permission to use the say commands
 */
function checkPermissions(member) {
  const isAdministrator = member?.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const hasConfiguredRole = sayConfig.allowedRoleId ? member?.roles?.cache?.has(sayConfig.allowedRoleId) : false;
  return isAdministrator || hasConfiguredRole;
}

/**
 * Check if a channel is blacklisted
 */
function isChannelBlacklisted(channelId) {
  const blacklist = sayConfig.blacklistChannels || [];
  return blacklist.includes(channelId);
}

/**
 * Main say execution function shared between slash command, prefix command, and context menu modal submission.
 */
async function executeSay(interaction, {
  rawMessage,
  targetChannel,
  embedOption,
  titleOption,
  colorOption,
  targetMessage
}) {
  const member = interaction.member;
  const user = interaction.user || interaction.author;
  const isInteraction = typeof interaction.options?.getString === 'function' || interaction.isModalSubmit?.();

  // ── Permission Handling ────────────────────────────────────────
  if (!checkPermissions(member)) {
    const errorEmbed = embeds.error(
      'Permission Denied',
      `You do not have the required permissions to run this command. Must be an Administrator or have the allowed role.`
    );
    if (isInteraction) {
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ embeds: [errorEmbed] });
    }
  }

  // Prevent empty messages
  if (!rawMessage || rawMessage.trim().length === 0) {
    const errorEmbed = embeds.error('Invalid Usage', 'Message content cannot be empty.');
    if (isInteraction) {
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ embeds: [errorEmbed] });
    }
  }

  // ── Target Channel & Blacklist Check ────────────────────────────
  if (!targetChannel) {
    targetChannel = interaction.channel;
  }

  if (isChannelBlacklisted(targetChannel.id)) {
    const errorEmbed = embeds.error('Access Blocked', 'This channel is blacklisted from receiving say messages.');
    if (isInteraction) {
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ embeds: [errorEmbed] });
    }
  }

  const textTypes = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
  ];
  if (!textTypes.includes(targetChannel.type)) {
    const errorEmbed = embeds.error('Wrong Channel Type', 'Messages can only be sent to text channels or threads.');
    if (isInteraction) {
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ embeds: [errorEmbed] });
    }
  }

  // ── Color Validation ────────────────────────────────────────────
  if (colorOption && !/^#[0-9A-Fa-f]{6}$/.test(colorOption)) {
    const errorEmbed = embeds.error('Invalid Color', 'Color must be a valid hex code, e.g. `#5865F2`.');
    if (isInteraction) {
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ embeds: [errorEmbed] });
    }
  }

  // ── Safety / Abuse Prevention ───────────────────────────────────
  const hasMentionEveryone = member?.permissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  let cleanMessage = rawMessage;
  if (!hasMentionEveryone) {
    cleanMessage = cleanMessage.replace(/@everyone/g, 'everyone').replace(/@here/g, 'here');
  }

  // Check if --embed exists in message content and strip it
  let asEmbed = embedOption ?? sayConfig.embedDefault ?? false;
  if (cleanMessage.includes('--embed')) {
    asEmbed = true;
    cleanMessage = cleanMessage.replace('--embed', '').trim();
  }

  // ── Build Message Payload ───────────────────────────────────────
  const sendPayload = {};

  if (asEmbed) {
    const embed = new EmbedBuilder()
      .setColor(colorOption || config.embedColor || '#5865F2')
      .setDescription(cleanMessage)
      .setTimestamp();
    
    if (titleOption) {
      embed.setTitle(titleOption);
    }
    
    if (user) {
      embed.setAuthor({
        name: user.username,
        iconURL: user.displayAvatarURL({ dynamic: true })
      });
    }

    sendPayload.embeds = [embed];
  } else {
    sendPayload.content = cleanMessage;
  }

  // Acknowledge the interaction to prevent timeout
  if (isInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // ── Send Message / Reply ────────────────────────────────────────
  try {
    let sentMessage = null;
    if (targetMessage) {
      sentMessage = await targetMessage.reply(sendPayload);
    } else {
      sentMessage = await targetChannel.send(sendPayload);
    }

    // Delete command message if prefix/standard message triggered
    if (sayConfig.deleteCommandToggle && !isInteraction && typeof interaction.delete === 'function') {
      await interaction.delete().catch(() => {});
    }

    // Final interaction reply success notice
    if (isInteraction) {
      const successEmbed = embeds.success('Message Sent', `Your message was sent successfully to ${targetChannel}.`);
      await interaction.editReply({ embeds: [successEmbed] }).catch(() => {});
    }
  } catch (err) {
    const errEmbed = embeds.error('Send Failed', `Could not send message: \`${err.message}\``);
    if (isInteraction) {
      await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errEmbed] }).catch(() => {});
    }
  }
}

module.exports = {
  sayConfig,
  checkPermissions,
  isChannelBlacklisted,
  executeSay
};
