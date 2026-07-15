'use strict';

const db = require('./database');

const WIZARD_DB = 'giveaways_wizard_temp';

function getWizardState(guildId, wizardId) {
  const temp = db.read(WIZARD_DB);
  return temp?.[guildId]?.[wizardId] ?? null;
}

function setWizardState(guildId, wizardId, patch) {
  const temp = db.read(WIZARD_DB);
  if (!temp[guildId]) temp[guildId] = {};
  if (!temp[guildId][wizardId]) temp[guildId][wizardId] = { createdAt: Date.now() };
  temp[guildId][wizardId] = {
    ...temp[guildId][wizardId],
    ...patch,
  };
  db.write(WIZARD_DB, temp);
}


function deleteWizardState(guildId, wizardId) {
  const temp = db.read(WIZARD_DB);
  if (temp?.[guildId]?.[wizardId]) {
    delete temp[guildId][wizardId];
  }
  db.write(WIZARD_DB, temp);
}

function cleanupExpiredWizards({ ttlMs = 10 * 60_000 } = {}) {
  const temp = db.read(WIZARD_DB);
  const now = Date.now();
  let removed = 0;

  for (const [guildId, guildMap] of Object.entries(temp || {})) {
    for (const [wizardId, state] of Object.entries(guildMap || {})) {
      if (!state?.createdAt) continue;
      if (now - state.createdAt > ttlMs) {
        delete temp[guildId][wizardId];
        removed++;
      }
    }
  }

  if (removed > 0) db.write(WIZARD_DB, temp);
  return removed;
}

module.exports = {
  getWizardState,
  setWizardState,
  deleteWizardState,
  cleanupExpiredWizards,
};


