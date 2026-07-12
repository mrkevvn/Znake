// Moderation logging utility - sends action logs to the configured mod log channel
const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const logger = require('./logger');
const config = require('../config.json');
const { buildAuditEmbed } = require('../commands/logging/auditLogger');

function displayName(user) {
  return user.globalName || user.username;
}

async function logModerationAction(client, guild, action, target, moderator, reason, extra = {}) {
  try {
    const logChannels = db.getGuild('log_channels', guild.id);
    if (!logChannels.moderation) return;
    const channel = guild.channels.cache.get(logChannels.moderation);
    if (!channel) return;

    const embed = buildAuditEmbed(client, guild, action, target, moderator, reason, extra);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error(`Mod log error: ${err.message}`);
  }
}

module.exports = { logModerationAction };
