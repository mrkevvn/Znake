// ============================================================
// Discord Bot - Main Entry Point
// Discord.js v14 | CommonJS | JSON Storage
// ============================================================
'use strict';

const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const config = require('./config.json');
const logger = require('./utils/logger');

// Environment variables override config.json (keep secrets out of code)
if (process.env.BOT_TOKEN) config.token = process.env.BOT_TOKEN;
if (process.env.CLIENT_ID) config.clientId = process.env.CLIENT_ID;

const db = require('./utils/database');
const { loadCommands } = require('./handlers/commandHandler');
const { loadEvents } = require('./handlers/eventHandler');
const { startInactivityChecker } = require('./handlers/ticketInactivity');
const { registerInterval, registerCleanup } = require('./utils/restartManager');
const antiSpam = require('./handlers/antiSpamHandler');

// --- Startup Banner ---
console.log('\n' + '═'.repeat(55));
console.log('  Discord Management Bot - Starting up...');
console.log('  Version: ' + config.version);
console.log('═'.repeat(55) + '\n');

// --- Initialize Databases ---
db.initAll();

// --- Register cleanup handlers ---
registerCleanup(() => antiSpam.cleanup());

// --- Create Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
});

// --- Load Handlers ---
(async () => {
  try {
    logger.info('Loading command handler...');
    await loadCommands(client);

    logger.info('Loading event handler...');
    await loadEvents(client);

    // --- Login to Discord ---
    logger.info('Connecting to Discord...');
    await client.login(config.token);

    client.once('clientReady', () => {
      const inactivityInterval = startInactivityChecker(client);
      registerInterval(inactivityInterval);
      logger.info('Ticket inactivity checker started.');
    });
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
})();

// --- Giveaway Timer ---
// Check active giveaways every 10 seconds; delegate resolution to giveawayManager
const { handleGiveawayEnd } = require('./utils/giveawayManager');

const giveawayInterval = setInterval(async () => {
  try {
    const giveaways = db.read('giveaways');
    const now       = Date.now();

    for (const [guildId, guildGiveaways] of Object.entries(giveaways)) {
      for (const [messageId, giveaway] of Object.entries(guildGiveaways)) {
        if (giveaway.ended || giveaway.endTime > now) continue;

        // Mark ended in DB immediately to prevent double-firing
        giveaways[guildId][messageId].ended = true;
        db.write('giveaways', giveaways);

        await handleGiveawayEnd(client, guildId, messageId, giveaway).catch(err => {
          logger.error(`Giveaway end error [${messageId}]: ${err.message}`);
        });
      }
    }
  } catch (err) {
    logger.error(`Giveaway timer error: ${err.message}`);
  }
}, 10_000);
registerInterval(giveawayInterval);

// --- Global error handling - CRITICAL: Use criticalError to prevent EBADF cascades ---
process.on('unhandledRejection', (reason) => {
  try {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.criticalError(`Unhandled Promise Rejection: ${err.message}`, err.stack);
  } catch (e) {
    try {
      process.stderr.write(`[${new Date().toISOString()}] [CRITICAL] Unhandled Rejection: ${reason}\n`);
    } catch (e2) {}
  }
});

process.on('uncaughtException', (err) => {
  try {
    logger.criticalError(`Uncaught Exception: ${err.message}`, err.stack);
  } catch (e) {
    try {
      process.stderr.write(`[${new Date().toISOString()}] [CRITICAL] Uncaught Exception: ${err.message}\n${err.stack || ''}\n`);
    } catch (e2) {}
  }
  // DO NOT exit process - let the bot continue running
  // Exit only if critical system errors occur
});

module.exports = client;
