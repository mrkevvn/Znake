'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const db = require('./database');
const config = require('../config.json');

const PRIORITIES = {
  low:      { label: 'Low',      emoji: '🟢', color: '#57F287' },
  medium:   { label: 'Medium',   emoji: '🟡', color: '#FEE75C' },
  high:     { label: 'High',     emoji: '🔴', color: '#ED4245' },
  critical: { label: 'Critical', emoji: '🚨', color: '#FF914D' },
};

const STATUSES = {
  open:             { label: 'Open',            emoji: '🟢' },
  claimed:          { label: 'Claimed',          emoji: '🔵' },
  in_progress:      { label: 'In Progress',      emoji: '🟣' },
  waiting_for_user: { label: 'Waiting For User', emoji: '🟡' },
  resolved:         { label: 'Resolved',         emoji: '✅' },
  closed:           { label: 'Closed',           emoji: '🔴' },
};

const CATEGORIES = {
  technical:   { label: 'Technical Support',    emoji: '🛠', description: 'Get help with technical issues or errors' },
  bug:         { label: 'Bug Report',           emoji: '🐛', description: 'Report a bug or glitch you have found' },
  report:      { label: 'User Report',          emoji: '🚨', description: 'Report a user violating the community rules' },
  billing:     { label: 'Billing / Purchase',   emoji: '💳', description: 'Inquiries about purchases, payments, or billing' },
  partnership: { label: 'Partnership Request',  emoji: '🤝', description: 'Submit a partnership or collaboration request' },
  staffapp:    { label: 'Staff Application',    emoji: '📢', description: 'Apply to join the staff team' },
  security:    { label: 'Account / Security',   emoji: '🔐', description: 'Account or security-related issues' },
  suggestion:  { label: 'Suggestions',          emoji: '💡', description: 'Share your ideas and feature suggestions' },
  config:      { label: 'Configuration Help',   emoji: '⚙️', description: 'Need help configuring settings or bot setup' },
  investment:  { label: 'Investments',           emoji: '📈', description: 'Manage investment systems, profit tracking, financial tools, and bot economy features' },
  other:       { label: 'Other Request',        emoji: '📦', description: 'Anything not covered by the categories above' },
};

function generateTicketId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const id = `TICK-${suffix}`;
  const all = db.read('tickets');
  const clash = Object.values(all).some(g => g && typeof g === 'object' && g[id]);
  return clash ? generateTicketId() : id;
}

function addTimeline(ticket, event, actorId = null) {
  if (!ticket.timeline) ticket.timeline = [];
  ticket.timeline.push({ event, actorId, timestamp: Date.now() });
}

function logAction(guildId, action, ticketId, actorId, details = '') {
  // Ticket timeline is stored on the ticket object itself.
  // This function is kept for backward compatibility with existing calls,
  // but it no longer persists a separate "ticketlogs" history.
}

function getTicketByChannel(guildId, channelId) {
  const all = db.read('tickets');
  const guild = all[guildId];
  if (!guild) return null;
  return Object.values(guild).find(t => t.channelId === channelId) || null;
}

