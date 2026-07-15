// Formatting helpers for display values

/**
 * Format milliseconds into a human-readable duration string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Parse a duration string like "1h30m" into milliseconds
 */
function parseDuration(str) {
  const regex = /(\d+)\s*(d|h|m|s)/gi;
  let ms = 0;
  let match;
  const units = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  while ((match = regex.exec(str)) !== null) {
    ms += parseInt(match[1]) * (units[match[2].toLowerCase()] || 0);
  }
  return ms;
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
function truncate(str, maxLength = 1024) {
  if (!str) return 'None';
  return str.length > maxLength ? str.substring(0, maxLength - 3) + '...' : str;
}

/**
 * Format a Unix timestamp as a Discord timestamp string
 */
function discordTimestamp(date, style = 'f') {
  const unix = Math.floor((date instanceof Date ? date.getTime() : date) / 1000);
  return `<t:${unix}:${style}>`;
}

/**
 * Chunk an array into smaller arrays
 */
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Generate a random alphanumeric ID
 */
function generateId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = require('crypto').randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) id += chars[bytes[i] % chars.length];
  return id;
}

module.exports = { formatDuration, parseDuration, truncate, discordTimestamp, chunk, generateId };
