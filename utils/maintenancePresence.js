'use strict';

const { ActivityType } = require('discord.js');

function applyPresenceOnline(client) {
  if (!client?.user) return;
  client.user.setPresence({
    activities: [{ name: `/help | ${client.guilds.cache.size} servers`, type: ActivityType.Watching }],
    status: 'online',
  });
}

function applyPresenceMaintenance(client) {
  if (!client?.user) return;
  client.user.setPresence({
    activities: [{ name: 'Maintenance Mode | Try later', type: ActivityType.Watching }],
    status: 'dnd',
  });
}

module.exports = {
  applyPresenceOnline,
  applyPresenceMaintenance,
};

