// Cooldown utility - prevents command spam
const cooldowns = new Map();

/**
 * Check if a user is on cooldown for a command
 * @param {string} userId - Discord user ID
 * @param {string} commandName - Name of the command
 * @param {number} cooldownSeconds - Cooldown duration in seconds
 * @returns {{ onCooldown: boolean, remaining: number }}
 */
function check(userId, commandName, cooldownSeconds) {
  const key = `${userId}-${commandName}`;

  if (!cooldowns.has(key)) {
    // Set the cooldown
    cooldowns.set(key, Date.now());
    setTimeout(() => cooldowns.delete(key), cooldownSeconds * 1000);
    return { onCooldown: false, remaining: 0 };
  }

  const expiresAt = cooldowns.get(key) + cooldownSeconds * 1000;
  const remaining = Math.ceil((expiresAt - Date.now()) / 1000);

  if (remaining > 0) {
    return { onCooldown: true, remaining };
  }

  // Reset the cooldown
  cooldowns.set(key, Date.now());
  setTimeout(() => cooldowns.delete(key), cooldownSeconds * 1000);
  return { onCooldown: false, remaining: 0 };
}

/**
 * Clear a user's cooldown for a specific command
 */
function clear(userId, commandName) {
  cooldowns.delete(`${userId}-${commandName}`);
}

module.exports = { check, clear };
