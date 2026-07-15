'use strict';

const crypto = require('crypto');
const db = require('./database');
const { validEntriesForWinners } = require('./giveawayEligibilityFilters');

function pickRandomWithoutReplacement(arr, count) {
  const a = [...arr];
  const max = Math.max(0, Math.min(count, a.length));
  for (let i = 0; i < max; i++) {
    const j = i + crypto.randomInt(0, a.length - i);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a.slice(0, max);
}

async function rerollGiveaway({ client, guildId, messageId, winnersCount, rerollById, reason }) {
  const all = db.read('giveaways');
  const giveaway = all?.[guildId]?.[messageId];
  if (!giveaway) return { ok: false, reason: 'Giveaway not found.' };
  if (!giveaway.ended) return { ok: false, reason: 'Giveaway is still active.' };

  const prevWinners = Array.isArray(giveaway.winners) ? giveaway.winners : [];

  const candidates = validEntriesForWinners({
    participants: giveaway.participants,
    giveaway,
    prevWinners,
  });

  const count = Math.max(1, Number(winnersCount ?? giveaway.winnerCount ?? 1));
  const newWinners = pickRandomWithoutReplacement(candidates, count);

  if (newWinners.length === 0) {
    return { ok: false, reason: 'No valid entries to reroll.' };
  }

  // Update DB with reroll results
  all[guildId][messageId].winners = newWinners;
  all[guildId][messageId].rerollMeta = {
    lastRerolledBy: rerollById,
    reason: reason || null,
    timestamp: Date.now(),
  };

  db.write('giveaways', all);

  return { ok: true, giveaway: all[guildId][messageId], newWinners };
}

module.exports = {
  rerollGiveaway,
};


