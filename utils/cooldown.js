// Cooldown utility - prevents command spam
const cooldowns = new Map();

// Periodic cleanup of expired entries (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of cooldowns) {
    if (expiresAt <= now) cooldowns.delete(key);
  }
}, 60_000).unref();

/**
 * Check if a user is on cooldown for a command
 * @param {string} userId - Discord user ID
 * @param {string} commandName - Name of the command
 * @param {number} cooldownSeconds - Cooldown duration in seconds
 * @returns {{ onCooldown: boolean, remaining: number }}
 */
function check(userId, commandName, cooldownSeconds) {
  const key = `${userId}-${commandName}`;
  const now = Date.now();

  const expiresAt = cooldowns.get(key);
  if (expiresAt !== undefined && expiresAt > now) {
    const remaining = Math.ceil((expiresAt - now) / 1000);
    return { onCooldown: true, remaining };
  }

  // Set the cooldown (store expiry timestamp)
  cooldowns.set(key, now + cooldownSeconds * 1000);
  return { onCooldown: false, remaining: 0 };
}

/**
 * Clear a user's cooldown for a specific command
 */
function clear(userId, commandName) {
  cooldowns.delete(`${userId}-${commandName}`);
}

module.exports = { check, clear };
