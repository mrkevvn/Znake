'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const logger = require('../utils/logger');
const { formatDuration } = require('../utils/formatters');
const config = require('../config.json');

module.exports = {
  name: 'guildMemberRemove',
  once: false,
  async execute(client, member) {
    if (!member || !member.guild || !member.user) {
      logger.warn('[guildMemberRemove] Received incomplete member object. Skipping execution.');
      return;
    }

    if (member.partial) {
      await member.fetch().catch(() => {});
    }

    try {
      await _sendGoodbye(member);
      await _logMemberLeave(member);
    } catch (err) {
      logger.error(`[guildMemberRemove] Error processing leave for ${member.id}: ${err?.message || err}`);
    }
  },
};

function _getWelcomeConfig(guild) {
  if (!guild || !guild.id) return null;
  return db.getGuild('welcome', guild.id) || null;
}

function _parseTemplate(template, member, guild) {
  return (template || '')
    .replace(/{user}/g, member.toString())
    .replace(/{username}/g, member.user.username || 'Unknown')
    .replace(/{server}/g, guild.name)
    .replace(/{count}/g, guild.memberCount);
}

function _buildGoodbyeEmbed(member, guild) {
  const cfg = _getWelcomeConfig(guild);

  const leftAt = Date.now();
  const joinedAt = member.joinedTimestamp || null;
  const timeSpentStr = joinedAt ? formatDuration(leftAt - joinedAt) : 'Unknown';
  const joinedAtSec = joinedAt ? Math.floor(joinedAt / 1000) : null;
  const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 256 });

  const memberCount = guild.memberCount;

  const defaultDescription = `**${member.user.username}** has left **${guild.name}**. We now have **${memberCount}** members.`;

  return new EmbedBuilder()
    .setColor(config.errorColor || '#ED4245')
    .setTitle(cfg?.goodbyeTitle || `👋 Goodbye ${member.user.username}!`)
    .setDescription(cfg?.goodbyeMessage ? _parseTemplate(cfg.goodbyeMessage, member, guild) : defaultDescription)
    .setThumbnail(avatarUrl)
    .addFields(
      {
        name: '👤 Member Information',
        value: [`**Username:** ${member.user.username}`, `**ID:** ${member.id}`].join('\n'),
        inline: true,
      },
      {
        name: '📅 Journey',
        value: [
          `**Joined:** ${joinedAtSec ? `<t:${joinedAtSec}:F>` : 'Unknown'}`,
          `**Left:** <t:${Math.floor(leftAt / 1000)}:F>`,
          `**Time in Server:** ${timeSpentStr}`,
        ].join('\n'),
        inline: true,
      }
    )
    .setTimestamp()
    .setFooter({ text: cfg?.goodbyeTitle ? `${guild.name} • Farewell` : `${guild.name} • Member Count: ${memberCount}` });
}

async function _sendGoodbye(member) {
  const guild = member.guild;
  if (!guild) return;

  const cfg = _getWelcomeConfig(guild);
  if (!cfg?.goodbyeEnabled || !cfg.goodbyeChannelId) return;

  const channel = guild.channels.cache.get(cfg.goodbyeChannelId);
  if (!channel) return;

  const embed = _buildGoodbyeEmbed(member, guild);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function _logMemberLeave(member) {
  const guild = member.guild;
  if (!guild) return;

  const logChannels = db.getGuild('log_channels', guild.id);
  const logChannelId = logChannels?.moderation;
  const channel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
  if (!channel) return;

  const leftAt = Date.now();
  const leftAtSec = Math.floor(leftAt / 1000);

  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.errorColor || '#ED4245')
          .setTitle('👋 Member Left')
          .setDescription(`**${member.user.tag}** (${member.id}) left **${guild.name}**.`)
          .addFields({ name: '🕒 Left', value: `<t:${leftAtSec}:F>`, inline: true })
          .setTimestamp(),
      ],
    })
    .catch(() => {});
}
