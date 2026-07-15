'use strict';

function disqualifiedUserIds(giveaway) {
  const dis = giveaway?.disqualifiedUsers;
  if (!Array.isArray(dis)) return new Set();
  return new Set(dis.map((x) => String(x?.userId)).filter(Boolean));
}

function validEntriesForWinners({ participants, giveaway, prevWinners }) {
  const prev = new Set((prevWinners || []).map((x) => String(x)));
  const invalidUsers = disqualifiedUserIds(giveaway);

  const out = [];
  for (const uid of new Set((participants || []).map(String))) {
    if (!uid) continue;
    if (prev.has(uid)) continue;
    if (invalidUsers.has(uid)) continue;
    // invalid entries: if stored, exclude them
    if (Array.isArray(giveaway?.invalidEntries)) {
      if (giveaway.invalidEntries.includes(uid)) continue;
    }
    out.push(uid);
  }

  return out;
}

module.exports = {
  disqualifiedUserIds,
  validEntriesForWinners,
};

