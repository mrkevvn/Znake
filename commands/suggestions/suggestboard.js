'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

// ── Shared helpers ────────────────────────────────────────────────────────────

function medal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `**#${rank}**`;
}

function bar(filled, total, len = 12) {
  if (total === 0) return `\`${'░'.repeat(len)}\`  —`;
  const f   = Math.round((filled / total) * len);
  const pct = Math.round((filled / total) * 100);
  return `\`${'█'.repeat(f)}${'░'.repeat(len - f)}\`  **${pct}%**`;
}

function voteBar(up = 0, down = 0, len = 10) {
  const total  = up + down;
  const filled = total > 0 ? Math.round((up / total) * len) : 0;
  return `👍 \`${'█'.repeat(filled)}${'░'.repeat(len - filled)}\` **${up}**  ·  👎 **${down}**`;
}

function truncate(str, max = 85) {
  if (!str) return '*No content*';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ── Sub-handler: server leaderboard ──────────────────────────────────────────

async function handleServer(interaction) {
  const { guild } = interaction;
  const page    = (interaction.options.getInteger('page') ?? 1) - 1;
  const perPage = 8;

  const allSuggestions = db.read('suggestions');
  const guildData      = allSuggestions[guild.id] ?? {};
  const entries        = Object.values(guildData);

  if (entries.length === 0) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.infoColor)
          .setAuthor({ name: `${guild.name}  ·  Suggestion Board`, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
          .setTitle('📋 No Suggestions Yet')
          .setDescription('No suggestions have been submitted in this server yet.\nMembers can use `/suggest` to submit one.')
          .setFooter({ text: 'Suggestion Board' })
          .setTimestamp(),
      ],
    });
  }

  const statsMap = new Map();
  for (const s of entries) {
    if (!statsMap.has(s.userId)) statsMap.set(s.userId, { approved: 0, denied: 0, pending: 0, votesUp: 0, votesDown: 0 });
    const stat = statsMap.get(s.userId);
    stat[s.status] = (stat[s.status] ?? 0) + 1;
    stat.votesUp   += s.votes?.up   ?? 0;
    stat.votesDown += s.votes?.down ?? 0;
  }

  const sorted = [...statsMap.entries()]
    .map(([userId, stat]) => ({ userId, ...stat, total: stat.approved + stat.denied + stat.pending }))
    .sort((a, b) => b.approved - a.approved || a.denied - b.denied || b.total - a.total);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage   = Math.min(page, totalPages - 1);
  const slice      = sorted.slice(safePage * perPage, safePage * perPage + perPage);

  const totalApproved = entries.filter(s => s.status === 'approved').length;
  const totalDenied   = entries.filter(s => s.status === 'denied').length;
  const totalPending  = entries.filter(s => s.status === 'pending').length;
  const totalAll      = entries.length;

  const header =
    `**${totalAll}** suggestions across **${statsMap.size}** member${statsMap.size !== 1 ? 's' : ''}\n` +
    `✅ **${totalApproved}** approved  ·  ❌ **${totalDenied}** denied  ·  ⏳ **${totalPending}** pending\n` +
    `Server approval rate: ${bar(totalApproved, totalAll)}\n\u200b`;

  const rows = slice.map(({ userId, approved, denied, pending, votesUp, votesDown }, i) => {
    const rank = safePage * perPage + i + 1;
    return (
      `${medal(rank)}  <@${userId}>\n` +
      `> ✅ \`${String(approved).padStart(3)}\`  ❌ \`${String(denied).padStart(3)}\`  ⏳ \`${String(pending).padStart(3)}\`  ·  👍 \`${String(votesUp).padStart(3)}\`  👎 \`${String(votesDown).padStart(3)}\`\n` +
      `> Approval rate: ${bar(approved, approved + denied)}`
    );
  });

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({ name: `${guild.name}  ·  Suggestion Board`, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
        .setTitle('📊 Suggestion Leaderboard')
        .setDescription(header + rows.join('\n\n'))
        .setFooter({ text: `Page ${safePage + 1} of ${totalPages}  ·  ${totalAll} total  ·  /suggest to submit` })
        .setTimestamp(),
    ],
  });
}

// ── Sub-handler: user history ─────────────────────────────────────────────────

