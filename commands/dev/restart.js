'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');

const db = require('../../utils/database');
const logger = require('../../utils/logger');
const config = require('../../config.json');
const { logDevAction } = require('../../utils/devLogger');
const { safeShutdown } = require('../../utils/restartManager');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXECUTING = new Set();

const DB_NAMES = [
  'warnings', 'staff_roles', 'log_channels', 'tickets', 'ticket_config',
  'ticket_counter', 'giveaways', 'polls', 'welcome',
  'autorole', 'security', 'suggestions', 'reports', 'message_logs',
  'backups', 'config', 'embed_store', 'maintenance',
];

function detectMainEntry() {
  const searchPaths = [
    path.join(__dirname, '../../index.js'),
    path.join(__dirname, '../../main.js'),
    path.join(__dirname, '../../bot.js'),
    path.join(__dirname, '../../app.js'),
    path.join(__dirname, '../../server.js'),
    path.join(__dirname, '../../src/index.js'),
    path.join(__dirname, '../../src/main.js'),
    path.join(__dirname, '../../src/bot.js'),
  ];
  const fallback = path.join(__dirname, '../../index.js');
  for (const p of searchPaths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return fallback;
}

function detectRuntime() {
  if (process.env.PM2_HOME) return 'pm2';
  if (process.env.DOCKER || (process.platform !== 'win32' && (() => {
    try { return fs.existsSync('/proc/1/cgroup') && fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'); } catch { return false; }
  })())) return 'docker';
  return 'node';
}

module.exports = {
  name: 'restart',
  category: 'dev',
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('[Dev] Safely restart the bot process.'),

  async execute(interaction) {
    const { client, user } = interaction;

    if (!isOwner(user.id)) {
      await logDevAction({ interaction, command: 'dev restart', status: 'FAILED', details: 'Unauthorized access attempt', target: null });
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor || '#ED4245')
          .setAuthor({ name: '🔒  Developer Console  ·  Access Denied', iconURL: client.user.displayAvatarURL({ size: 64 }) })
          .setTitle('Access Denied')
          .setDescription('This command is restricted to **bot owners** only.')
          .addFields(
            { name: '🔑 Required', value: 'Bot Owner only', inline: true },
            { name: '🆔 Your ID', value: `\`${user.id}\``, inline: true },
          )
          .setFooter({ text: 'Contact the bot owner if you believe this is an error.' })
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (EXECUTING.has('restart')) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor || '#FEE75C')
          .setTitle('⚠️ Already Restarting')
          .setDescription('A restart is already in progress. Please wait.')
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }
    EXECUTING.add('restart');

    let exitCode = 0;

    try {
      await interaction.deferReply();

      const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const guilds = client.guilds.cache.size;
      const uptime = Math.floor((client.uptime ?? 0) / 1000);
      const nodeVer = process.version;
      const botTag = client.user.tag;
      const runtime = detectRuntime();
      const entryPath = detectMainEntry();

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#7CF7FF')
          .setAuthor({ name: '🔄  Developer Console  ·  Restart', iconURL: client.user.displayAvatarURL({ size: 64 }) })
          .setTitle('Restart Initiated')
          .setDescription('Bot is restarting, please wait...')
          .addFields(
            { name: '🔄 Status', value: 'Restarting...', inline: true },
            { name: '🤖 Runtime', value: `**${runtime.toUpperCase()}**`, inline: true },
            { name: '🏠 Guilds', value: `**${guilds}**`, inline: true },
            { name: '💾 Memory', value: `**${memMB} MB**`, inline: true },
            { name: '⏱️ Uptime', value: `**${uptime}s**`, inline: true },
            { name: '🔖 Version', value: `**v${config.version ?? '1.0.0'}**`, inline: true },
            { name: '👤 Requested By', value: `${user} (\`${user.id}\`)`, inline: false },
          )
          .setFooter({ text: `${botTag} · Node ${nodeVer} · ${runtime.toUpperCase()}` })
          .setTimestamp()],
      });

      await logDevAction({
        interaction,
        command: 'dev restart',
        status: 'SUCCESS',
        details: `Restart initiated — runtime ${runtime}, uptime ${uptime}s, memory ${memMB} MB, entry: ${path.basename(entryPath)}`,
        target: null,
      });

      logger.info(`[Restart] Initiated by ${user.username} (${user.id}) — runtime: ${runtime}, entry: ${entryPath}`);

      // Give Discord time to process the embed before we disconnect
      await new Promise(resolve => setTimeout(resolve, 1500));

      logger.info('[Restart] Flushing databases...');
      for (const name of DB_NAMES) {
        try { db.write(name, db.read(name)); } catch (e) {
          logger.info(`[Restart] DB flush skipped for "${name}": ${e.message}`);
        }
      }

      // ── PM2 / Docker: just exit — process manager respawns ──────────
      if (runtime === 'pm2' || runtime === 'docker') {
        logger.info(`[Restart] Running under ${runtime.toUpperCase()} — process manager will respawn the bot.`);
        await safeShutdown(client);
        logger.info('[Restart] Process exiting. Goodbye.');
        EXECUTING.delete('restart');
        process.exitCode = 0;
        process.exit(0);
        return;
      }

      // ── Direct Node restart ─────────────────────────────────────────
      logger.info('[Restart] Starting new process...');

      const isWindows = process.platform === 'win32';

      // Correct order: Node options FIRST, script path LAST
      // e.g. `node --expose-gc index.js` not `node index.js --expose-gc`
      const spawnArgs = [
        ...process.execArgv,
        entryPath,
      ];

      const child = spawn(process.execPath, spawnArgs, {
        detached: true,
        stdio: isWindows ? 'ignore' : 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          ZNAKE_RESTARTING: '1',
        },
      });

      // Detect spawn failure within a short window before shutting down.
      // `spawn()` errors are async (via 'error' event), so we wait briefly.
      const spawnFailed = await new Promise((resolve) => {
        child.on('error', (err) => {
          logger.info(`[Restart] New process failed to spawn: ${err.message}`);
          resolve(err);
        });
        setTimeout(() => resolve(null), 1000);
      });

      if (spawnFailed) {
        logger.info('[Restart] Aborting restart — new process did not start.');
        EXECUTING.delete('restart');
        try {
          if (interaction.deferred) {
            await interaction.editReply({
              embeds: [new EmbedBuilder()
                .setColor(config.errorColor || '#ED4245')
                .setAuthor({ name: '🔄  Developer Console  ·  Restart Failed', iconURL: client.user.displayAvatarURL({ size: 64 }) })
                .setTitle('❌ Restart Failed')
                .setDescription(`Could not spawn new process.\n\`${spawnFailed.message}\``)
                .setFooter({ text: 'The bot will continue running normally.' })
                .setTimestamp()],
            });
          }
        } catch {}
        return;
      }

      child.unref();

      logger.info(`[Restart] New process spawned (PID: ${child.pid}). Waiting for it to initialize...`);

      // Wait 2 seconds to let the new process start before killing the old one.
      // This prevents a gap where no bot instance is connected.
      await new Promise(resolve => setTimeout(resolve, 2000));

      await safeShutdown(client);

      logger.info('[Restart] Process exiting. Goodbye.');
    } catch (err) {
      logger.info(`[Restart] Restart notice: ${err?.message || err}`);
    }

    EXECUTING.delete('restart');
    process.exitCode = exitCode;
    process.exit(exitCode);
  },
};
