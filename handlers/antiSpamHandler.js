// Anti-Spam Handler - tracks message frequency and auto-moderates spammers
const { PermissionFlagsBits } = require('discord.js');
const db = require('../utils/database');
const logger = require('../utils/logger');

const messageTracker = new Map();
const pendingTimers = new Set();
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW = 5000;
const TIMEOUT_DURATION = 60000;
const TRACKER_MAX_AGE = 30_000; // Clean entries older than 30s

function trackedSetTimeout(fn, ms) {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    fn();
  }, ms);
  pendingTimers.add(id);
  return id;
}

function cleanup() {
  for (const id of pendingTimers) clearTimeout(id);
  pendingTimers.clear();
}

async function process(message) {
  if (!message.guild || message.author.bot) return;

  const security = db.getGuild('security', message.guild.id);
  if (!security.antiSpam && !security.antiLink && !security.antiInvite) return;

  if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const botMember = message.guild.members.me;
  const name = message.author.globalName || message.author.username;

  const urlRegex = /(https?:\/\/[^\s]+)/i;
  const inviteRegex = /(discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9]+/i;

  if (security.antiInvite && inviteRegex.test(message.content)) {
    try {
      await message.delete();
      const m = await message.channel.send({ content: `${message.author}, Discord invite links are not allowed here.` });
      trackedSetTimeout(() => m.delete().catch(() => {}), 5000);
      logger.info(`Anti-invite: deleted message from ${name}`);
      return;
    } catch (err) {
      logger.error(`Anti-invite delete failed: ${err.message}`);
    }
  }

  if (security.antiLink && urlRegex.test(message.content)) {
    try {
      await message.delete();
      const m = await message.channel.send({ content: `${message.author}, links are not allowed here.` });
      trackedSetTimeout(() => m.delete().catch(() => {}), 5000);
      logger.info(`Anti-link: deleted message from ${name}`);
      return;
    } catch (err) {
      logger.error(`Anti-link delete failed: ${err.message}`);
    }
  }

  if (!security.antiSpam) return;

  const userId = message.author.id;
  const now = Date.now();

  if (!messageTracker.has(userId)) {
    messageTracker.set(userId, { count: 1, windowStart: now });
    // Periodic cleanup of stale tracker entries
    if (messageTracker.size > 1000) {
      for (const [key, val] of messageTracker) {
        if (now - val.windowStart > TRACKER_MAX_AGE) messageTracker.delete(key);
      }
    }
    return;
  }

  const tracker = messageTracker.get(userId);

  if (now - tracker.windowStart > SPAM_WINDOW) {
    tracker.count = 1;
    tracker.windowStart = now;
    return;
  }

  tracker.count++;

  if (tracker.count >= SPAM_THRESHOLD) {
    messageTracker.delete(userId);
    if (botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      try {
        await message.member.timeout(TIMEOUT_DURATION, 'Auto-mod: Spam detected');
        const m = await message.channel.send({ content: `${message.author} has been timed out for spamming.` });
        trackedSetTimeout(() => m.delete().catch(() => {}), 8000);
        logger.info(`Anti-spam: timed out ${name}`);
      } catch (err) {
        logger.error(`Anti-spam timeout failed: ${err.message}`);
      }
    }
  }
}

module.exports = { process, cleanup };
