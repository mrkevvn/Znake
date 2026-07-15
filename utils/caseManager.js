// Case Manager — shared utility for the full case/report system
const { EmbedBuilder } = require('discord.js');
const db = require('./database');

// ── Status badges ──────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  'Open':         { emoji: '🟡', color: '#FEE75C' },
  'Under Review': { emoji: '🔵', color: '#5865F2' },
  'Assigned':     { emoji: '🟣', color: '#9B59B6' },
  'Resolved':     { emoji: '✅', color: '#57F287' },
  'Closed':       { emoji: '🔴', color: '#ED4245' },
  'Rejected':     { emoji: '⛔', color: '#95A5A6' },
};

function normalizeStatusLabel(status) {
  const normalizedStatus = String(status || '').toLowerCase();
  return {
    'open': 'Open',
    'under review': 'Under Review',
    'assigned': 'Assigned',
    'resolved': 'Resolved',
    'closed': 'Closed',
    'rejected': 'Rejected',
  }[normalizedStatus] || String(status || 'Unknown');
}

function getStatusBadge(status) {
  const canonical = normalizeStatusLabel(status);
  return STATUS_BADGE[canonical] || { emoji: '⬜', color: '#95A5A6' };
}

// ── Case ID generator ──────────────────────────────────────────────────────────
function generateCaseId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  const cases = db.read('cases');
  return `CASE-${id}` in cases ? generateCaseId() : `CASE-${id}`;
}

// ── Timeline helper ────────────────────────────────────────────────────────────
function addTimeline(caseData, event, actorId = null) {
  if (!Array.isArray(caseData.timeline)) caseData.timeline = [];
  caseData.timeline.push({ event, actorId, timestamp: Date.now() });
}

// ── Case log ───────────────────────────────────────────────────────────────────
function logAction(action, caseId, actorId, details, guildId) {
  const logs = db.read('caselogs');
  if (!Array.isArray(logs.entries)) logs.entries = [];
  logs.entries.push({ action, caseId, actorId, details, guildId, timestamp: Date.now() });
  db.write('caselogs', logs);
}

// ── Build the main case embed ──────────────────────────────────────────────────
async function buildCaseEmbed(caseData, guild, client) {
  const { emoji, color } = getStatusBadge(caseData.status);

  // Resolve users
  const reporter = await client.users.fetch(caseData.reporterId).catch(() => null);
  const reported = caseData.reportedUserId
    ? await client.users.fetch(caseData.reportedUserId).catch(() => null)
    : null;
  const assigned = caseData.assignedStaffId
    ? await client.users.fetch(caseData.assignedStaffId).catch(() => null)
    : null;
  const moderator = caseData.moderatorId
    ? await client.users.fetch(caseData.moderatorId).catch(() => null)
    : null;

  const typeLabel = caseData.type === 'appeal' ? '📋 Appeal' : caseData.type === 'ban' ? '🔨 Ban' : '🚨 Report';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: reporter ? `${reporter.username} filed a ${caseData.type}` : 'Unknown Reporter',
      iconURL: reporter?.displayAvatarURL({ dynamic: true }),
    })
    .setTitle(`${typeLabel}  ·  \`${caseData.caseId}\``)
    .addFields(
      {
        name: '📊 Status',
        value: `${emoji} **${normalizeStatusLabel(caseData.status)}**`,
        inline: true,
      },
      {
        name: '📅 Opened',
        value: `<t:${Math.floor(caseData.createdAt / 1000)}:R>`,
        inline: true,
      },
      {
        name: caseData.resolvedAt ? '✅ Resolved' : '⏳ Resolution',
        value: caseData.resolvedAt
          ? `<t:${Math.floor(caseData.resolvedAt / 1000)}:R>`
          : '`Pending`',
        inline: true,
      },
      {
        name: '👤 Reporter',
        value: reporter ? `${reporter} (\`${reporter.username}\`)` : `\`${caseData.reporterId}\``,
        inline: true,
      },
      {
        name: caseData.type === 'appeal' ? '📌 Punishment Type' : '🎯 Subject User',
        value: caseData.type === 'appeal'
          ? `\`${caseData.punishmentType || 'Not specified'}\``
          : reported
            ? `${reported} (\`${reported.username}\`)`
            : `\`${caseData.reportedUserId || 'N/A'}\``,
        inline: true,
      },
      {
        name: '🛡️ Assigned Staff',
        value: assigned ? `${assigned} (\`${assigned.username}\`)` : '`Unassigned`',
        inline: true,
      },
      {
        name: '📝 Reason',
        value: caseData.reason || '*No reason provided*',
        inline: false,
      },
    );

  // Moderator (for bans)
  if (moderator) {
    embed.addFields({ name: '⚔️ Moderator', value: `${moderator} (\`${moderator.username}\`)`, inline: true });
  }

  // Evidence (optional)
  if (caseData.evidence) {
    embed.addFields({ name: '🔗 Evidence', value: caseData.evidence, inline: false });
  }

  // Resolution notes
  if (caseData.resolution) {
    embed.addFields({ name: '📋 Resolution Notes', value: caseData.resolution, inline: false });
  }

  // Linked IDs
  const linkedIds = [];
  if (caseData.appealId) linkedIds.push(`📋 Appeal: \`${caseData.appealId}\``);
  if (caseData.ticketId) linkedIds.push(`🎫 Ticket: \`${caseData.ticketId}\``);
  if (linkedIds.length > 0) {
    embed.addFields({ name: '🔗 Linked Cases', value: linkedIds.join('\n'), inline: false });
  }

  // Timeline
  if (caseData.timeline?.length) {
    const timelineText = caseData.timeline.map(e => {
      const ts = `<t:${Math.floor(e.timestamp / 1000)}:d>`;
      const actor = e.actorId ? ` — <@${e.actorId}>` : '';
      return `\`▸\` ${e.event}${actor} ${ts}`;
    }).join('\n');
    embed.addFields({ name: '📆 Timeline', value: timelineText.slice(0, 1024), inline: false });
  }

  embed.setFooter({ text: `Case ID: ${caseData.caseId}  •  ${guild?.name ?? 'Direct Message'}` }).setTimestamp();
  return embed;
}

