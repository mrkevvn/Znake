'use strict';

const logger = require('./logger');

const MANAGED_INTERVALS = [];
const CLEANUP_CALLBACKS = [];

function registerInterval(id) {
  MANAGED_INTERVALS.push(id);
  return id;
}

function registerCleanup(fn) {
  CLEANUP_CALLBACKS.push(fn);
}

function clearAllManagedIntervals() {
  for (const id of MANAGED_INTERVALS) {
    try { clearInterval(id); } catch {}
  }
  MANAGED_INTERVALS.length = 0;
}

function runCleanupCallbacks() {
  for (const fn of CLEANUP_CALLBACKS) {
    try { fn(); } catch {}
  }
  CLEANUP_CALLBACKS.length = 0;
}

async function safeShutdown(client) {
  logger.info('[Shutdown] Starting shutdown...');

  logger.info('[Shutdown] Clearing background intervals...');
  clearAllManagedIntervals();

  logger.info('[Shutdown] Running cleanup callbacks...');
  runCleanupCallbacks();

  logger.info('[Shutdown] Destroying Discord client...');
  try {
    if (client && typeof client.destroy === 'function') {
      await Promise.race([
        client.destroy(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    }
    logger.info('[Shutdown] Discord client destroyed successfully.');
  } catch (e) {
    logger.error(`[Shutdown] Client destruction error: ${e?.stack || e.message}`);
  }

  logger.info('[Shutdown] Removing process event handlers...');
  try {
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  } catch (e) {
    logger.error(`[Shutdown] Process handler cleanup error: ${e?.stack || e.message}`);
  }

  logger.info('[Shutdown] Shutdown complete.');
}

module.exports = { registerInterval, registerCleanup, safeShutdown };
