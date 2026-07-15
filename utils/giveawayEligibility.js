'use strict';

/**
 * Centralized eligibility checks for giveaway entries.
 * Returns: { ok: boolean, reason?: string, invalid?: boolean }
 */

const db = require('./database');

function parseNumber(val) {
  if (val === undefined || val === null) return null;
  const n = Number(String(val).trim());
  return Number.isFinite(n) ? n : null;
}

function parseRequirementsFromText(text) {
  const req = {
    requiredRoleId: null,
    requiredInvites: null,
    requiredMessages: null,
  };

  if (!text || typeof text !== 'string') return req;

  const normalized = text.replace(/\r/g, '\n').trim();
  if (!normalized) return req;

  // Allow commas and newlines as separators
  const parts = normalized
    .split(/[\n,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const [kRaw, ...rest] = part.split(':');
    if (!kRaw || rest.length === 0) continue;
    const k = kRaw.trim().toLowerCase();
    const v = rest.join(':').trim();

    if (k === 'role' || k === 'requiredrole') {
      const id = v.replace(/[<>@#!]/g, '').trim();
      if (/^\d{15,}$/.test(id)) req.requiredRoleId = id;
    } else if (k === 'invites' || k === 'invite') {
      const n = parseNumber(v);
      if (n !== null) req.requiredInvites = n;
    } else if (k === 'messages' || k === 'message') {
      const n = parseNumber(v);
      if (n !== null) req.requiredMessages = n;
    }
  }

  return req;
}

function disqualifiedCheck(giveaway, userId) {
  const dis = giveaway?.disqualifiedUsers;
  if (!Array.isArray(dis) || dis.length === 0) return { ok: true };
  const hit = dis.find((x) => String(x?.userId) === String(userId));
  if (hit) {
    return { ok: false, reason: 'You are disqualified from this giveaway.' };
  }
  return { ok: true };
}

function antiAltCheck(interactionMember, user) {
  // Minimal, production-safe baseline:
  // - account age threshold
  // (No IP logic available because there is no DB/IP integration.)
  const now = Date.now();
  const createdAt = user?.createdAt ? user.createdAt.getTime() : null;
  if (!createdAt) return { ok: true };

  const ageMs = now - createdAt;
  const minAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  if (ageMs < minAgeMs) {
    return { ok: false, invalid: true, reason: 'Account too new to enter this giveaway.' };
  }

  return { ok: true };
}

async function eligibilityForInteraction({ client, interaction, giveaway }) {
  // giveaway entries
  if (!giveaway || giveaway.ended) {
    return { ok: false, reason: 'This giveaway is no longer active.' };
  }

  // Disqualified users system
  const dq = disqualifiedCheck(giveaway, interaction.user.id);
  if (!dq.ok) return dq;

  // Role requirement
  const member = interaction.member;
  const req = giveaway.requirements ?? {};
  if (req.requiredRoleId) {
    const hasRole = member?.roles?.cache?.has(req.requiredRoleId);
    if (!hasRole) {
      return { ok: false, reason: 'You do not have the required role.' };
    }
  }

  // Invite / message requirements (optional safe-check mode)
  // If the bot has no reliable tracking stored, we bypass these checks instead of fail-closing.
  // This keeps the entry system functional while still enforcing disqualification + role + anti-alt.

  if (typeof req.requiredInvites === 'number' && req.requiredInvites > 0) {
    // Best-effort: only validate if invite logs contain enough data.
    const inviteLogs = db.read?.('invite_logs')?.[interaction.guildId];
    const hasInviteData = inviteLogs && typeof inviteLogs === 'object' && Object.keys(inviteLogs).length > 0;

    if (hasInviteData) {
      const userInvites = Number(inviteLogs?.[interaction.user.id] ?? inviteLogs?.[interaction.user.id]?.count ?? 0);
      if (!Number.isFinite(userInvites) || userInvites < req.requiredInvites) {
        return { ok: false, reason: `You need ${req.requiredInvites} invites to enter.` };
      }
    }
    // else: bypass when tracking is unavailable
  }

  if (typeof req.requiredMessages === 'number' && req.requiredMessages > 0) {
    const messageCounts = db.read?.('message_counts')?.[interaction.guildId];
    const hasMessageData = messageCounts && typeof messageCounts === 'object' && Object.keys(messageCounts).length > 0;

    if (hasMessageData) {
      const userMessages = Number(messageCounts?.[interaction.user.id] ?? messageCounts?.[interaction.user.id]?.count ?? 0);
      if (!Number.isFinite(userMessages) || userMessages < req.requiredMessages) {
        return { ok: false, reason: `You need ${req.requiredMessages} messages to enter.` };
      }
    }
    // else: bypass when tracking is unavailable
  }


  // Anti-alt
  const anti = await antiAltCheck(member, interaction.user);
  if (!anti.ok) return anti;

  return { ok: true };
}

module.exports = {
  parseRequirementsFromText,
  eligibilityForInteraction,
};

