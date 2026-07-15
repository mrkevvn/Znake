'use strict';

const blacklistService = require('./blacklist');

/**
 * Returns true if the given Discord user ID is in the blacklist
 * @param {string} userId
 * @returns {boolean}
 */
function isBlacklisted(userId) {
  return blacklistService.isBlacklisted({ type: 'user', id: userId });
}

/**
 * Returns the blacklist entry for the user, or null
 * @param {string} userId
 * @returns {object|null}
 */
function getBlacklistEntry(userId) {
  const data = blacklistService.getBlacklistData();
  return data.users[userId] || null;
}

module.exports = { isBlacklisted, getBlacklistEntry };
