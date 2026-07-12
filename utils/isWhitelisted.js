'use strict';

const db = require('./database');

/**
 * Returns true if the given Discord user ID is in the whitelist
 * @param {string} userId
 * @returns {boolean}
 */
function isWhitelisted(userId) {
  const data = db.read('whitelist');
  const users = data.users || [];
  return users.includes(userId);
}

module.exports = { isWhitelisted };
