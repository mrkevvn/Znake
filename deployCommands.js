// deployCommands.js - authoritative slash deployment (manual)
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
const devGuildId = process.env.DEV_GUILD_ID || config.devGuildId;

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
    const globalPayload = [];
    const devPayload = [];
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

        const rel = path.relative(commandsRoot, fullPath).split(path.sep);
        const topCategory = rel.length ? rel[0] : 'unknown';

        if (topCategory === 'dev') {
          devPayload.push(mod.data.toJSON());
        } else {
          globalPayload.push(mod.data.toJSON());
        }
      }
    }

    walk(commandsRoot);

    const rest = new REST({ version: '10' }).setToken(token);

    // ── Dev guild: register dev commands only ────────────────────────────
    if (devGuildId) {
      logger.info(`Registering ${devPayload.length} dev command(s) to guild ${devGuildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body: devPayload });
      logger.success(`Dev commands registered to guild ${devGuildId}.`);
    } else {
      logger.warn('No devGuildId configured — dev commands will NOT be registered to any guild.');
    }

    // ── Global: register all non-dev commands ───────────────────────────
    logger.info(`Publishing ${globalPayload.length} global command(s)...`);
    const data = await rest.put(Routes.applicationCommands(clientId), { body: globalPayload });

    logger.success(`Deployment complete. Global=${Array.isArray(data) ? data.length : globalPayload.length}, Dev=${devPayload.length} (guild ${devGuildId || 'none'})`);
  } catch (err) {
    logger.error(`Deployment failed: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
})();
