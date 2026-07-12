'use strict';

const db = require('./database');
const logger = require('./logger');
const maintenancePresence = require('./maintenancePresence');


const DB_NAME = 'maintenance';

function getState() {
  const data = db.read(DB_NAME);
  return {
    enabled: !!data.enabled,
    enabledBy: data.enabledBy || null,
    enabledAt: data.enabledAt || null,
  };
}

function isEnabled() {
  return getState().enabled;
}

function enable(client, user) {
  db.write(DB_NAME, {
    enabled: true,
    enabledBy: user ? (user.globalName || user.username) : 'Unknown',
    enabledById: user ? user.id : null,
    enabledAt: Date.now(),
  });
  logger.info('[Maintenance] Maintenance mode ENABLED.');

  const statusRotator = require('./statusRotator');
  statusRotator.stop();
  logger.info('[StatusRotator] Maintenance status active, animation disabled');

  maintenancePresence.applyPresenceMaintenance(client);
}


function disable(client) {
  db.write(DB_NAME, { enabled: false, enabledBy: null, enabledById: null, enabledAt: null });
  logger.info('[Maintenance] Maintenance mode DISABLED.');

  statusRotator.start(client);
  logger.info('[StatusRotator] Status animation resumed');
}

function applyStartupPresence(client) {
  if (!client?.user) return;

  if (isEnabled()) {
    logger.info('[Maintenance] Resuming maintenance mode from saved state.');
    enable(client);
  } else {
    maintenancePresence.applyPresenceOnline(client);
  }
}


module.exports = { isEnabled, getState, enable, disable, applyStartupPresence };
