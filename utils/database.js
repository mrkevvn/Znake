// Database utility - manages all JSON file storage
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const dataDir = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Default schemas for each database file
const defaults = {
  warnings: {},
  staff_roles: {},
  log_channels: {},
  tickets: {},
  ticket_counter: {},
  giveaways: {},
  giveaways_wizard_temp: {},
  polls: {},
  welcome: {},
  autorole: {},
  security: {},
  suggestions: {},
  message_logs: {},
  backups: {},
  config: {},
  embed_store: {},
  maintenance: { enabled: false },
  whitelist: { users: [] },
  blacklist: { users: {}, guilds: {} },
  notes: {},
  watchlist: {},
  stripped_roles: {},
  message_counts: {},
  levels: {},
  level_config: {},
  cases: {},
  caselogs: { entries: [] },
  ticket_config: {},
  invite_logs: {},
};

/**
 * Get the full path for a database file
 */
function getPath(name) {
  return path.join(dataDir, `${name}.json`);
}

/**
 * Read a JSON database file, creating it with defaults if missing
 */
function read(name) {
  const filePath = getPath(name);
  try {
    if (!fs.existsSync(filePath)) {
      const defaultData = defaults[name] !== undefined ? defaults[name] : {};
      fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logger.error(`Failed to read database "${name}": ${err.message}`);
    return defaults[name] !== undefined ? defaults[name] : {};
  }
}

/**
 * Write data to a JSON database file
 */
function write(name, data) {
  const filePath = getPath(name);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    logger.error(`Failed to write database "${name}": ${err.message}`);
    return false;
  }
}

/**
 * Get a specific guild's data from a database
 */
function getGuild(name, guildId) {
  const db = read(name);
  if (!db[guildId]) db[guildId] = {};
  return db[guildId];
}

/**
 * Set a specific guild's data in a database
 */
function setGuild(name, guildId, data) {
  const db = read(name);
  db[guildId] = data;
  return write(name, db);
}

/**
 * Initialize all database files on startup
 */
function initAll() {
  for (const name of Object.keys(defaults)) {
    const filePath = getPath(name);
    if (!fs.existsSync(filePath)) {
      write(name, defaults[name]);
      logger.info(`Created database: ${name}.json`);
    }
  }
  logger.success('All databases initialized.');
}

module.exports = { read, write, getGuild, setGuild, initAll };
