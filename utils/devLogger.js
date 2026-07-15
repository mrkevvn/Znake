'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../data/devlogs.json');

async function logDevAction({ interaction, command, status, details, target = null }) {
  try {
    let data = { logs: [] };

    try {
      const raw = await fs.promises.readFile(LOG_FILE, 'utf8');
      data = JSON.parse(raw);
      if (!Array.isArray(data.logs)) data.logs = [];
    } catch {
      data = { logs: [] };
    }

    const entry = {
      userId: interaction.user.id,
      username: interaction.user.username,
      command,
      status,
      timestamp: new Date().toISOString(),
      details,
      target: target ?? null,
    };

    data.logs.push(entry);

    await fs.promises.writeFile(LOG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // Silently fail - devLogger should NEVER crash the bot
    // Logs will still be captured by the main logger if needed
  }
}

module.exports = { logDevAction };