function buildTicketEmbed(ticket) {
  const priority = PRIORITIES[ticket.priority] || PRIORITIES.medium;
  const status   = STATUSES[ticket.status]    || STATUSES.open;
  const catMeta  = CATEGORIES[ticket.category] || CATEGORIES.technical;

  // Custom styling for User Report Cases
  if (ticket.category === 'report' && ticket.caseId) {
    const cases = db.read('cases');
    const caseData = cases[ticket.caseId];
    if (caseData) {
      const embed = new EmbedBuilder()
        .setColor(priority.color)
        .setTitle(`🚨 User Report Case — ${ticket.id}`)
        .setDescription(`A user report has been filed and linked to this ticket.`)
        .addFields(
          { name: '👤 Reporter',     value: `<@${caseData.reporterId}>`, inline: true },
          { name: '🎯 Reported User', value: `<@${caseData.reportedUserId}>`, inline: true },
          { name: '🔖 Case ID',       value: `\`${caseData.caseId}\``, inline: true },
          { name: '⚡ Priority',      value: `${priority.emoji} ${priority.label}`, inline: true },
          { name: '📊 Case Status',   value: `**${caseData.status}**`, inline: true },
          { name: '🕒 Filed At',      value: `<t:${Math.floor(caseData.createdAt / 1000)}:F>`, inline: true },
          { name: '📝 Reason',        value: caseData.reason || 'No reason provided', inline: false }
        );
      if (caseData.evidence) {
        embed.addFields({ name: '📎 Evidence / Attachments', value: caseData.evidence, inline: false });
      }
      if (ticket.assignedTo || ticket.claimedBy) {
        const staff = ticket.assignedTo || ticket.claimedBy;
        embed.addFields({ name: '🛡️ Handling Staff', value: `<@${staff}>`, inline: true });
      }
      if (ticket.timeline && ticket.timeline.length > 0) {
        const recent = ticket.timeline.slice(-5);
        embed.addFields({
          name: '📋 Timeline',
          value: recent.map(e => `<t:${Math.floor(e.timestamp / 1000)}:t> — ${e.event}`).join('\n'),
          inline: false,
        });
      }
      embed.setFooter({ text: `Ticket #${ticket.number} • Case ${caseData.caseId}` }).setTimestamp();
      return embed;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(priority.color)
    .setTitle('🎫 Ticket Created')
    .setDescription(ticket.reason || 'No reason provided')
    .addFields(
      { name: '👤 User',       value: `<@${ticket.userId}> (${ticket.userTag})`,                inline: true },
      { name: '📂 Category',   value: `${catMeta.emoji} ${catMeta.label}`,                       inline: true },
      { name: '⚡ Priority',   value: `${priority.emoji} ${priority.label}`,                     inline: true },
      { name: `${status.emoji} Status`, value: status.label,                                     inline: true },
      { name: '🕒 Created At', value: `<t:${Math.floor(ticket.createdAt / 1000)}:F>`,            inline: true },
      { name: '⏱️ Last Activity', value: `<t:${Math.floor((ticket.lastActivity || ticket.createdAt) / 1000)}:R>`, inline: true },
    );

  if (ticket.assignedTo) embed.addFields({ name: '🙋 Assigned To', value: `<@${ticket.assignedTo}>`, inline: true });
  if (ticket.claimedBy)  embed.addFields({ name: '🔒 Claimed By',  value: `<@${ticket.claimedBy}>`,  inline: true });

  if (ticket.timeline && ticket.timeline.length > 0) {
    const recent = ticket.timeline.slice(-5);
    embed.addFields({
      name: '📋 Timeline',
      value: recent.map(e => `<t:${Math.floor(e.timestamp / 1000)}:t> — ${e.event}`).join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: `Ticket #${ticket.number} • ${ticket.id}` }).setTimestamp();
  return embed;
}

function buildActionRow(ticket) {
  const isClosed = ticket.status === 'closed';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_btn')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId('ticket_claim_btn')
      .setLabel(ticket.claimedBy ? 'Unclaim' : 'Claim Ticket')
      .setEmoji('👋')
      .setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId('ticket_transcript_btn')
      .setLabel('Transcript')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosed),
    new ButtonBuilder()
      .setCustomId('ticket_notify_btn')
      .setLabel('Notify User')
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosed),
  );
}

// ── Generate transcript text ───────────────────────────────────────────────────
async function generateTranscript(guild, ticket, messages, closedBy, reason) {
  const catMeta = CATEGORIES[ticket.category] || CATEGORIES.general;
  const sorted = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let text = `${'='.repeat(60)}\n  TICKET TRANSCRIPT\n${'='.repeat(60)}\n`;
  text += `Ticket ID:  ${ticket.id}\n`;
  text += `Number:     #${ticket.number}\n`;
  text += `Category:   ${catMeta.label}\n`;
  text += `Creator:    ${ticket.userTag}\n`;
  text += `Reason:     ${ticket.reason}\n`;
  text += `Priority:   ${(PRIORITIES[ticket.priority] || PRIORITIES.medium).label}\n`;
  text += `Closed By:  ${closedBy.username}\n`;
  text += `Close Reason: ${reason}\n`;
  text += `Opened:     ${new Date(ticket.createdAt).toUTCString()}\n`;
  text += `Closed:     ${new Date(ticket.closedAt).toUTCString()}\n\n`;

  // Add linked case ID if applicable
  if (ticket.caseId) {
    text += `Linked Case: ${ticket.caseId}\n\n`;
  }

  if (ticket.tags?.length) {
    text += `Tags:       ${ticket.tags.join(', ')}\n`;
  }
  if (ticket.notes?.length) {
    text += `${'─'.repeat(60)}\n  STAFF NOTES (${ticket.notes.length})\n${'─'.repeat(60)}\n`;
    for (const [i, n] of ticket.notes.entries()) {
      text += `[${new Date(n.timestamp).toISOString()}] Note #${i + 1} by ${n.authorTag}: ${n.text}\n`;
    }
    text += `\n`;
  }
  text += `${'─'.repeat(60)}\n  TIMELINE\n${'─'.repeat(60)}\n`;
  for (const e of (ticket.timeline || [])) {
    text += `[${new Date(e.timestamp).toISOString()}] ${e.event}\n`;
  }
  text += `\n${'─'.repeat(60)}\n  MESSAGES (${sorted.length})\n${'─'.repeat(60)}\n\n`;
  for (const m of sorted) {
    const name = m.author.globalName || m.author.username;
    const ts = new Date(m.createdTimestamp).toISOString();
    const content = m.content || (m.embeds.length ? '[Embed]' : '') || (m.attachments.size ? '[Attachment]' : '[No content]');
    text += `[${ts}] ${name}: ${content}\n`;
  }
  text += `\n${'='.repeat(60)}\n  END OF TRANSCRIPT\n${'='.repeat(60)}\n`;
  return text;
}

