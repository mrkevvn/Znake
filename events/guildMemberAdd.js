'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const logger = require('../utils/logger');
const config = require('../config.json');

module.exports = {
  name: 'guildMemberAdd',
  once: false,
  async execute(client, member) {
    if (!member || !member.guild || !member.user) {
      logger.warn('[guildMemberAdd] Received incomplete member object. Skipping execution.');
      return;
    }

    try {
      await _autoAssignRole(member);
      await _sendWelcome(member);
      await _sendWelcomeDm(member);
      await _logMemberJoin(member);
    } catch (err) {
      logger.error(`[guildMemberAdd] Error processing join for ${member.id}: ${err?.message || err}`);
    }
  },
};

function _getWelcomeConfig(guild) {
  if (!guild || !guild.id) return null;
  return db.getGuild('welcome', guild.id) || null;
}

function _getAutoroleConfig(guild) {
  if (!guild || !guild.id) return null;
  return db.getGuild('autorole', guild.id) || null;
}

async function _autoAssignRole(member) {
  const guild = member.guild;
  if (!guild) return;

  const autorole = _getAutoroleConfig(guild);
  if (!autorole?.enabled || !autorole.roleId) return;

  try {
    const role = guild.roles.cache.get(autorole.roleId);
    if (!role) return;

    const botMember = await guild.members.fetchMe().catch(() => null);
    if (!botMember) return;
    if (botMember.roles.highest.comparePositionTo(role) <= 0) return;

    await member.roles.add(role).catch(() => {});
  } catch (err) {
    logger.warn(`[guildMemberAdd] Auto-assign role failed: ${err.message}`);
  }
}

function _parseTemplate(template, member, guild) {
  return (template || '')
    .replace(/{user}/g, member.toString())
    .replace(/{username}/g, member.user.username)
    .replace(/{server}/g, guild.name)
    .replace(/{count}/g, guild.memberCount);
}

function _buildWelcomeEmbed(member, guild) {
  const cfg = _getWelcomeConfig(guild);

  const memberCount = guild.memberCount;
  const accountDays = Math.floor(
    (Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000)
  );
  const joinedAtSec = Math.floor((member.joinedTimestamp || Date.now()) / 1000);
  const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 256 });

  const defaultDescription = `Hey ${member}, welcome to **${guild.name}**! You are **member #${memberCount}**. We're excited to have you!`;

  const embed = new EmbedBuilder()
    .setColor(config.successColor || '#57F287')
    .setTitle(cfg?.title || `🎉 Welcome to ${guild.name}!`)
    .setDescription(cfg?.message ? _parseTemplate(cfg.message, member, guild) : defaultDescription)
    .setThumbnail(avatarUrl)
    .addFields(
      {
        name: '👤 Member Information',
        value: [
          `**Username:** ${member.user.username}`,
          `**ID:** ${member.user.id}`,
          `**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          `**Joined:** <t:${joinedAtSec}:F>`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📊 Server Stats',
        value: [
          `**Total Members:** ${memberCount}`,
          `**Account Age:** ${accountDays} day${accountDays !== 1 ? 's' : ''}`,
        ].join('\n'),
        inline: true,
      }
    )
    .setTimestamp();

  if (cfg?.footer) {
    embed.setFooter({ text: _parseTemplate(cfg.footer, member, guild) });
  } else {
    embed.setFooter({ text: `${guild.name} • Member #${memberCount}`, iconURL: guild.iconURL() || undefined });
  }

  return embed;
}

async function _sendWelcome(member) {
  const guild = member.guild;
  if (!guild) return;

  const cfg = _getWelcomeConfig(guild);
  if (!cfg?.enabled || !cfg.channelId) return;

  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel) return;

  const embed = _buildWelcomeEmbed(member, guild);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function _sendWelcomeDm(member) {
  const guild = member.guild;
  if (!guild) return;

  const cfg = _getWelcomeConfig(guild);
  if (!cfg?.dmEnabled) return;

  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.successColor || '#57F287')
          .setTitle(`🎉 Welcome to ${guild.name}!`)
          .setDescription(
            `Hey ${member.user.username}, welcome to **${guild.name}**!\n\n**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n**Joined:** <t:${Math.floor((member.joinedTimestamp || Date.now()) / 1000)}:F>`
          )
          .setTimestamp()
          .setFooter({ text: guild.name }),
      ],
    });
  } catch {
    /* DM closed or unavailable */
  }
}

async function _logMemberJoin(member) {
  const guild = member.guild;
  if (!guild) return;

  const logChannels = db.getGuild('log_channels', guild.id);
  const logChannelId = logChannels?.moderation;
  const channel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
  if (!channel) return;

  const joinedAtSec = Math.floor((member.joinedTimestamp || Date.now()) / 1000);

  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.successColor || '#57F287')
          .setTitle('✅ Member Joined')
          .setDescription(`**${member.user.tag}** (${member.id}) joined **${guild.name}**.`)
          .addFields({ name: '🕒 Joined', value: `<t:${joinedAtSec}:F>`, inline: true })
          .setTimestamp(),
      ],
    })
    .catch(() => {});
}
