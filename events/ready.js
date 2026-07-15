// Ready event - fires once when bot successfully connects
const { REST, Routes } = require('discord.js');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../config.json');
const maintenance = require('../utils/maintenanceManager');
const statusRotator = require('../utils/statusRotator');

const { scheduleUnlockIfActive, unlockChannelByRecord } = require('../commands/moderation/timedLockdown');

const LOCKDOWNS_FILE_PATH = path.join(__dirname, '..', 'data/lockdowns.json');

function readLockdownsFile() {
  try {
    if (!fs.existsSync(LOCKDOWNS_FILE_PATH)) {
      fs.writeFileSync(LOCKDOWNS_FILE_PATH, JSON.stringify({ channels: {} }, null, 2));
    }
    const raw = fs.readFileSync(LOCKDOWNS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { channels: {} };
  } catch {
    return { channels: {} };
  }
}


module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.success(`Logged in as ${client.user.tag}`);

    logger.info(`Serving ${client.guilds.cache.size} guilds | ${client.users.cache.size} users`);
    logger.info(`Loaded ${client.commands.size} slash commands`);

    // Apply presence based on saved maintenance state
    maintenance.applyStartupPresence(client);

    // Restart recovery for timed channel lock timers
    // Recreate missing in-memory timeouts from persistent storage.
    try {
      const lockdownsData = readLockdownsFile();
      const now = Date.now();
      const activeEntries = Object.entries(lockdownsData.channels || {}).filter(([, r]) => r && r.active && r.type === 'timed');

      if (activeEntries.length) {
        logger.info(`Restoring ${activeEntries.length} timed lockdown timer(s) from storage...`);
      }

      for (const [channelId, record] of activeEntries) {
        const endTs = record.endTimestamp || 0;
        if (endTs && endTs <= now) {
          await unlockChannelByRecord(client, channelId, record.guildId, 'Restart Expired');
          continue;
        }
        scheduleUnlockIfActive(client, record);
      }
    } catch (err) {
      logger.error(`Timed lockdown restart recovery failed: ${err.message}`);
    }



    console.log('\n' + '═'.repeat(55));
    console.log(`  ✅ Bot is online: ${client.user.tag}`);
    console.log(`  📋 Commands: ${client.commands.size}`);
    console.log(`  🏠 Guilds: ${client.guilds.cache.size}`);
    console.log(`  🔖 Version: ${config.version}`);
    if (maintenance.isEnabled()) {
      console.log('  🛠️  Maintenance mode: ACTIVE');
    }
    console.log('═'.repeat(55) + '\n');


    // Start animated status rotation (respects maintenance mode)
    statusRotator.start(client);
  },
};
