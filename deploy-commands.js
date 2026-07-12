// deploy-commands.js - authoritative slash deployment (manual)
"use strict";

const logger = require('./utils/logger');
const path = require('path');

let config;
try {
  config = require('./config.json');
} catch {
  console.error('Missing config.json! Fill in your bot token and Client ID.');
  process.exit(1);
}

const token = process.env.BOT_TOKEN || config.token;
const clientId = process.env.CLIENT_ID || config.clientId;

if (!token) {
  logger.error('No bot token set. Add BOT_TOKEN to your env or edit config.json.');
  process.exit(1);
}
if (!clientId) {
  logger.error('No Client ID set. Add CLIENT_ID to your env or edit config.json.');
  process.exit(1);
}

(async () => {
  try {
    // Standalone deploy: register commands currently exported by command modules.
    const { REST, Routes } = require('discord.js');

    const commandsRoot = path.join(__dirname, 'commands');
    const commandsPayload = [];
    const seenNames = new Set();


    function walk(dir) {
      let entries;
      try {
        entries = require('fs').readdirSync(dir, { withFileTypes: true });
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
        if (path.basename(fullPath) === 'auditLogger.js') continue;

        const mod = require(fullPath);
        if (!mod?.data || !mod?.execute) continue;
        if (!mod.data?.name) continue;

        if (seenNames.has(mod.data.name)) continue;
        seenNames.add(mod.data.name);

        commandsPayload.push(mod.data.toJSON());
      }
    }

    walk(commandsRoot);

    const rest = new REST({ version: '10' }).setToken(token);

    logger.info('Fetching guilds list to clear guild-specific commands...');
    try {
      const guilds = await rest.get(Routes.userGuilds());
      if (guilds && guilds.length > 0) {
        logger.info(`Found ${guilds.length} guild(s). Overwriting/clearing guild-specific commands...`);
        for (const guild of guilds) {
          await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
          logger.info(`Cleared guild-specific commands for: ${guild.name} (${guild.id})`);
        }
      }
    } catch (err) {
      logger.warn(`Could not clear guild commands automatically: ${err.message}`);
    }

    logger.info('Publishing commands globally...');
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commandsPayload });





    logger.success(`Manual deployment complete. Published=${Array.isArray(data) ? data.length : commandsPayload.length}`);
  } catch (err) {
    logger.error(`Deployment failed: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
})();

