'use strict';

const path = require('path');
const fs = require('fs');
const { REST, Routes } = require('discord.js');
const { EmbedBuilder } = require('discord.js');

const config = require('../config.json');
const logger = require('./logger');
const { loadCommands } = require('../handlers/commandHandler');
const { loadEvents } = require('../handlers/eventHandler');

const commandsRoot = path.join(__dirname, '..', 'commands');
const eventsRoot = path.join(__dirname, '..', 'events');

const CACHE_ROOTS = [
  path.join(__dirname, '..', 'commands'),
  path.join(__dirname, '..', 'events'),
  path.join(__dirname, '..', 'utils'),
];

function formatMs(ms) {
  if (!Number.isFinite(ms)) return '0';
  return `${Math.max(0, Math.round(ms))}`;
}

function isUnder(baseAbs, moduleId) {
  // baseAbs and moduleId are absolute paths or module IDs.
  // For require.resolve() ids, moduleId will usually be absolute file paths.
  return typeof moduleId === 'string' && moduleId.startsWith(baseAbs);
}

function clearRequireCacheScoped() {
  const keys = Object.keys(require.cache);
  let cleared = 0;
  for (const k of keys) {
    for (const root of CACHE_ROOTS) {
      if (isUnder(root, k) && k.endsWith('.js')) {
        delete require.cache[k];
        cleared++;
        break;
      }
    }
  }
  return cleared;
}

async function syncSlashCommands({ client, scope }) {
  // scope: { type: 'global' | 'guild' | 'dev', guildId?: string }
  const clientId = process.env.CLIENT_ID || config.clientId;
  const token = process.env.BOT_TOKEN || config.token;

  if (!clientId || !token) {
    throw new Error('Missing CLIENT_ID / BOT_TOKEN for slash sync.');
  }

  const globalPayload = [];
  const devPayload = [];
  const seen = new Set();

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
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

      if (seen.has(mod.data.name)) continue;
      seen.add(mod.data.name);

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

  // PUT overwrite semantics: ensures full overwrite & prevents duplicates at API level.
  if (scope?.type === 'guild') {
    if (!scope.guildId) throw new Error('sync scope missing guildId');
    return rest.put(Routes.applicationGuildCommands(clientId, scope.guildId), { body: [] });
  }

  // Sync dev commands to dev guild
  const devGuildId = process.env.DEV_GUILD_ID || config.devGuildId;
  if (devGuildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body: devPayload });
  }

  // Sync global commands (non-dev only)
  return rest.put(Routes.applicationCommands(clientId), { body: globalPayload });
}

function buildReloadEmbed({ client, status, okCounts, failedCounts, durationMs, errors }) {
  const color = status === 'SUCCESS' ? '#57F287' : status === 'PARTIAL' ? '#FEE75C' : '#ED4245';
  const title =
    status === 'SUCCESS'
      ? '✅ Reload Complete'
      : status === 'PARTIAL'
        ? '⚠️ Reload Partial'
        : '❌ Reload Failed';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: '🔄  Developer Console  ·  Reload', iconURL: client?.user?.displayAvatarURL({ size: 64 }) })
    .setTitle(title)
    .addFields(
      { name: '📌 Status', value: status === 'SUCCESS' ? 'Success' : status === 'PARTIAL' ? 'Partial' : 'Failed', inline: false },
      {
        name: '🧾 Progress Checklist',
        value:
          '• Unloading modules\n' +
          '• Clearing cache\n' +
          '• Reloading commands\n' +
          '• Refreshing slash commands',
        inline: false,
      },
      { name: '⏱️ Execution Time', value: `${formatMs(durationMs)} ms`, inline: false },
    )
    .setFooter({ text: 'Reload system v3 (full replacement architecture)' })
    .setTimestamp();

  if (status !== 'SUCCESS' && errors?.length) {
    embed.addFields({ name: '🧯 Error', value: errors.slice(0, 5).join('\n').slice(0, 1900), inline: false });
  }

  if (okCounts || failedCounts) {
    embed.addFields(
      {
        name: '📦 Reload Summary',
        value: `Commands: ✅ ${okCounts?.commands ?? 0} / ❌ ${failedCounts?.commands ?? 0}\nEvents: ✅ ${okCounts?.events ?? 0} / ❌ ${failedCounts?.events ?? 0}`,
        inline: false,
      },
      { name: '🔢 Slash Sync', value: 'Overwritten via Discord API (PUT)', inline: false }
    );
  }

  return embed;
}

async function reloadAll(client, options = {}) {
  const start = Date.now();
  const errors = [];
  const okCounts = { commands: 0, events: 0 };
  const failedCounts = { commands: 0, events: 0 };

  // Avoid concurrent reloads.
  if (!client) throw new Error('reloadAll requires client');
  if (!client.__reloadManager) client.__reloadManager = { running: false };
  if (client.__reloadManager.running) throw new Error('Reload already running');
  client.__reloadManager.running = true;

  try {
    // ── Unload existing handlers safely ───────────────────────────────
    // Remove only listeners for events we defined, not all listeners
    // (preserves Discord.js internal listeners like shard events)
    try {
      const eventFiles = fs.readdirSync(eventsRoot).filter(f => f.endsWith('.js'));
      for (const file of eventFiles) {
        try {
          // Use fresh require after cache clear would fail, so read the name from file
          const eventModule = require(path.join(eventsRoot, file));
          if (eventModule?.name) {
            client.removeAllListeners(eventModule.name);
          }
        } catch { /* skip unparseable event files */ }
      }
    } catch { /* fallback: if we can't read events dir, skip cleanup */ }


    // ── Clear require cache scoped ────────────────────────────────────
    const cleared = clearRequireCacheScoped();
    logger.info(`[ReloadManager] Cleared require cache entries: ${cleared}`);

    // ── Reload commands & events ─────────────────────────────────────
    try {
      await loadCommands(client);
      okCounts.commands = client.commands?.size ?? 0;
    } catch (err) {
      failedCounts.commands = -1;
      errors.push(`Reload commands failed: ${err?.message || err}`);
    }

    try {
      await loadEvents(client);
      okCounts.events = 1; // loadEvents logs internally; count isn't critical.
    } catch (err) {
      failedCounts.events = -1;
      errors.push(`Reload events failed: ${err?.message || err}`);
    }

    // ── Slash sync (overwrite) ───────────────────────────────────────
    // Global overwrite always.
    // Optional: guild sync if provided.
    try {
      await syncSlashCommands({ client, scope: { type: 'global' } });
    } catch (err) {
      errors.push(`Slash sync (global) failed: ${err?.message || err}`);
    }

    if (options?.guildId) {
      try {
        await syncSlashCommands({ client, scope: { type: 'guild', guildId: options.guildId } });
      } catch (err) {
        errors.push(`Slash sync (guild) failed: ${err?.message || err}`);
      }
    }

    const status = errors.length === 0 ? 'SUCCESS' : errors.length < 2 ? 'PARTIAL' : 'FAILED';

    return {
      status,
      errors,
      okCounts,
      failedCounts,
      durationMs: Date.now() - start,
    };
  } finally {
    client.__reloadManager.running = false;
  }
}

function buildEmbedFromResult(client, result) {
  return buildReloadEmbed({
    client,
    status: result.status,
    okCounts: result.okCounts,
    failedCounts: result.failedCounts,
    durationMs: result.durationMs,
    errors: result.errors,
  });
}

module.exports = {
  reloadAll,
  buildEmbedFromResult,
};