async function handleUser(interaction) {
  const { guild } = interaction;
  const target  = interaction.options.getUser('member') ?? interaction.user;
  const page    = (interaction.options.getInteger('page') ?? 1) - 1;
  const perPage = 5;

  const allSuggestions = db.read('suggestions');
  const guildData      = allSuggestions[guild.id] ?? {};

  const userSuggestions = Object.values(guildData)
    .filter(s => s.userId === target.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (userSuggestions.length === 0) {
    const isSelf = target.id === interaction.user.id;
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.infoColor)
          .setAuthor({ name: `${target.globalName ?? target.username}  ·  Suggestion History`, iconURL: target.displayAvatarURL({ size: 64 }) })
          .setTitle('📋 No Suggestions Found')
          .setDescription(
            isSelf
              ? 'You have not submitted any suggestions yet.\nUse `/suggest` to submit your first one!'
              : `**${target.globalName ?? target.username}** has not submitted any suggestions in this server yet.`
          )
          .setFooter({ text: `${guild.name}  ·  Suggestion Board` })
          .setTimestamp(),
      ],
    });
  }

  const approved       = userSuggestions.filter(s => s.status === 'approved').length;
  const denied         = userSuggestions.filter(s => s.status === 'denied').length;
  const pending        = userSuggestions.filter(s => s.status === 'pending').length;
  const total          = userSuggestions.length;
  const totalVotesUp   = userSuggestions.reduce((n, s) => n + (s.votes?.up   ?? 0), 0);
  const totalVotesDown = userSuggestions.reduce((n, s) => n + (s.votes?.down ?? 0), 0);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage   = Math.min(page, totalPages - 1);
  const slice      = userSuggestions.slice(safePage * perPage, safePage * perPage + perPage);

  const STATUS_ICON = { approved: '✅', denied: '❌', pending: '⏳' };

  const header =
    `✅  **${approved}** approved  ·  ❌  **${denied}** denied  ·  ⏳  **${pending}** pending\n` +
    `Approval rate: ${bar(approved, approved + denied)}\n` +
    `Total community votes: 👍 **${totalVotesUp}**  ·  👎 **${totalVotesDown}**\n\u200b`;

  const rows = slice.map(s => {
    const votes       = s.votes ?? { up: 0, down: 0 };
    const icon        = STATUS_ICON[s.status] ?? '⏳';
    const submittedTs = `<t:${Math.floor(s.createdAt / 1000)}:d>`;

    let row =
      `${icon}  \`${s.id}\`  ·  ${submittedTs}  ·  **${s.status.charAt(0).toUpperCase() + s.status.slice(1)}**\n` +
      `> ${truncate(s.text)}\n` +
      `> ${voteBar(votes.up, votes.down)}`;

    if (s.status !== 'pending' && s.reviewedBy) {
      const noteLabel  = s.status === 'approved' ? 'Note' : 'Reason';
      const reviewedTs = s.reviewedAt ? `<t:${Math.floor(s.reviewedAt / 1000)}:R>` : 'unknown';
      row +=
        `\n> 👤 ${s.reviewedBy}  ·  ${reviewedTs}\n` +
        `> 📝 ${noteLabel}: *${truncate(s.reviewNote, 70)}*`;
    }

    return row;
  });

  const dominantColor = approved > denied ? '#57F287' : denied > approved ? '#ED4245' : config.infoColor;

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(dominantColor)
        .setAuthor({ name: `${target.globalName ?? target.username}  ·  Suggestion History`, iconURL: target.displayAvatarURL({ size: 64 }) })
        .setTitle(`📊 ${total} Suggestion${total !== 1 ? 's' : ''} Submitted`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .setDescription(header + rows.join('\n\n'))
        .setFooter({
          text: [
            `${guild.name}  ·  Suggestion Board`,
            totalPages > 1 ? `Page ${safePage + 1} of ${totalPages}` : null,
          ].filter(Boolean).join('  ·  '),
        })
        .setTimestamp(),
    ],
  });
}

// ── Sub-handler: config ───────────────────────────────────────────────────────

