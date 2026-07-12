// /leaderboard - Top members by XP level
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../../utils/database');
const { getLevelData, levelTier } = require('../../utils/xp');

const MEDALS = ['🥇', '🥈', '🥉'];
const PAGE_SIZE = 10;

module.exports = {
  name: "leaderboard",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the most active members in this server by XP level')
    .addIntegerOption(opt =>
      opt.setName('page')
        .setDescription('Page number (default: 1)')
        .setMinValue(1)
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Jump to a specific user\'s rank')
        .setRequired(false)
    ),
  cooldown: 5,

  async execute(interaction, client) {
    await interaction.deferReply();

    const levels = db.read('levels');
    const guildLevels = levels[interaction.guild.id] || {};

    // Sort descending by total XP
    const sorted = Object.entries(guildLevels)
      .map(([userId, data]) => ({ userId, xp: data.xp || 0 }))
      .filter(e => e.xp > 0)
      .sort((a, b) => b.xp - a.xp);

    if (sorted.length === 0) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle('📊 XP Leaderboard')
            .setDescription('No XP has been earned yet.\nStart chatting to earn XP and appear here!')
            .setTimestamp(),
        ],
      });
    }

    // If a user was specified, jump to their page
    let page = interaction.options.getInteger('page') || 1;
    const targetUser = interaction.options.getUser('user');
    if (targetUser) {
      const idx = sorted.findIndex(e => e.userId === targetUser.id);
      if (idx === -1) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('Not Found')
              .setDescription(`**${targetUser.username}** has no recorded XP in this server.`)
              .setTimestamp(),
          ],
        });
      }
      page = Math.floor(idx / PAGE_SIZE) + 1;
    }

    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    page = Math.min(page, totalPages);

    const start = (page - 1) * PAGE_SIZE;
    const slice = sorted.slice(start, start + PAGE_SIZE);

    // Resolve display names
    const lines = await Promise.all(
      slice.map(async (entry, i) => {
        const rank = start + i + 1;
        const medal = rank <= 3 ? MEDALS[rank - 1] : `\`${rank}.\``;
        const { level, currentXp, xpForNext } = getLevelData(entry.xp);
        const { label: tierLabel } = levelTier(level);

        let displayName;
        try {
          const member = interaction.guild.members.cache.get(entry.userId)
            || await interaction.guild.members.fetch(entry.userId).catch(() => null);
          displayName = member
            ? member.displayName
            : (await client.users.fetch(entry.userId).catch(() => null))?.username
              || `Unknown`;
        } catch {
          displayName = 'Unknown';
        }

        const isTarget = targetUser
          ? entry.userId === targetUser.id
          : entry.userId === interaction.user.id;

        const nameStr = isTarget ? `**${displayName}** ◄` : displayName;
        return `${medal} ${nameStr} — ${tierLabel} Lvl **${level}** · \`${entry.xp.toLocaleString()} XP\``;
      })
    );

    // Caller's own position
    const callerIdx = sorted.findIndex(e => e.userId === interaction.user.id);
    const callerRank  = callerIdx === -1 ? null : callerIdx + 1;
    const callerXp    = callerIdx === -1 ? 0 : sorted[callerIdx].xp;
    const callerLevel = callerIdx === -1 ? 0 : getLevelData(callerXp).level;
    const footerExtra = callerRank
      ? `Your rank: #${callerRank} · Level ${callerLevel} (${callerXp.toLocaleString()} XP)  •  `
      : '';

    const totalXp = sorted.reduce((a, e) => a + e.xp, 0);

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🏆 XP Leaderboard — ${interaction.guild.name}`)
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .setDescription(lines.join('\n'))
      .addFields(
        { name: '👥 Ranked Members', value: `${sorted.length}`,                        inline: true },
        { name: '✨ Total XP Earned', value: `${totalXp.toLocaleString()}`,             inline: true },
        { name: '📄 Page',            value: `${page} / ${totalPages}`,                 inline: true },
      )
      .setFooter({ text: `${footerExtra}Use /rank to see your detailed stats  •  /leaderboard page:<n> to browse` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
