// /membercount - Shows the server member count
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

function safeCount(value) {
  return Number.isFinite(value) ? value : 0;
}

function getStatusEmoji(status) {
  switch (status) {
    case 'online':
      return '🟢';
    case 'idle':
      return '🌙';
    case 'dnd':
      return '⛔';
    case 'offline':
    default:
      return '⚫';
  }
}

module.exports = {
  name: "membercount",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('membercount')
    .setDescription('View the current member count and presence status for this server'),
  cooldown: 10,

  async execute(interaction) {
    const { guild } = interaction;
    if (!guild) {
      const embed = new EmbedBuilder()
        .setColor(config.errorColor || 0xff4d4d)
        .setTitle('❌ Unable to load server data')
        .setDescription('No guild context was found for this interaction.')
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Populate cache for member + presence lookups.
    // This is needed for accurate online/idle/dnd counts.
    await guild.members.fetch().catch(() => {});

    const totalMembers = safeCount(guild.memberCount ?? guild.members.cache.size);

    const members = guild.members.cache;
    let bots = 0;
    let humans = 0;

    let online = 0;
    let idle = 0;
    let dnd = 0;
    let offline = 0;

    // Single pass for all required counters.
    for (const [, member] of members) {
      const isBot = Boolean(member.user?.bot);
      if (isBot) bots++;
      else humans++;

      const presenceStatus = member.presence?.status;

      // If presence is missing (e.g., intents/availability), treat as offline for a safe fallback.
      // This keeps the command lightweight and avoids throwing.
      if (!presenceStatus) {
        offline++;
        continue;
      }

      if (presenceStatus === 'online') online++;
      else if (presenceStatus === 'idle' || presenceStatus === 'afk') idle++; // AFK usually maps to idle/afk style
      else if (presenceStatus === 'dnd') dnd++;
      else offline++;
    }

    // If cache presence is incomplete, totals may not match. We keep numbers as-is for transparency.
    const overviewBar = '┃ • ╭─╮ • ┃';
    const presenceBar = '┃ • ╰─╯ • ┃';
    const botBar = '┃ • ┃';

    const title = guild.name || 'Server';
    const thumb = guild.iconURL({ dynamic: true }) || null;

    const dataRefreshed = '📡 Data refreshed';
    const mostActiveStatus = (() => {
      const counts = {
        online,
        idle,
        dnd,
        offline,
      };
      const entries = Object.entries(counts);
      entries.sort((a, b) => b[1] - a[1]);
      const [bestKey, bestVal] = entries[0];
      const emoji = getStatusEmoji(bestKey);
      return bestVal > 0 ? `Most active status: ${emoji} ${bestKey[0].toUpperCase()}${bestKey.slice(1)}` : 'Most active status: Unknown';
    })();

    const embed = new EmbedBuilder()
      .setColor(config.embedColor ?? 0x5865f2)
      .setTitle(`${title}`)
      .setThumbnail(thumb ?? null)
      .setDescription(
        [
          ' ',
          '╭─╮ Server Analytics',
          overviewBar,
          `👥 MEMBER OVERVIEW`,
          `  ┃ Total: **${totalMembers.toLocaleString()}**`,
          `  ┃ Humans: **${humans.toLocaleString()}**  |  Bots: **${bots.toLocaleString()}**`,
          ' ',
          presenceBar,
          `📡 PRESENCE STATUS`,
          `  ┃ 🟢 Online: **${online.toLocaleString()}**`,
          `  ┃ 🌙 Idle/AFK: **${idle.toLocaleString()}**`,
          `  ┃ ⛔ DND: **${dnd.toLocaleString()}**`,
          `  ┃ ⚫ Offline: **${offline.toLocaleString()}**`,
          ' ',
          botBar,
          `🤖 BOT BREAKDOWN`,
          `  ┃ Bots: **${bots.toLocaleString()}**`,
          ' ',
          `╰─╯ ${dataRefreshed} • ${mostActiveStatus}`,
        ].join('\n')
      )
      .setFooter({ text: `${interaction.client.user?.username ?? 'Bot'} • ` })
      .setTimestamp();

    // Ensure footer includes timestamp (Discord handles timestamp visually; we add text for branding).
    // Some clients may render footer text + timestamp separately.

    await interaction.reply({ embeds: [embed] });
  },
};

