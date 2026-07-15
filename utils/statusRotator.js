'use strict';

const { ActivityType } = require('discord.js');
const logger = require('./logger');
const maintenance = require('./maintenanceManager');
const { registerInterval } = require('./restartManager');

let intervalId = null;
let currentIndex = 0;
const ROTATION_INTERVAL = 12_000;

function getStatusList(client) {
  const serverCount = client.guilds?.cache?.size ?? 0;
  return [
    { name: '/help | Znake', type: ActivityType.Watching },
    { name: `Serving ${serverCount} servers`, type: ActivityType.Watching },
    { name: 'Managing tickets & tools', type: ActivityType.Playing },
    { name: 'Powered by Znake', type: ActivityType.Watching },
  ];
}

async function rotate(client) {
  if (!client?.user) return;

  if (maintenance.isEnabled()) return;

  const statuses = getStatusList(client);
  if (statuses.length === 0) return;

  const status = statuses[currentIndex];
  currentIndex = (currentIndex + 1) % statuses.length;

  try {
    await client.user.setPresence({
      activities: [{ name: status.name, type: status.type }],
      status: 'online',
    });
    logger.debug('Status updated successfully');
  } catch (err) {
    logger.error(`Failed to update status: ${err.message}`);
  }
}

function start(client) {
  if (intervalId) {
    logger.info('[StatusRotator] Already running — ignoring duplicate start.');
    return;
  }

  if (maintenance.isEnabled()) {
    logger.info('[StatusRotator] Maintenance status active, animation disabled');
    return;
  }

  currentIndex = 0;

  rotate(client);

  intervalId = setInterval(() => rotate(client), ROTATION_INTERVAL);
  registerInterval(intervalId);
  logger.info('[StatusRotator] Status rotation started.');
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  currentIndex = 0;
  logger.info('[StatusRotator] Status rotation stopped.');
}

function isRunning() {
  return intervalId !== null;
}

module.exports = { start, stop, isRunning };