async function handleConfig(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isStaff(interaction.member, interaction.guild.id)) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('🚫 Staff Only')
          .setDescription('Only staff members can configure the suggestion system.')
          .setTimestamp(),
      ],
    });
  }

  const { guild, user } = interaction;
  const guildConfig     = db.getGuild('config', guild.id);

  const thresholdOpt = interaction.options.getInteger('threshold');
  const notifyOpt    = interaction.options.getBoolean('notify');

  const hasChanges = thresholdOpt !== null || notifyOpt !== null;

  // ── View-only: no options provided ───────────────────────────────────────
  if (!hasChanges) {
    const currentThreshold = guildConfig.suggestionVoteThreshold    ?? 0;
    const currentNotify    = guildConfig.suggestionNotifyOnThreshold ?? false;
    const currentChannel   = guildConfig.suggestionChannelId
      ? `<#${guildConfig.suggestionChannelId}>`
      : '❌ Not configured';

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#5865F2')
          .setAuthor({
            name:    `${guild.name}  ·  Suggestion System Config`,
            iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
          })
          .setTitle('⚙️ Suggestion Settings')
          .addFields(
            {
              name:   '📺 Suggestion Channel',
              value:  currentChannel,
              inline: false,
            },
            {
              name:   '🗳️ Vote Threshold',
              value:  currentThreshold > 0
                ? `**${currentThreshold}** 👍 required before entering review queue`
                : '**Off** — all suggestions go straight to review',
              inline: false,
            },
            {
              name:   '🔔 Threshold Notifications',
              value:  currentNotify
                ? '**On** — bot posts a message when a suggestion crosses the threshold'
                : '**Off** — no channel notification when threshold is crossed',
              inline: false,
            },
            {
              name:   '🛠️ How to change',
              value:
                '`/suggestboard config threshold:5` — set minimum 👍 votes\n' +
                '`/suggestboard config threshold:0` — disable the threshold\n' +
                '`/suggestboard config notify:True` — enable threshold notifications\n' +
                '`/suggestionselector` — change the suggestion channel',
              inline: false,
            },
          )
          .setFooter({ text: 'Suggestion System  ·  Staff only' })
          .setTimestamp(),
      ],
    });
  }

  // ── Apply changes ─────────────────────────────────────────────────────────
  const changes = [];

  if (thresholdOpt !== null) {
    const prev = guildConfig.suggestionVoteThreshold ?? 0;
    guildConfig.suggestionVoteThreshold = Math.max(0, thresholdOpt);
    const newVal = guildConfig.suggestionVoteThreshold;
    changes.push({
      name:  '🗳️ Vote Threshold',
      value: newVal === 0
        ? `Disabled  (was **${prev}**)` 
        : `Set to **${newVal} 👍**  (was **${prev === 0 ? 'off' : prev}**)`,
      inline: false,
    });
  }

  if (notifyOpt !== null) {
    const prev = guildConfig.suggestionNotifyOnThreshold ?? false;
    guildConfig.suggestionNotifyOnThreshold = notifyOpt;
    changes.push({
      name:  '🔔 Threshold Notifications',
      value: `${notifyOpt ? '**On**' : '**Off**'}  (was **${prev ? 'on' : 'off'}**)`,
      inline: false,
    });
  }

  db.setGuild('config', guild.id, guildConfig);

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(config.successColor)
        .setAuthor({
          name:    `${guild.name}  ·  Suggestion System Config`,
          iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
        })
        .setTitle('✅ Settings Updated')
        .addFields(...changes, {
          name:   '👤 Changed By',
          value:  `${user}`,
          inline: false,
        })
        .setFooter({ text: 'Suggestion System  ·  Staff only' })
        .setTimestamp(),
    ],
  });
}

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  name: "suggestboard",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('suggestboard')
    .setDescription('Suggestion stats, leaderboard, and system configuration.')
    .addSubcommand(sub =>
      sub
        .setName('server')
        .setDescription('Server-wide suggestion leaderboard ranked by approvals.')
        .addIntegerOption(opt =>
          opt.setName('page').setDescription('Page number (default: 1)').setMinValue(1).setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('user')
        .setDescription("View a member's full suggestion history, votes, and staff notes.")
        .addUserOption(opt =>
          opt.setName('member').setDescription('The member to look up (defaults to you)').setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName('page').setDescription('Page number (default: 1)').setMinValue(1).setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('View or update suggestion system settings. (Staff only)')
        .addIntegerOption(opt =>
          opt
            .setName('threshold')
            .setDescription('Minimum 👍 votes needed before a suggestion enters review queue. 0 = off.')
            .setMinValue(0)
            .setMaxValue(50)
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('notify')
            .setDescription('Post a channel message when a suggestion crosses the vote threshold.')
            .setRequired(false)
        )
    ),
  cooldown: 8,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'config') return handleConfig(interaction);

    // server and user both need ephemeral defer
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'server') return handleServer(interaction);
    if (sub === 'user')   return handleUser(interaction);
  },
};
