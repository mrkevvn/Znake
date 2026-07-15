'use strict';

// 6 Mandatory Categories
const CATEGORIES = {
  Moderation: { emoji: '🛡️', label: 'Moderation', desc: 'Server protection & moderating tools' },
  Utility:    { emoji: '🛠️', label: 'Utility', desc: 'General commands & server utilities' },
  Ticket:     { emoji: '🎫', label: 'Ticket', desc: 'Support ticket system management' },
  Premium:    { emoji: '💎', label: 'Premium', desc: 'Exclusive perks & premium commands' },
  Admin:      { emoji: '⚙️', label: 'Admin', desc: 'Developer & administrative controls' },
  Other:      { emoji: '📦', label: 'Other', desc: 'Uncategorized or miscellaneous commands' },
};

// Map original folder/category keys to target groups (case-insensitive)
const CATEGORY_MAP = {
  moderation: 'Moderation',
  security: 'Moderation',

  general: 'Utility',
  user: 'Utility',
  server: 'Utility',
  embed: 'Utility',
  poll: 'Utility',
  suggestions: 'Utility',
  role: 'Utility',
  welcome: 'Utility',
  giveaway: 'Utility',
  utility: 'Utility',

  ticket: 'Ticket',

  premium: 'Premium',

  dev: 'Admin',
  staff: 'Admin',
  config: 'Admin',
  backup: 'Admin',
  logging: 'Admin',
  admin: 'Admin',
};

/**
 * Validates, groups, and maps client commands.
 * Single source of truth from client.commands Map.
 * 
 * @param {Client} client Discord client instance containing client.commands Map
 * @returns {Object} Object mapping each of the 6 categories to an array of valid, sorted command objects.
 */
function getGroupedCommands(client) {
  // Initialize category groups
  const groups = {};
  for (const catKey of Object.keys(CATEGORIES)) {
    groups[catKey] = [];
  }

  // Ensure commands registry exists
  if (!client || !client.commands || !(client.commands instanceof Map)) {
    return groups;
  }

  // Set to prevent duplicate listings
  const processed = new Set();

  for (const [cmdName, cmd] of client.commands.entries()) {
    if (!cmd) continue;

    // Extract name
    const name = cmd.data?.name || cmd.name;
    if (!name || typeof name !== 'string') continue;

    // Prevent duplicates
    const lowerName = name.toLowerCase();
    if (processed.has(lowerName)) continue;
    processed.add(lowerName);

    // Extract and fallback description
    let rawDesc = cmd.data?.description || cmd.description || 'No description available';
    if (typeof rawDesc !== 'string') rawDesc = 'No description available';

    // Truncate description to max 120 chars
    const description = rawDesc.length > 120 ? `${rawDesc.substring(0, 117)}...` : rawDesc;

    // Determine category
    let groupName = 'Other';

    // Special override rule: banner command is Premium
    if (lowerName === 'banner') {
      groupName = 'Premium';
    } else {
      const origCat = cmd._category || cmd.category;
      if (origCat && typeof origCat === 'string') {
        const normCat = origCat.toLowerCase().trim();
        if (CATEGORY_MAP[normCat]) {
          groupName = CATEGORY_MAP[normCat];
        }
      }
    }

    // Double check group exists in target list, fallback to Other
    if (!groups[groupName]) {
      groupName = 'Other';
    }

    groups[groupName].push({
      name: lowerName,
      description,
    });
  }

  // Sort commands within each category alphabetically
  for (const catKey of Object.keys(groups)) {
    groups[catKey].sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}

module.exports = {
  CATEGORIES,
  getGroupedCommands,
};
