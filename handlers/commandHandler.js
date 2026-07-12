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

  // Note: command files can live in any subfolder; visibility is enforced by each command itself.
  // We intentionally keep moderation commands loaded so slash registration works,
  // but each moderation command rejects non-staff users.
  const categories = fs.readdirSync(commandsPath);

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js') && f !== 'auditLogger.js');

    for (const file of files) {
      try {
        const command = require(path.join(categoryPath, file));

        // Validate command structure
        if (!command.data || !command.execute) {
          logger.warn(`Command "${file}" is missing data or execute property. Skipping.`);
          continue;
        }

        command._filePath = path.join(categoryPath, file);
        command._category = category;

        // Command loader filter: If category is dev, only load if we have owner/testing guilds configured


        // Skip duplicate command registrations (keep the first-loaded implementation)
        if (client.commands.has(command.data.name)) {
          logger.warn(`Duplicate command name detected for /${command.data.name}. Keeping existing implementation; skipping ${file}.`);
          continue;
        }

        client.commands.set(command.data.name, command);
        loaded++;
        logger.info(`Loaded command: /${command.data.name} [${category}]`);
      } catch (err) {
        logger.error(`Failed to load command "${file}": ${err.message}`);
      }
    }
  }

  logger.success(`Loaded ${loaded} commands across ${categories.length} categories.`);
}

module.exports = { loadCommands };

