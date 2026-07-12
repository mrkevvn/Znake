// Event Handler - loads all event files from the events directory
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Load and register all events from the events directory
 */
async function loadEvents(client) {
  const eventsPath = path.join(__dirname, '../events');
  const files = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  let loaded = 0;

  for (const file of files) {
    try {
      const event = require(path.join(eventsPath, file));

      if (!event.name || !event.execute) {
        logger.warn(`Event "${file}" is missing name or execute property. Skipping.`);
        continue;
      }

      if (event.once) {
        client.once(event.name, (...args) => event.execute(client, ...args));
      } else {
        client.on(event.name, (...args) => event.execute(client, ...args));
      }

      loaded++;
      logger.info(`Loaded event: ${event.name} [${event.once ? 'once' : 'on'}]`);
    } catch (err) {
      logger.error(`Failed to load event "${file}": ${err.message}`);
    }
  }

  logger.success(`Loaded ${loaded} events.`);
}

module.exports = { loadEvents };
