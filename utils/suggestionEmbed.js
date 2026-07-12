'use strict';

const { EmbedBuilder } = require('discord.js');

const STATUS_META = {
  pending:  { color: '#FEE75C', label: '⏳ Pending Review', badge: '🟡' },
  approved: { color: '#57F287', label: '✅ Approved',        badge: '🟢' },
  denied:   { color: '#ED4245', label: '❌ Denied',          badge: '🔴' },
};

/**
 * Build a compact vote bar.
 * e.g.  👍 ████████░░░░  8   ·   👎 ████░░░░░░░░  4
 */
function buildVoteBar(up = 0, down = 0, len = 12) {
  const total  = up + down;
  const upFill = total > 0 ? Math.round((up   / total) * len) : 0;
  const dnFill = total > 0 ? Math.round((down / total) * len) : 0;

  const upBar = `${'█'.repeat(upFill)}${'░'.repeat(len - upFill)}`;
  const dnBar = `${'█'.repeat(dnFill)}${'░'.repeat(len - dnFill)}`;

  return `👍 \`${upBar}\` **${up}**   ·   👎 \`${dnBar}\` **${down}**`;
}

/**
 * Build a threshold progress bar.
 * e.g.  ████████░░░░  8 / 10 votes
 */
function buildThresholdBar(current, threshold, len = 12) {
  const ratio  = Math.min(current / threshold, 1);
  const filled = Math.round(ratio * len);
  return `\`${'█'.repeat(filled)}${'░'.repeat(len - filled)}\`  **${current} / ${threshold}** 👍 needed`;
}

/**
 * Build the canonical suggestion embed for any status.
 *
 * Accepts an optional `threshold` (int) — when > 0 and the suggestion is
 * pending with fewer 👍 votes than the threshold, a 🔒 "vote-locked" state
 * is shown instead of the normal ⏳ pending state.
 *
 * @param {object} suggestion  - Full suggestion data object from DB
 * @param {number} [threshold] - Optional vote threshold (0 = off)
 */
function buildSuggestionEmbed(suggestion, threshold = 0) {
  const votes  = suggestion.votes ?? { up: 0, down: 0 };
  const locked = suggestion.status === 'pending' && threshold > 0 && votes.up < threshold;

  const meta = locked
    ? { color: '#4F545C', label: '🔒 Awaiting Votes', badge: '🔒' }
    : (STATUS_META[suggestion.status] ?? STATUS_META.pending);

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({
      name:    `${suggestion.userTag ?? 'Unknown User'}  •  💡 Suggestion`,
      iconURL: suggestion.userAvatar ?? undefined,
    })
    .setTitle(`${meta.badge}  Suggestion  #${suggestion.id}`)
    .setDescription(`>>> ${suggestion.text}`)
    .addFields(
      { name: '👤 Submitted By',  value: `<@${suggestion.userId}>`,                          inline: true },
      { name: '📅 Submitted',     value: `<t:${Math.floor(suggestion.createdAt / 1000)}:R>`, inline: true },
      { name: `${meta.badge} Status`, value: meta.label,                                     inline: true },
    );

  // ── Vote display ───────────────────────────────────────────────────────────
  if (locked) {
    // Show a progress bar toward the threshold
    embed.addFields({
      name:   '🗳️ Vote Progress',
      value:  buildThresholdBar(votes.up, threshold),
      inline: false,
    });
  } else {
    embed.addFields({
      name:   '🗳️ Community Votes',
      value:  buildVoteBar(votes.up, votes.down),
      inline: false,
    });
  }

  // ── Review info (approved / denied only) ───────────────────────────────────
  if (suggestion.status !== 'pending' && suggestion.reviewedBy) {
    const actionLabel   = suggestion.status === 'approved' ? '✅ Approved By' : '❌ Denied By';
    const noteLabel     = suggestion.status === 'approved' ? '📝 Note'        : '📝 Reason';
    const reviewerValue = suggestion.reviewedById
      ? `<@${suggestion.reviewedById}>`
      : suggestion.reviewedBy;
    const reviewedAtTs  = suggestion.reviewedAt
      ? `<t:${Math.floor(suggestion.reviewedAt / 1000)}:R>`
      : 'Unknown';

    embed.addFields(
      { name: actionLabel,   value: reviewerValue,                                inline: true  },
      { name: '📅 Actioned', value: reviewedAtTs,                                 inline: true  },
      { name: '\u200b',      value: '\u200b',                                     inline: true  },
      { name: noteLabel,     value: suggestion.reviewNote || 'No note provided.', inline: false },
    );
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerParts = ['Suggestion Board', `ID: ${suggestion.id}`];
  if (locked) {
    footerParts.push(`Needs ${threshold - votes.up} more 👍 to enter review`);
  } else if (suggestion.status === 'pending') {
    footerParts.push(`Staff: /approve ${suggestion.id}  or  /deny ${suggestion.id}`);
  }

  embed
    .setFooter({ text: footerParts.join('  •  ') })
    .setTimestamp(new Date(suggestion.reviewedAt ?? suggestion.createdAt));

  return embed;
}

module.exports = { buildSuggestionEmbed, buildVoteBar, buildThresholdBar };