// ── Try to update the original report-channel embed ───────────────────────────
async function updateReportEmbed(caseData, guild, client) {
  if (!caseData.reportChannelId || !caseData.reportMessageId) return;
  try {
    const channel = guild.channels.cache.get(caseData.reportChannelId);
    if (!channel) return;
    const message = await channel.messages.fetch(caseData.reportMessageId).catch(() => null);
    if (!message) return;
    const embed = await buildCaseEmbed(caseData, guild, client);
    await message.edit({ embeds: [embed] });
  } catch {}
}

// ── Create a ban case ─────────────────────────────────────────────────────────
function createBanCase(targetUserId, targetTag, reason, moderatorId, guildId) {
  const caseId = generateCaseId();
  const caseData = {
    caseId,
    type: 'ban',
    guildId,
    reporterId: moderatorId,
    reportedUserId: targetUserId,
    moderatorId,
    assignedStaffId: null,
    status: 'Resolved',
    reason: reason || 'No reason provided',
    evidence: null,
    resolution: `User banned by ${targetTag}`,
    timeline: [],
    createdAt: Date.now(),
    resolvedAt: Date.now(),
    reportMessageId: null,
    reportChannelId: null,
    appealId: null,
    ticketId: null,
    punishmentType: null,
  };
  addTimeline(caseData, 'Ban Case Created', moderatorId);
  return { caseId, caseData };
}

// ── Link appeal to case ────────────────────────────────────────────────────────
function linkAppealToCase(caseData, appealId) {
  caseData.appealId = appealId;
  addTimeline(caseData, `Appeal linked: ${appealId}`, null);
}

// ── Link ticket to case ────────────────────────────────────────────────────────
function linkTicketToCase(caseData, ticketId) {
  caseData.ticketId = ticketId;
  addTimeline(caseData, `Ticket linked: ${ticketId}`, null);
}

// ── Get case by ID or create wrapper ───────────────────────────────────────────
function getCaseById(caseId) {
  const cases = db.read('cases');
  const id = caseId.toUpperCase().startsWith('CASE-') ? caseId.toUpperCase() : `CASE-${caseId.toUpperCase()}`;
  return cases[id] || null;
}

function getAppealCaseByChannel(channelId) {
  const cases = db.read('cases');
  return Object.values(cases).find(c => c.type === 'appeal' && c.channelId === channelId) || null;
}

function getOpenAppealByUser(userId) {
  const cases = db.read('cases');
  return Object.values(cases)
    .filter(c => c.type === 'appeal' && c.reporterId === userId && !['Closed', 'Resolved', 'Rejected'].includes(c.status))
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

module.exports = {
  getStatusBadge,
  generateCaseId,
  addTimeline,
  logAction,
  buildCaseEmbed,
  updateReportEmbed,
  createBanCase,
  linkAppealToCase,
  linkTicketToCase,
  getCaseById,
  getAppealCaseByChannel,
  getOpenAppealByUser,
};
