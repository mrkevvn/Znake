// /rank - Shows a user's XP level, rank, and progress
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../../utils/database');
const { getLevelData, progressBar, levelTier } = require('../../utils/xp');

module.exports = {
  name: "rank",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your level and XP rank in this server')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('User to check (defaults to you)')
        .setRequired(false)
    ),
  cooldown: 5,

  async execute(interaction, client) {
    await interaction.deferReply();

    const target = interaction.options.getUser('user') || interaction.user;
    const { guild } = interaction;

    // Fetch member for display name
    const member = await guild.members.fetch(target.id).catch(() => null);
    const displayName = member?.displayName || target.username;

    // Load XP data
    const levels = db.read('levels');
    const guildLevels = levels[guild.id] || {};
    const userData = guildLevels[target.id] || { xp: 0, level: 0 };
    const totalXp = userData.xp || 0;

    const { level, currentXp, xpForNext, progressPercent } = getLevelData(totalXp);
    const { label: tierLabel, color: tierColor } = levelTier(level);

    // Calculate server rank (sorted by XP)
    const sorted = Object.entries(guildLevels)
      .sort(([, a], [, b]) => (b.xp || 0) - (a.xp || 0));
    const rankPos = sorted.findIndex(([id]) => id === target.id) + 1;
    const rankDisplay = rankPos > 0 ? `#${rankPos}` : 'Unranked';

    // Who is above them and how far?
    let toNextRankText = null;
    if (rankPos > 1) {
      const [, aboveData] = sorted[rankPos - 2];
      const diff = (aboveData.xp || 0) - totalXp;
      toNextRankText = `**${diff.toLocaleString()} XP** away from rank #${rankPos - 1}`;
    }

    // Message count
    const msgCounts = db.read('message_counts');
    const msgData = (msgCounts[guild.id] || {})[target.id];
    const msgCount = msgData?.count || 0;

    // Bar visual
    const bar = progressBar(currentXp, xpForNext, 20);
    const barLine = `\`${bar}\` ${progressPercent}%`;

    const embed = new EmbedBuilder()
      .setColor(tierColor)
      .setAuthor({
        name: `${displayName}'s Rank Card`,
        iconURL: target.displayAvatarURL({ dynamic: true }),
      })
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription(
        [
          `## ${tierLabel}  ·  Level **${level}**`,
          `> Server Rank **${rankDisplay}** out of **${sorted.length}** ranked members`,
          '',
          `**Progress to Level ${level + 1}**`,
          barLine,
          `\`${currentXp.toLocaleString()} / ${xpForNext.toLocaleString()} XP\``,
        ].join('\n')
      )
      .addFields(
        { name: '✨ Total XP',       value: `\`${totalXp.toLocaleString()}\``,    inline: true },
        { name: '💬 Messages Sent',  value: `\`${msgCount.toLocaleString()}\``,   inline: true },
        { name: '📈 XP to Next Lvl', value: `\`${(xpForNext - currentXp).toLocaleString()} XP\``, inline: true },
      )
      .setFooter({
        text: toNextRankText
          ? `⚔️ ${toNextRankText}`
          : rankPos === 1
            ? '👑 You\'re at the top! Keep it up.'
            : 'Start chatting to earn XP!',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
