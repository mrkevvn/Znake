'use strict';

const { SlashCommandBuilder, EmbedBuilder, version: djsVersion } = require('discord.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function uptimeParts(ms) {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { d, h, m, s };
}

function formatUptime(ms) {
  const { d, h, m, s } = uptimeParts(ms);
  const parts = [];
  if (d) parts.push(`**${d}** day${d !== 1 ? 's' : ''}`);
  if (h) parts.push(`**${h}** hr${h !== 1 ? 's' : ''}`);
  if (m) parts.push(`**${m}** min`);
  parts.push(`**${s}** sec`);
  return parts.join('  ');
}

/**
 * Build a filled/empty block progress bar.
 * Reference window = 7 days (one week). Caps at 100%.
 */
function buildBar(ms, refMs = 7 * 24 * 60 * 60 * 1000, len = 22) {
  const ratio  = Math.min(ms / refMs, 1);
  const filled = Math.round(ratio * len);
  const pct    = Math.round(ratio * 100);
  return `\`${'█'.repeat(filled)}${'░'.repeat(len - filled)}\`  **${pct}%** of 7 days`;
}

function pingLabel(ping) {
  if (ping < 0)   return { dot: '⚪', label: 'Measuring…',  color: '#5865F2' };
  if (ping < 80)  return { dot: '🟢', label: 'Excellent',   color: '#57F287' };
  if (ping < 160) return { dot: '🟡', label: 'Good',        color: '#FEE75C' };
  if (ping < 300) return { dot: '🟠', label: 'Fair',        color: '#E67E22' };
  return              { dot: '🔴', label: 'Degraded',        color: '#ED4245' };
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "uptime",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('View the bot\'s live uptime and system status'),
  cooldown: 5,

  async execute(interaction, client) {
    await interaction.deferReply();

    const uptime  = client.uptime ?? 0;
    const wsPing  = client.ws.ping;
    const bootSec = Math.floor((Date.now() - uptime) / 1000);

    const mem       = process.memoryUsage();
    const heapUsed  = (mem.heapUsed  / 1048576).toFixed(1);
    const heapTotal = (mem.heapTotal / 1048576).toFixed(1);
    const rss       = (mem.rss       / 1048576).toFixed(1);

    const cmdCount  = client.commands?.size ?? '—';
    const { dot, label, color } = pingLabel(wsPing);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({
        name:    `${client.user.username}  ·  System Status`,
        iconURL: client.user.displayAvatarURL({ size: 128 }),
      })
      .setTitle(`${dot}  Status: ${label}`)
      .setDescription(
        `**Online since**  <t:${bootSec}:F>\n` +
        `**Started**  <t:${bootSec}:R>`
      )
      .addFields(
        {
          name:   '⏱️  Uptime',
          value:  formatUptime(uptime),
          inline: false,
        },
        {
          name:   '📡  WS Latency',
          value:  wsPing < 0 ? '*Measuring…*' : `**${wsPing}ms**`,
          inline: true,
        },
        {
          name:   '🏠  Guilds',
          value:  `**${client.guilds.cache.size}**`,
          inline: true,
        },
        {
          name:   '👥  Users',
          value:  `**${client.users.cache.size}**`,
          inline: true,
        },
        {
          name:   '💾  Heap',
          value:  `**${heapUsed} MB** used\n${heapTotal} MB total`,
          inline: true,
        },
        {
          name:   '📦  RSS',
          value:  `**${rss} MB**`,
          inline: true,
        },
        {
          name:   '⚙️  Commands',
          value:  `**${cmdCount}**`,
          inline: true,
        },
        {
          name:   '📊  Weekly Uptime',
          value:  buildBar(uptime),
          inline: false,
        },
      )
      .setFooter({
        text:    `Node.js ${process.version}  ·  discord.js v${djsVersion}`,
        iconURL: client.user.displayAvatarURL({ size: 32 }),
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
