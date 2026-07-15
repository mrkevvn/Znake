'use strict';

const crypto = require('crypto');

function getParticipants(giveaway) {
  // Merge both entries and participants for backward compatibility
  const entries = Array.isArray(giveaway.entries) ? giveaway.entries : [];
  const participants = Array.isArray(giveaway.participants) ? giveaway.participants : [];
  return [...new Set([...entries, ...participants].map(String))];
}

function getParticipantsLegacy(giveaway) {
  // Merge both fields for backward compatibility
  const entries = Array.isArray(giveaway.entries) ? giveaway.entries : [];
  const participants = Array.isArray(giveaway.participants) ? giveaway.participants : [];
  return [...new Set([...entries, ...participants].map(String))];
}

function pickWinnersWithoutReplacement({ participants, maxWinners }) {
  const p = [...participants];
  const count = Math.max(0, Math.min(maxWinners, p.length));
  for (let i = 0; i < count; i++) {
    const j = i + crypto.randomInt(0, p.length - i);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  return p.slice(0, count);
}

function disqualifiedSet(giveaway) {
  const dis = giveaway?.disqualifiedUsers;
  if (!Array.isArray(dis) || dis.length === 0) return new Set();
  // Support both [{ userId, ... }] and legacy [userId]
  const ids = dis.map((x) => (typeof x === 'string' ? x : x?.userId)).filter(Boolean);
  return new Set(ids.map(String));
}


function filterCandidates({ giveaway, participants }) {
  const invalid = new Set(Array.isArray(giveaway.invalidEntries) ? giveaway.invalidEntries.map(String) : []);
  const dis = disqualifiedSet(giveaway);
  const prev = new Set(Array.isArray(giveaway.winners) ? giveaway.winners.map(String) : []);

  return participants.filter((uid) => {
    if (!uid) return false;
    if (dis.has(String(uid))) return false;
    if (invalid.has(String(uid))) return false;
    // exclude previous winners only for rerolls; for final end selection we allow empty prev
    // (caller can pass winners to exclude if desired)
    return true;
  });
}

module.exports = {
  getParticipants,
  getParticipantsLegacy,
  pickWinnersWithoutReplacement,
  filterCandidates,
};

