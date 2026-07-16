// /clear - Unlimited message purge with batched fetching and rate-limit-aware deletion
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff, botHasPermission } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const config = require('../../config.json');

const FETCH_LIMIT = 100;
const PROGRESS_UPDATE_INTERVAL = 500;
const OLD_MESSAGE_DAYS = 14;
const OLD_MESSAGE_THRESHOLD = OLD_MESSAGE_DAYS * 24 * 60 * 60 * 1000;
const INDIVIDUAL_DELETE_DELAY_MS = 50;
const LARGE_REQUEST_THRESHOLD = 100;

module.exports = {
  name: 'clear',
  category: 'moderation',
  default_member_permissions: 'ManageMessages',
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete messages from this channel')
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('Number of messages to delete')
        .setRequired(true)
        .setMinValue(1),
    )
    .addUserOption(opt => opt.setName('user').setDescription('Only delete messages from this user'))
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Optional reason (shown in mod log)')
        .setRequired(false)
        .setMaxLength(500),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const amount = interaction.options.getInteger('amount', true);
    const targetUser = interaction.options.getUser('user') || null;
    const reason = interaction.options.getString('reason') || null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!botHasPermission(interaction.channel, PermissionFlagsBits.ManageMessages)) {
      return interaction.editReply({ embeds: [embeds.noPermission('Manage Messages')] });
    }

    const startTime = Date.now();
    let totalDeleted = 0;
    let bulkDeleted = 0;
    let individualDeleted = 0;
    let lastMessageId = null;
    let hasMoreMessages = true;
    let lastProgressUpdate = 0;

    const showProgress = async (deleted) => {
      const pct = Math.min(100, Math.round((deleted / amount) * 100));
      const filled = Math.floor(pct / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('Deleting...')
          .setDescription([
            `\`${bar}\` ${pct}%`,
            `Deleted: **${deleted.toLocaleString()}** / **${amount.toLocaleString()}**`,
          ].join('\n'))
          .setTimestamp()],
      }).catch(() => {});
    };

    const maybeUpdateProgress = async () => {
      if (amount < LARGE_REQUEST_THRESHOLD) return;
      if (totalDeleted - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
        lastProgressUpdate = totalDeleted;
        await showProgress(totalDeleted);
      }
    };

    while (totalDeleted < amount && hasMoreMessages) {
      const fetchOptions = { limit: FETCH_LIMIT };
      if (lastMessageId) fetchOptions.before = lastMessageId;

      let messages;
      try {
        messages = await interaction.channel.messages.fetch(fetchOptions);
      } catch {
        break;
      }

      if (messages.size === 0) {
        hasMoreMessages = false;
        break;
      }

      lastMessageId = messages.last()?.id;

      const filtered = targetUser
        ? [...messages.values()].filter(m => m.author.id === targetUser.id)
        : [...messages.values()];

      if (filtered.length === 0) continue;

      const now = Date.now();
      const recent = filtered.filter(m => (now - m.createdTimestamp) < OLD_MESSAGE_THRESHOLD);
      const old = filtered.filter(m => (now - m.createdTimestamp) >= OLD_MESSAGE_THRESHOLD);

      // Bulk delete recent messages in batches of 100
      for (let i = 0; i < recent.length; i += FETCH_LIMIT) {
        if (totalDeleted >= amount) break;

        const batch = recent.slice(i, i + FETCH_LIMIT);
        try {
          const deleted = await interaction.channel.bulkDelete(batch, true);
          bulkDeleted += deleted.size;
          totalDeleted += deleted.size;
        } catch {
          for (const msg of batch) {
            if (totalDeleted >= amount) break;
            try {
              await msg.delete();
              individualDeleted++;
              totalDeleted++;
            } catch { /* skip */ }
            await new Promise(r => setTimeout(r, INDIVIDUAL_DELETE_DELAY_MS));
          }
        }
        await maybeUpdateProgress();
      }

      // Delete old messages individually
      for (const msg of old) {
        if (totalDeleted >= amount) break;
        try {
          await msg.delete();
          individualDeleted++;
          totalDeleted++;
        } catch { /* skip */ }
        await new Promise(r => setTimeout(r, INDIVIDUAL_DELETE_DELAY_MS));
        await maybeUpdateProgress();
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const remaining = Math.max(0, amount - totalDeleted);
    const targetName = targetUser ? ` from **${targetUser.globalName || targetUser.username}**` : '';

    const summaryLines = [
      `> Requested: **${amount.toLocaleString()}**`,
      `> Deleted: **${totalDeleted.toLocaleString()}**`,
      remaining > 0 ? `> Remaining: **${remaining.toLocaleString()}** (not enough messages in channel)` : null,
      `> Bulk deleted: **${bulkDeleted.toLocaleString()}**`,
      `> Individually deleted: **${individualDeleted.toLocaleString()}**`,
      `> Time taken: **${elapsed}s**`,
    ].filter(Boolean);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('Messages Cleared')
        .setDescription([
          `Deleted **${totalDeleted.toLocaleString()}** message(s)${targetName}.`,
          '',
          ...summaryLines,
        ].join('\n'))
        .setTimestamp()],
    });

    await logModerationAction(
      interaction.client,
      interaction.guild,
      'CLEAR',
      targetUser
        ? targetUser
        : {
            id: interaction.channel.id,
            username: interaction.channel.name || 'channel',
            globalName: interaction.channel.name || 'channel',
            displayAvatarURL: () => null,
          },
      interaction.user,
      reason,
      { deleted: totalDeleted },
    );
  },
};
