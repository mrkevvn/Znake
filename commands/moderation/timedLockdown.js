'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

const LOCKDOWNS_FILE_PATH = path.join(__dirname, '../../data/lockdowns.json');

// In-memory timer map: Map<channelId, timeoutId>
const activeTimers = new Map();

// ─────────────────────────────
// File I/O
// ─────────────────────────────

function readLockdownsFile() {
  try {
    if (!fs.existsSync(LOCKDOWNS_FILE_PATH)) {
      fs.writeFileSync(LOCKDOWNS_FILE_PATH, JSON.stringify({ channels: {} }, null, 2));
    }
    const raw = fs.readFileSync(LOCKDOWNS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { channels: {} };
  } catch {
    return { channels: {} };
  }
}

function writeLockdownsFile(data) {
  try {
    fs.writeFileSync(LOCKDOWNS_FILE_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error(`Failed to write lockdowns file: ${err.message}`);
  }
}

function updateLockdownRecord(channelId, guildId, duration, startTimestamp) {
  const data = readLockdownsFile();
  if (!data.channels) data.channels = {};

  const endTimestamp = startTimestamp + duration;

  data.channels[channelId] = {
    channelId,
    guildId,
    active: true,
    type: 'timed',
    duration,
    startTimestamp,
    endTimestamp,
  };

  writeLockdownsFile(data);
}

function removeLockdownRecord(channelId) {
  const data = readLockdownsFile();
  if (data.channels && data.channels[channelId]) {
    delete data.channels[channelId];
    writeLockdownsFile(data);
  }
}

// ─────────────────────────────
// Unlock Logic
// ─────────────────────────────

async function unlockChannelByRecord(client, channelId, guildId, reason = 'Timed lockdown expired') {
  try {
    // Cancel any pending timer
    if (activeTimers.has(channelId)) {
      clearTimeout(activeTimers.get(channelId));
      activeTimers.delete(channelId);
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      removeLockdownRecord(channelId);
      return;
    }

    const everyone = guild.roles.everyone;
    if (!everyone) return;

    // Remove the SendMessages override (returns to default)
    await channel.permissionOverwrites.delete(everyone, { reason });

    removeLockdownRecord(channelId);
    logger.info(`Channel unlocked: #${channel.name} (${reason})`);
  } catch (err) {
    logger.error(`Failed to unlock channel ${channelId}: ${err.message}`);
  }
}

// ─────────────────────────────
// Timer Scheduling
// ─────────────────────────────

function scheduleUnlockIfActive(client, record) {
  if (!record || !record.active) return;

  const { channelId, guildId, endTimestamp } = record;
  const now = Date.now();
  const timeRemaining = Math.max(0, endTimestamp - now);

  // If already expired, unlock immediately
  if (timeRemaining <= 0) {
    unlockChannelByRecord(client, channelId, guildId, 'Lockdown expired');
    return;
  }

  // Cancel any existing timer for this channel
  if (activeTimers.has(channelId)) {
    clearTimeout(activeTimers.get(channelId));
  }

  // Schedule new timer
  const timeoutId = setTimeout(() => {
    activeTimers.delete(channelId);
    unlockChannelByRecord(client, channelId, guildId, 'Timed lockdown expired');
  }, timeRemaining);

  activeTimers.set(channelId, timeoutId);
}

// ─────────────────────────────
// Lock Logic
// ─────────────────────────────

async function lockChannelWithTimer(channel, guild, durationMs) {
  const everyone = guild.roles.everyone;

  // Apply SendMessages: false override for @everyone
  await channel.permissionOverwrites.edit(everyone, {
    SendMessages: false,
  }, { reason: 'Timed lockdown' });

  // Save to persistent storage
  const startTs = Date.now();
  updateLockdownRecord(channel.id, guild.id, durationMs, startTs);

  // Schedule unlock timer
  const record = {
    channelId: channel.id,
    guildId: guild.id,
    active: true,
    type: 'timed',
    duration: durationMs,
    startTimestamp: startTs,
    endTimestamp: startTs + durationMs,
  };

  scheduleUnlockIfActive(null, record); // client will be set in actual use
}

// ─────────────────────────────
// Duration Parser
// ─────────────────────────────

function parseDuration(durationStr) {
  if (!durationStr) return null;

  const match = durationStr.match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 0);
}

// ─────────────────────────────
// Command
// ─────────────────────────────

module.exports = {
  name: "timedlockdown",
  category: "moderation",
  default_member_permissions: "ManageChannels",
  data: new SlashCommandBuilder()
    .setName('timedlockdown')
    .setDescription('Lock a channel for a specified duration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((opt) =>
      opt
        .setName('duration')
        .setDescription('Lock duration (e.g., 5m, 1h, 2d)')
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to lock (default: current channel)')
        .setRequired(false),
    ),

  async execute(interaction) {
    // Permission check
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: 64,
      });
    }

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const durationStr = interaction.options.getString('duration');

    if (!targetChannel) {
      return interaction.reply({
        content: 'Channel not found.',
        flags: 64,
      });
    }

    // Parse duration
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.reply({
        content: 'Invalid duration format. Use: 5s, 10m, 1h, 2d',
        flags: 64,
      });
    }

    if (durationMs < 1000 || durationMs > 30 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        content: 'Duration must be between 1 second and 30 days.',
        flags: 64,
      });
    }

    try {
      const everyone = targetChannel.guild.roles.everyone;

      if (!everyone) {
        return interaction.reply({
          content: 'Could not find @everyone role.',
          flags: 64,
        });
      }

      // Lock the channel
      await targetChannel.permissionOverwrites.edit(everyone, {
        SendMessages: false,
      }, { reason: 'Timed lockdown' });

      // Save and schedule
      const startTs = Date.now();
      updateLockdownRecord(targetChannel.id, targetChannel.guild.id, durationMs, startTs);

      const record = {
        channelId: targetChannel.id,
        guildId: targetChannel.guild.id,
        active: true,
        type: 'timed',
        duration: durationMs,
        startTimestamp: startTs,
        endTimestamp: startTs + durationMs,
      };

      scheduleUnlockIfActive(interaction.client, record);

      const durationDisplay = durationStr;
      return interaction.reply({
        content: `Channel locked for ${durationDisplay} 🔒`,
        flags: 64,
      });
    } catch (error) {
      logger.error(`Timed lockdown error: ${error.message}`);
      return interaction.reply({
        content: 'Failed to lock the channel. Please try again.',
        flags: 64,
      });
    }
  },

  // Exported functions for ready.js recovery
  scheduleUnlockIfActive,
  unlockChannelByRecord,
};

