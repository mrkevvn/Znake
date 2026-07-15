'use strict';

const { REST, Routes, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config.json');

const PROCESSED_GUILDS = new Map(); // guildId -> timestamp for TTL cleanup
const PROCESSED_GUILDS_TTL = 60_000; // 1 minute

module.exports = {
  name: 'guildCreate',
  once: false,

  async execute(client, guild) {
    // Cleanup stale entries
    const now = Date.now();
    for (const [id, ts] of PROCESSED_GUILDS) {
      if (now - ts > PROCESSED_GUILDS_TTL) PROCESSED_GUILDS.delete(id);
    }

    if (PROCESSED_GUILDS.has(guild.id)) {
      logger.warn(`[guildCreate] Duplicate event blocked for ${guild.name} (${guild.id})`);
      return;
    }
    PROCESSED_GUILDS.set(guild.id, Date.now());

    logger.info(`Joined new guild: ${guild.name} (${guild.id}) — deploying commands...`);

    const token = config.token;
    const clientId = config.clientId;

    if (!token || !clientId) {
      logger.warn(`Skipping command deploy for ${guild.name}: missing token or clientId.`);
      return;
    }

    try {
      let welcomeChannel = guild.systemChannel;

      if (!welcomeChannel) {
        const botMember = await guild.members.fetchMe().catch(() => null);
        welcomeChannel = guild.channels.cache.find(ch => {
          if (ch.type !== ChannelType.GuildText) return false;
          const perms = botMember ? ch.permissionsFor(botMember) : null;
          return perms?.has('SendMessages') && perms?.has('EmbedLinks');
        }) ?? null;
      }

      if (welcomeChannel) {
        const embed = new EmbedBuilder()
          .setColor(config.embedColor || '#5865F2')
          .setTitle('🚀 Bot Successfully Activated')
          .setDescription(
            'Thank you for adding this bot to your server.\n\n' +
            'This system is now ready to assist your community with automation, ticketing, and moderation tools.\n\n' +
            'To get started, complete the setup steps below.'
          )
          .addFields(
            {
              name: '📊 System Status', value: [
                '• Ticket System: Ready',
                '• Moderation Tools: Active',
                '• Utility Commands: Loaded',
              ].join('\n'), inline: false
            },
            {
              name: '⚙️ Required Setup', value: [
                '• Run `/setticketchannel` to configure ticket system',
                '• Assign staff roles for proper access control',
              ].join('\n'), inline: false
            },
            {
              name: '📦 Available Features', value: [
                '• Advanced Ticket Panel System',
                '• Category-based support routing',
                '• Transcript system',
                '• Anti-spam protections',
              ].join('\n'), inline: false
            },
          )
          .setFooter({ text: 'Powered by Support Automation System' })
          .setTimestamp();

        await welcomeChannel.send({ embeds: [embed] });
      }
    } catch { /* welcome message is best-effort */ }
  },
};
