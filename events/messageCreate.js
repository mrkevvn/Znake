// Message Create - anti-spam, anti-link, anti-invite enforcement + watchlist alerts + XP
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const antiSpam = require('../handlers/antiSpamHandler');
const db = require('../utils/database');
const logger = require('../utils/logger');
const config = require('../config.json');
const {
  getLevelData,
  randomXp,
  XP_COOLDOWN_MS,
  levelTier,
  XP_REPEAT_WINDOW_MS,
  XP_REPEAT_SIMILARITY,
} = require('../utils/xp');
const { getAppealCaseByChannel, getOpenAppealByUser, addTimeline } = require('../utils/caseManager');

// In-memory XP cooldown: Map<`${guildId}:${userId}`, timestamp>
const xpCooldowns = new Map();
const recentlyForwardedMessageIds = new Set();

function markMessageForwarded(messageId) {
  if (!messageId) return true;
  if (recentlyForwardedMessageIds.has(messageId)) return false;
  recentlyForwardedMessageIds.add(messageId);
  setTimeout(() => recentlyForwardedMessageIds.delete(messageId), 60_000);
  return true;
}

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(client, message) {
    if (message.author.bot) return;

    // ── DM bridge for open appeal cases ───────────────────────────────────────
    if (!message.guild) {
      if (!markMessageForwarded(message.id)) return;

      const appealCase = getOpenAppealByUser(message.author.id);
      if (!appealCase) return;
      if (['Closed', 'Resolved', 'Rejected'].includes(appealCase.status)) return;

      const caseChannelId = appealCase.channelId;
      if (!caseChannelId) return;

      const caseChannel = await client.channels.fetch(caseChannelId).catch(() => null);
      if (!caseChannel) return;

      const userContent = message.content?.trim() || '*[No text content]*';
      const dmEmbed = new EmbedBuilder()
        .setColor(config.infoColor)
        .setTitle(`Appeal DM — ${appealCase.caseId}`)
        .addFields(
          { name: '👤 User', value: `${message.author} (\`${message.author.tag}\`)`, inline: false },
          { name: '💬 Message', value: userContent.substring(0, 1024), inline: false },
          { name: '🕒 Sent', value: `<t:${Math.floor(message.createdAt.valueOf() / 1000)}:R>`, inline: true },
          { name: '🆔 Appeal ID', value: `\`${appealCase.caseId}\``, inline: true }
        )
        .setFooter({ text: 'Forwarded from DM' })
        .setTimestamp();

      if (message.attachments.size) {
        dmEmbed.addFields({
          name: '📎 Attachments',
          value: message.attachments.map(att => att.url).join('\n').substring(0, 1024),
          inline: false,
        });
      }

      await caseChannel.send({ embeds: [dmEmbed] }).catch(() => null);
      addTimeline(appealCase, 'User replied via DM', message.author.id);
      const cases = db.read('cases');
      cases[appealCase.caseId] = appealCase;
      db.write('cases', cases);

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('✅ Message Sent')
            .setDescription('Your message has been forwarded to staff on your appeal case.')
            .setTimestamp(),
        ],
      }).catch(() => null);

      return;
    }

    const appealCase = getAppealCaseByChannel(message.channel.id);
    if (appealCase) {
      if (['Closed', 'Resolved', 'Rejected'].includes(appealCase.status)) return;
      if (!markMessageForwarded(message.id)) return;

      const targetUser = await client.users.fetch(appealCase.reporterId).catch(() => null);
      if (targetUser) {
        const staffEmbed = new EmbedBuilder()
          .setColor(config.infoColor)
          .setTitle(`Staff message — ${appealCase.caseId}`)
          .addFields(
            { name: '📌 Appeal', value: `\`${appealCase.caseId}\``, inline: true },
            { name: '👤 From', value: `${message.author} (\`${message.author.tag}\`)`, inline: true },
            { name: '💬 Message', value: message.content?.substring(0, 1024) || '*[No text content]*', inline: false }
          )
          .setFooter({ text: `From ${message.guild.name}` })
          .setTimestamp();

        if (message.attachments.size) {
          staffEmbed.addFields({
            name: '📎 Attachments',
            value: message.attachments.map(att => att.url).join('\n').substring(0, 1024),
            inline: false,
          });
        }

        const dmSent = await targetUser.send({ embeds: [staffEmbed] }).catch(() => null);
        if (!dmSent) {
          const warnEmbed = new EmbedBuilder()
            .setColor(config.warningColor)
            .setDescription(`Unable to DM <@${appealCase.reporterId}>. They may have DMs disabled.`)
            .setTimestamp();
          message.channel.send({ embeds: [warnEmbed] }).catch(() => null);
        }
      }
    }

    // ── Watchlist alert ───────────────────────────────────────────────────────
    const watchlist = db.read('watchlist');
    const guildWatch = watchlist[message.guild.id];
    if (guildWatch && guildWatch[message.author.id]) {
      const entry = guildWatch[message.author.id];
      const channelId = entry.alertChannelId;
      if (channelId) {
        const alertChannel = message.guild.channels.cache.get(channelId);
        if (alertChannel) {
          const embed = new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('👁️ Watched User — Message Detected')
            .addFields(
              { name: 'User', value: `${message.author.globalName || message.author.username} (<@${message.author.id}>)`, inline: true },
              { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
              { name: 'Watch Reason', value: entry.reason, inline: false },
              { name: 'Message', value: message.content.substring(0, 1000) || '*[No text content]*', inline: false },
              { name: 'Jump to Message', value: `[Click here](${message.url})`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

          alertChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }
    }

    // ── Message count tracking ─────────────────────────────────────────────────
    const counts = db.read('message_counts');
    if (!counts[message.guild.id]) counts[message.guild.id] = {};
    const guildCounts = counts[message.guild.id];
    if (!guildCounts[message.author.id]) {
      guildCounts[message.author.id] = { count: 0, lastSeen: null };
    }
    guildCounts[message.author.id].count += 1;
    guildCounts[message.author.id].lastSeen = Date.now();
    db.write('message_counts', counts);

    // ── XP / Leveling ──────────────────────────────────────────────────────────
    // XP rules (tuned to prevent farming)
    const msgContent = (message.content || '').trim();

    // Eligibility: meaningful message only
    if (msgContent.length < 5) {
      await antiSpam.process(message);
      return;
    }

    // Ignore slash/command-like messages (interactions handled in interactionCreate)
    if (msgContent.startsWith('/') || msgContent.startsWith('!')) {
      await antiSpam.process(message);
      return;
    }

    // Anti-repeat suppression (near-identical)
    if (!this._xpRepeatTracker) this._xpRepeatTracker = new Map();

    const normalized = msgContent.toLowerCase().replace(/\s+/g, ' ');
    const repeatKey = `${message.guild.id}:${message.author.id}:xp_repeat`;
    const now = Date.now();

    const recent = this._xpRepeatTracker.get(repeatKey) || [];
    const pruned = recent.filter(r => now - r.at <= XP_REPEAT_WINDOW_MS);

    // Clean up empty entries to prevent memory leak
    if (pruned.length === 0) {
      this._xpRepeatTracker.delete(repeatKey);
    }

    function similarityScore(a, b) {
      const at = a.split(' ').filter(Boolean);
      const bt = b.split(' ').filter(Boolean);
      if (!at.length || !bt.length) return 0;

      const aSet = new Set(at);
      const bSet = new Set(bt);
      let inter = 0;
      for (const t of aSet) if (bSet.has(t)) inter++;
      return inter / Math.max(aSet.size, bSet.size);
    }

    const isNearDuplicate = pruned.some(r => similarityScore(normalized, r.text) >= XP_REPEAT_SIMILARITY);

    // Record this message in suppression window
    pruned.push({ at: now, text: normalized });
    this._xpRepeatTracker.set(repeatKey, pruned);

    if (isNearDuplicate) {
      await antiSpam.process(message);
      return;
    }

    // Cooldown per user
    const cooldownKey = `${message.guild.id}:${message.author.id}`;
    const lastXpAt = xpCooldowns.get(cooldownKey) || 0;
    if (now - lastXpAt < XP_COOLDOWN_MS) {
      await antiSpam.process(message);
      return;
    }
    xpCooldowns.set(cooldownKey, now);

    // Award XP (random 5–15 via utils/xp.js)
    const levelsDb = db.read('levels');
    if (!levelsDb[message.guild.id]) levelsDb[message.guild.id] = {};
    const guildLevels = levelsDb[message.guild.id];
    if (!guildLevels[message.author.id]) guildLevels[message.author.id] = { xp: 0, level: 0 };

    const userData = guildLevels[message.author.id];
    const oldLevel = getLevelData(userData.xp).level;

    userData.xp += randomXp();
    const newLevelData = getLevelData(userData.xp);
    userData.level = newLevelData.level;

    db.write('levels', levelsDb);

    // Level-up notifications: never post in public chat
    if (newLevelData.level > oldLevel) {
      const lvlCfg = db.read('level_config');
      const guildCfg = lvlCfg[message.guild.id] || {};

      if (guildCfg.enabled !== false) {
        const { label: tierLabel, color: tierColor } = levelTier(newLevelData.level);
        const storedChannelId = guildCfg.levelUpChannelId;

        const embed = new EmbedBuilder()
          .setColor(tierColor)
          .setAuthor({
            name: `${message.member?.displayName || message.author.username} leveled up!`,
            iconURL: message.author.displayAvatarURL({ dynamic: true }),
          })
          .setDescription(
            [
              `## 🎉 Level Up!`,
              `<@${message.author.id}> just reached **Level ${newLevelData.level}** ${tierLabel}`,
              '',
              `Keep chatting to climb the ranks! Use \`/rank\` to check your progress.`,
            ].join('\n')
          )
          .setFooter({ text: `Total XP: ${userData.xp.toLocaleString()}` })
          .setTimestamp();

        // 1) configured channel (dedicated bot-commands channel)
        if (storedChannelId) {
          let targetChannel = null;
          try {
            targetChannel = await client.channels.fetch(storedChannelId).catch(() => null);
          } catch (_) {
            targetChannel = null;
          }

          if (!targetChannel) {
            targetChannel = message.guild.channels.cache.get(storedChannelId) || null;
          }

          if (targetChannel && targetChannel.guildId === message.guild.id) {
            const botMember = message.guild.members.me;
            const permissions = targetChannel.permissionsFor(botMember);
            if (
              permissions &&
              permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
            ) {
              await targetChannel.send({ embeds: [embed] }).catch(() => {});
            }
          }
        } else {
          // 2) else DM user
          await client.users.fetch(message.author.id)
            .then(u => u.send({ embeds: [embed] }))
            .catch(() => {});
        }
        // 3) DM fails => silent skip (no public fallback)
      }
    }

    // ── Ticket last-activity tracking ─────────────────────────────────────────
    const ticketData = db.read('tickets');
    const guildTickets = ticketData[message.guild.id];
    if (guildTickets) {
      const activeTicket = Object.values(guildTickets).find(t => t.channelId === message.channel.id && t.status !== 'closed');
      if (activeTicket) {
        activeTicket.lastActivity = Date.now();
        activeTicket.inactivityWarned = false;
        ticketData[message.guild.id][activeTicket.id] = activeTicket;
        db.write('tickets', ticketData);
      }
    }

    // ── Security checks ───────────────────────────────────────────────────────
    await antiSpam.process(message);
  },
};

