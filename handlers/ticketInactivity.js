'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const config = require('../config.json');
const { closeTicket, addTimeline, logAction } = require('../utils/ticketManager');

function formatIdleTime(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

async function checkInactivity(client) {
  const tickets      = db.read('tickets');
  const ticketConfig = db.read('ticket_config');
  const now          = Date.now();

  for (const [guildId, guildTickets] of Object.entries(tickets)) {
    const cfg   = ticketConfig[guildId];
    const hours = cfg?.inactivityHours;
    if (!hours || hours <= 0) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const threshold  = hours * 3_600_000;
    const warnWindow = Math.min(threshold * 0.2, 3_600_000); // warn at 20% remaining, max 1h

    for (const ticket of Object.values(guildTickets)) {
      if (ticket.status === 'closed' || ticket.status === 'resolved') continue;

      const lastActive = ticket.lastActivity ?? ticket.createdAt;
      const idle       = now - lastActive;
      const remaining  = threshold - idle;

      const ch = guild.channels.cache.get(ticket.channelId);
      if (!ch) continue;

      // ── Auto-close ────────────────────────────────────────────────────────
      if (idle >= threshold) {
        await closeTicket(guild, ticket, client.user, 'Auto-closed due to inactivity', client);
        continue;
      }

      // ── Inactivity warning ────────────────────────────────────────────────
      if (!ticket.inactivityWarned && remaining <= warnWindow) {
        ticket.inactivityWarned = true;
        addTimeline(ticket, 'Inactivity warning sent', null);
        tickets[guildId][ticket.id] = ticket;
        db.write('tickets', tickets);
        logAction(guildId, 'INACTIVITY_WARNING', ticket.id, null, `Idle ${formatIdleTime(idle)}, closes in ~${formatIdleTime(remaining)}`);

        const closeTs = Math.floor((now + remaining) / 1000);

        await ch.send({
          content: `<@${ticket.userId}>`,
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setAuthor({
                name:    '⏰  Inactivity Warning',
                iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
              })
              .setTitle('This ticket is about to be closed')
              .setDescription(
                `Your ticket has been inactive for **${formatIdleTime(idle)}** with no response.\n\n` +
                `**It will be automatically closed <t:${closeTs}:R>** if there is no activity.\n\n` +
                `Simply send a message here to keep it open.`
              )
              .addFields(
                { name: '🎫 Ticket',       value: `\`${ticket.id}\``,             inline: true },
                { name: '⏱️ Idle For',     value: formatIdleTime(idle),           inline: true },
                { name: '🕐 Closes',       value: `<t:${closeTs}:R>`,             inline: true },
              )
              .setFooter({ text: 'Auto-close is configured by server staff  ·  Reply to keep this ticket open' })
              .setTimestamp(),
          ],
        }).catch(() => {});
      }
    }
  }
}

function startInactivityChecker(client) {
  // Run immediately on startup, then every 10 minutes
  checkInactivity(client).catch(() => {});
  const id = setInterval(() => checkInactivity(client).catch(() => {}), 10 * 60 * 1000);
  return id;
}

module.exports = { startInactivityChecker };