async function sendTranscript(targetChannel, ticket, client, guild, user, reason) {
  const sourceChannel = guild.channels.cache.get(ticket.channelId);
  const messages = sourceChannel
    ? [...(await sourceChannel.messages.fetch({ limit: 100 })).values()]
    : [];
  const text = await generateTranscript(guild, ticket, messages, user, reason);
  const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `transcript-${ticket?.id || targetChannel.name}.txt` });

  await targetChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('Transcript Generated')
      .setDescription(`Transcript for **${ticket?.id || targetChannel.name}**`)
      .addFields(
        { name: 'Ticket ID', value: ticket?.id || targetChannel.name, inline: true },
        { name: 'Messages', value: messages.length.toString(), inline: true },
        { name: 'Generated By', value: user.username, inline: true },
      )
      .setTimestamp()],
    files: [file],
  });

  return { messageCount: messages.length };
}

async function updateTicketEmbed(guild, ticket) {
  if (!ticket.ticketMessageId || !ticket.channelId) return;
  const ch = guild.channels.cache.get(ticket.channelId);
  if (!ch) return;
  const msg = await ch.messages.fetch(ticket.ticketMessageId).catch(() => null);
  if (!msg) return;
  await msg.edit({
    embeds: [buildTicketEmbed(ticket)],
    components: ticket.status === 'closed' ? [] : [buildActionRow(ticket)],
  }).catch(() => {});
}

async function closeTicket(guild, ticket, closedBy, reason, client) {
  const tickets = db.read('tickets');

  ticket.status      = 'closed';
  ticket.closedAt    = Date.now();
  ticket.closedBy    = closedBy.id;
  ticket.closeReason = reason;
  addTimeline(ticket, `Closed by ${closedBy.username}: ${reason}`, closedBy.id);
  if (tickets[guild.id]) tickets[guild.id][ticket.id] = ticket;
  db.write('tickets', tickets);
  logAction(guild.id, 'CLOSED', ticket.id, closedBy.id, reason);

  if (ticket.caseId) {
    const cases = db.read('cases');
    const caseData = cases[ticket.caseId];
    if (caseData) {
      caseData.status = 'Closed';
      caseData.resolvedAt = Date.now();
      caseData.resolution = reason;
      caseData.timeline = caseData.timeline || [];
      caseData.timeline.push({ event: `Case closed via ticket closure by ${closedBy.username}`, actorId: closedBy.id, timestamp: Date.now() });
      cases[ticket.caseId] = caseData;
      db.write('cases', cases);
    }
  }

  const ch = guild.channels.cache.get(ticket.channelId);


  if (ch) {
    if (ticket.ticketMessageId) {
      const msg = await ch.messages.fetch(ticket.ticketMessageId).catch(() => null);
      if (msg) await msg.edit({ embeds: [buildTicketEmbed(ticket)], components: [] }).catch(() => {});
    }



    const creator = await client.users.fetch(ticket.userId).catch(() => null);
    if (creator) {
      creator.send({
        embeds: [new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('🔒 Your Ticket Was Closed')
          .setDescription(`Your ticket **${ticket.id}** in **${guild.name}** has been closed.\n\n📝 **Reason:** ${reason}`)
          .setTimestamp()],
      }).catch(() => {});
    }

    setTimeout(() => ch.delete(`Ticket closed by ${closedBy.username}`).catch(() => {}), 5000);
  }
}

function syncLinkedCase(ticket) {
  if (!ticket.caseId) return;
  const cases = db.read('cases');
  const caseData = cases[ticket.caseId];
  if (caseData) {
    caseData.assignedStaffId = ticket.assignedTo || ticket.claimedBy || null;

    const statusMap = {
      open: 'Open',
      claimed: 'Assigned',
      in_progress: 'Under Review',
      waiting_for_user: 'Under Review',
      resolved: 'Resolved',
      closed: 'Closed',
    };
    caseData.status = statusMap[ticket.status] || 'Open';

    cases[ticket.caseId] = caseData;
    db.write('cases', cases);
  }
}

function buildCategorySelectOptions() {
  return Object.entries(CATEGORIES).map(([value, cat]) => ({
    label: cat.label,
    value,
    emoji: cat.emoji,
    description: (cat.description || `Open a ${cat.label.toLowerCase()} ticket`).slice(0, 100),
  }));
}

module.exports = {
  PRIORITIES, STATUSES, CATEGORIES,
  generateTicketId, addTimeline, logAction,
  getTicketByChannel, buildTicketEmbed, buildActionRow,
  updateTicketEmbed, closeTicket, generateTranscript,
  buildCategorySelectOptions,
  sendTranscript,
  syncLinkedCase,
};
