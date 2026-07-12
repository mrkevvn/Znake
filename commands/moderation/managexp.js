// /managexp - Admin XP management (give, remove, set, reset)
const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../config.json');
const db = require('../../utils/database');
const { getLevelData, levelTier } = require('../../utils/xp');

function applyXp(levelsDb, guildId, userId, newXp) {
  if (!levelsDb[guildId]) levelsDb[guildId] = {};
  if (!levelsDb[guildId][userId]) levelsDb[guildId][userId] = { xp: 0, level: 0 };
  levelsDb[guildId][userId].xp = Math.max(0, newXp);
  const { level } = getLevelData(levelsDb[guildId][userId].xp);
  levelsDb[guildId][userId].level = level;
  db.write('levels', levelsDb);
  return levelsDb[guildId][userId];
}

module.exports = {
  name: "managexp",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('managexp')
    .setDescription('Manage XP for a server member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('give')
        .setDescription('Add XP to a member')
        .addUserOption(opt => opt.setName('user').setDescription('Target member').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('XP to add').setMinValue(1).setMaxValue(1_000_000).setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove XP from a member')
        .addUserOption(opt => opt.setName('user').setDescription('Target member').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('XP to remove').setMinValue(1).setMaxValue(1_000_000).setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set a member\'s XP to an exact value')
        .addUserOption(opt => opt.setName('user').setDescription('Target member').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('New total XP').setMinValue(0).setMaxValue(10_000_000).setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Reset a member\'s XP and level to zero')
        .addUserOption(opt => opt.setName('user').setDescription('Target member').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('check')
        .setDescription('Check a member\'s current XP and level')
        .addUserOption(opt => opt.setName('user').setDescription('Target member').setRequired(true))
    ),
  cooldown: 3,

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount') ?? null;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const { guild } = interaction;

    const levelsDb   = db.read('levels');
    const guildLevel = (levelsDb[guild.id] || {})[target.id] || { xp: 0, level: 0 };
    const currentXp  = guildLevel.xp || 0;

    // ── check ──────────────────────────────────────────────────────────────────
    if (sub === 'check') {
      const { level, currentXp: lvlXp, xpForNext, progressPercent } = getLevelData(currentXp);
      const { label: tierLabel, color: tierColor } = levelTier(level);

      // Rank position
      const sorted = Object.entries(levelsDb[guild.id] || {})
        .sort(([, a], [, b]) => (b.xp || 0) - (a.xp || 0));
      const rankPos = sorted.findIndex(([id]) => id === target.id) + 1;

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(tierColor)
            .setAuthor({ name: `XP Info — ${target.username}`, iconURL: target.displayAvatarURL({ dynamic: true }) })
            .addFields(
              { name: '✨ Total XP',     value: `\`${currentXp.toLocaleString()}\``,                           inline: true },
              { name: '📊 Level',        value: `\`${level}\` ${tierLabel}`,                                    inline: true },
              { name: '🏆 Server Rank',  value: rankPos > 0 ? `\`#${rankPos}\`` : '`Unranked`',                 inline: true },
              { name: '📈 Progress',     value: `\`${lvlXp.toLocaleString()} / ${xpForNext.toLocaleString()} XP\` (${progressPercent}%)`, inline: false },
            )
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── give / remove / set / reset ────────────────────────────────────────────
    let newXp, actionLabel, deltaText, embedColor;

    if (sub === 'give') {
      newXp       = currentXp + amount;
      actionLabel = '✅ XP Added';
      deltaText   = `+${amount.toLocaleString()} XP`;
      embedColor  = config.successColor;
    } else if (sub === 'remove') {
      newXp       = currentXp - amount;
      actionLabel = '➖ XP Removed';
      deltaText   = `-${amount.toLocaleString()} XP`;
      embedColor  = config.warningColor;
    } else if (sub === 'set') {
      newXp       = amount;
      actionLabel = '✏️ XP Set';
      deltaText   = `→ ${amount.toLocaleString()} XP`;
      embedColor  = config.infoColor;
    } else {
      newXp       = 0;
      actionLabel = '🔄 XP Reset';
      deltaText   = `Reset from ${currentXp.toLocaleString()} XP to 0`;
      embedColor  = config.errorColor;
    }

    const updated = applyXp(levelsDb, guild.id, target.id, newXp);
    const { label: tierLabel } = levelTier(updated.level);

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(actionLabel)
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '👤 Member',       value: `<@${target.id}>`,                              inline: true },
        { name: '📊 Change',       value: deltaText,                                      inline: true },
        { name: '✨ New Total XP', value: `\`${updated.xp.toLocaleString()} XP\``,        inline: true },
        { name: '🏅 New Level',    value: `\`${updated.level}\` ${tierLabel}`,            inline: true },
        { name: '🛡️ Moderator',   value: `<@${interaction.user.id}>`,                    inline: true },
        { name: '📝 Reason',       value: reason,                                         inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
