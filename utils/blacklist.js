'use strict';

const db = require('./database');

/**
 * Retrieves the entire blacklist object.
 * Guaranteed to have `users` and `guilds` structures.
 * @returns {{users: object, guilds: object}}
 */
function getBlacklistData() {
  const data = db.read('blacklist') || {};
  return {
    users: data.users || {},
    guilds: data.guilds || {}
  };
}

/**
 * Checks if a user or guild ID is currently blacklisted.
 * @param {{type: "user"|"guild", id: string}} param
 * @returns {boolean}
 */
function isBlacklisted({ type, id }) {
  if (!id) return false;
  if (type !== 'user' && type !== 'guild') return false;
  
  const data = getBlacklistData();
  const map = type === 'user' ? data.users : data.guilds;
  return Object.prototype.hasOwnProperty.call(map, id);
}

/**
 * Adds a user or guild to the blacklist if not already present.
 * @param {{type: "user"|"guild", id: string, reason?: string, addedBy?: string}} param
 * @returns {boolean} True if successfully added, false if already blacklisted or invalid.
 */
function addBlacklist({ type, id, reason, addedBy }) {
  if (!id) return false;
  if (type !== 'user' && type !== 'guild') return false;

  const data = db.read('blacklist') || {};
  if (!data.users) data.users = {};
  if (!data.guilds) data.guilds = {};

  const map = type === 'user' ? data.users : data.guilds;
  if (Object.prototype.hasOwnProperty.call(map, id)) {
    return false; // Prevent duplicates (reject duplicate entries)
  }

  map[id] = {
    reason: reason || 'No reason provided',
    addedBy: addedBy || 'System',
    addedAt: Date.now()
  };

  return db.write('blacklist', data);
}

/**
 * Removes a user or guild from the blacklist.
 * @param {{type: "user"|"guild", id: string}} param
 * @returns {boolean} True if successfully removed, false if not found or invalid.
 */
function removeBlacklist({ type, id }) {
  if (!id) return false;
  if (type !== 'user' && type !== 'guild') return false;

  const data = db.read('blacklist') || {};
  if (!data.users) data.users = {};
  if (!data.guilds) data.guilds = {};

  const map = type === 'user' ? data.users : data.guilds;
  if (!Object.prototype.hasOwnProperty.call(map, id)) {
    return false;
  }

  delete map[id];
  return db.write('blacklist', data);
}

module.exports = {
  getBlacklistData,
  isBlacklisted,
  addBlacklist,
  removeBlacklist
};
