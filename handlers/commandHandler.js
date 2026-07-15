// Command Handler - recursively loads all command files from the commands directory
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Load all commands from the commands directory into client.commands
 */
async function loadCommands(client) {
  client.commands = new Map();
  const commandsPath = path.join(__dirname, '../commands');
  let loaded = 0;

  // Recursively walk commands/ to support nested modules like:
  // commands/config/config/config.js
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!fullPath.endsWith('.js')) continue;
      if (fullPath.endsWith('auditLogger.js')) continue;

      // Best-effort category label = first folder name under commands/
      const rel = path.relative(commandsPath, fullPath).split(path.sep);
      const topCategory = rel.length ? rel[0] : 'unknown';
      const fileName = entry.name;

      try {
        // eslint-disable-next-line import/no-dynamic-require
        const command = require(fullPath);

        if (!command?.data || !command?.execute) {
          logger.warn(`Command "${fileName}" is missing data or execute property. Skipping.`);
          continue;
        }

        // Skip duplicate command registrations (keep the first-loaded implementation)
        if (client.commands.has(command.data.name)) {
          logger.warn(
            `Duplicate command name detected for /${command.data.name}. Keeping existing implementation; skipping ${fileName}.`
          );
          continue;
        }

        command._filePath = fullPath;
        command._category = topCategory;
        command._isDevCommand = topCategory === 'dev';

        client.commands.set(command.data.name, command);
        loaded++;
        logger.info(`Loaded command: /${command.data.name} [${topCategory}]`);
      } catch (err) {
        logger.error(`Failed to load command "${fileName}": ${err.message}`);
      }
    }
  }

  walk(commandsPath);

  logger.success(`Loaded ${loaded} commands.`);
}

module.exports = { loadCommands };

