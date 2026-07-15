'use strict';

const config = require('../config.json');

/**
 * Returns true if the given Discord user ID is listed in config.owners
 * @param {string} userId
 * @returns {boolean}
 */
function isOwner(userId) {
  const owners = config.owners || [];
  return owners.includes(userId);
}

module.exports = { isOwner };
