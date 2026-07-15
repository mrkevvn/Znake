'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');

const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const { buildSuggestionEmbed, buildVoteBar } = require('../../utils/suggestionEmbed');
const config = require('../../config.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSuggestionThreshold(guildId) {
  const guildConfig = db.getGuild('config', guildId);
  return guildConfig.suggestionVoteThreshold ?? 0;
}

function getPending(guildId) {
  const threshold = getSuggestionThreshold(guildId);
  const data      = db.read('suggestions');
  return Object.values(data[guildId] ?? {})
    .filter(s => s.status === 'pending')
    .map(s => ({
      ...s,
      locked: threshold > 0 && (s.votes?.up ?? 0) < threshold,
      threshold,
    }))
    .sort((a, b) => {
      // Ready suggestions first, then locked
      if (a.locked !== b.locked) return a.locked ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
}

function buildBrowserEmbed(suggestion, index, total, guild) {
  const votes    = suggestion.votes ?? { up: 0, down: 0 };
  const locked   = suggestion.locked ?? false;
  const threshold = suggestion.threshold ?? 0;

  const readyCount  = /* will be passed if needed */ null; // not used in embed
  const color       = locked ? '#4F545C' : '#5865F2';
  const lockBadge   = locked
    ? `🔒  **Vote-locked** — needs **${threshold} 👍** to enter review  ·  currently **${votes.up}/${threshold}**`
    : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name:    `🗳️  Suggestion Review Queue  ·  ${index + 1} of ${total}`,
      iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
    })
    .setTitle(`${locked ? '🔒' : '📋'}  Suggestion  #${suggestion.id}`)
    .setThumbnail(suggestion.userAvatar ?? null)
    .setDescription(lockBadge ? `${lockBadge}\n\n>>> ${suggestion.text}` : `>>> ${suggestion.text}`)
    .addFields(
      { name: '👤 Submitted By',    value: `<@${suggestion.userId}>`,                              inline: true },
      { name: '📅 Submitted',       value: `<t:${Math.floor(suggestion.createdAt / 1000)}:R>`,     inline: true },
      { name: '🆔 ID',              value: `\`${suggestion.id}\``,                                 inline: true },
      { name: '🗳️ Community Votes', value: buildVoteBar(votes.up, votes.down),                    inline: false },
    )
    .setFooter({
      text: locked
        ? `🔒 Vote-locked  ·  ${index + 1}/${total}  ·  Navigate with arrows`
        : `📋 ${total} pending  ·  ${index + 1}/${total}  ·  Use the buttons below to review`,
    })
    .setTimestamp(new Date(suggestion.createdAt));

  return embed;
}

function buildEmptyEmbed(guild) {
  return new EmbedBuilder()
    .setColor('#57F287')
    .setAuthor({
      name:    '🗳️  Suggestion Review Queue',
      iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
    })
    .setTitle('✅ All Clear!')
    .setDescription('There are no pending suggestions to review right now.\n\nNew suggestions submitted with `/suggest` will appear here.')
    .setFooter({ text: 'Suggestion Board' })
    .setTimestamp();
}

function buildRow(index, total, disableAll = false, locked = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sug_prev')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableAll || index === 0),

    new ButtonBuilder()
      .setCustomId('sug_approve')
      .setLabel('Approve')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disableAll || locked),

    new ButtonBuilder()
      .setCustomId('sug_deny')
      .setLabel('Deny')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disableAll || locked),

    new ButtonBuilder()
      .setCustomId('sug_next')
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableAll || index >= total - 1),
  );
}

// ── Apply a staff decision ────────────────────────────────────────────────────

async function applyDecision({ interaction, suggestion, status, noteOrReason, guild }) {
  const suggestions = db.read('suggestions');
  const record      = suggestions[guild.id]?.[suggestion.id];
  if (!record || record.status !== 'pending') return;

  // ── Snapshot community votes before closing ───────────────────────────────
  if (record.channelId && record.messageId) {
    try {
      const ch  = await guild.channels.fetch(record.channelId);
      const msg = await ch?.messages.fetch(record.messageId);
      if (msg) {
        const upReaction   = msg.reactions.cache.get('👍');
        const downReaction = msg.reactions.cache.get('👎');
        record.votes = {
          up:   Math.max(0, (upReaction?.count   ?? 1) - 1),
          down: Math.max(0, (downReaction?.count ?? 1) - 1),
        };
      }
    } catch { /* silently skip */ }
  }

  record.status       = status;
  record.reviewedBy   = interaction.user.globalName || interaction.user.username;
  record.reviewedById = interaction.user.id;
  record.reviewNote   = noteOrReason || (status === 'approved' ? 'No note provided.' : 'No reason provided.');
  record.reviewedAt   = Date.now();
  db.write('suggestions', suggestions);

  const updatedEmbed = buildSuggestionEmbed(record);

  // Edit original suggestion embed
  if (record.channelId && record.messageId) {
    try {
      const ch  = await guild.channels.fetch(record.channelId);
      const msg = await ch?.messages.fetch(record.messageId);
      if (msg) await msg.edit({ embeds: [updatedEmbed] });
    } catch { /* silently skip if deleted */ }
  }

  // Post channel notice
  if (record.channelId) {
    try {
      const ch         = await guild.channels.fetch(record.channelId);
      const isApproved = status === 'approved';
      if (ch) {
        await ch.send({
          embeds: [
            new EmbedBuilder()
              .setColor(isApproved ? config.successColor : config.errorColor)
              .setAuthor({
                name:    `${interaction.user.globalName || interaction.user.username}  •  Staff Decision`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
              })
              .setTitle(isApproved ? '✅ Suggestion Approved' : '❌ Suggestion Denied')
              .addFields(
                { name: '🆔 Suggestion ID', value: `\`${record.id}\``,             inline: true },
                { name: '👤 Submitted By',  value: `<@${record.userId}>`,           inline: true },
                { name: isApproved ? '✅ Approved By' : '❌ Denied By', value: `${interaction.user}`, inline: true },
                { name: isApproved ? '📝 Note' : '📝 Reason', value: record.reviewNote, inline: false },
              )
              .setFooter({ text: 'Suggestion Board' })
              .setTimestamp(),
          ],
        });
      }
    } catch { /* skip */ }
  }

  // DM the submitter
  try {
    const submitter  = await interaction.client.users.fetch(record.userId);
    const isApproved = status === 'approved';
    await submitter.send({
      embeds: [
        new EmbedBuilder()
          .setColor(isApproved ? config.successColor : config.errorColor)
          .setTitle(isApproved ? '✅ Your Suggestion Was Approved!' : '❌ Your Suggestion Was Denied')
          .setDescription(
            `Your suggestion in **${guild.name}** has been **${status}** by staff.\n\n` +
            `> ${record.text.length > 200 ? record.text.slice(0, 197) + '…' : record.text}`
          )
          .addFields(
            { name: '🆔 Suggestion ID', value: `\`${record.id}\``,                   inline: true },
            { name: isApproved ? '✅ Approved By' : '❌ Denied By', value: record.reviewedBy, inline: true },
            { name: isApproved ? '📝 Staff Note' : '📝 Reason', value: record.reviewNote,    inline: false },
          )
          .setFooter({ text: `${guild.name}  •  Suggestion Board` })
          .setTimestamp(),
      ],
    });
  } catch { /* DMs closed */ }
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "suggestions",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('suggestions')
    .setDescription('Browse and review pending suggestions interactively. (Staff only)'),
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Staff Only')
            .setDescription('Only staff members can access the suggestion review queue.')
            .setTimestamp(),
        ],
      });
    }

    const { guild, user } = interaction;
    let pending = getPending(guild.id);
    let index   = 0;

    // ── Empty state ───────────────────────────────────────────────────────────
    if (pending.length === 0) {
      return interaction.editReply({ embeds: [buildEmptyEmbed(guild)], components: [] });
    }

    // ── Initial render ────────────────────────────────────────────────────────
    const reply = await interaction.editReply({
      embeds:     [buildBrowserEmbed(pending[index], index, pending.length, guild)],
      components: [buildRow(index, pending.length, false, pending[index].locked)],
    });

    // ── Button collector (5 min) ──────────────────────────────────────────────
    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === user.id,
      time: 5 * 60 * 1000,
    });

    collector.on('collect', async (btn) => {
      try {
        // ── Navigation ───────────────────────────────────────────────────────
        if (btn.customId === 'sug_prev' || btn.customId === 'sug_next') {
          pending = getPending(guild.id);
          if (pending.length === 0) {
            await btn.update({ embeds: [buildEmptyEmbed(guild)], components: [] });
            collector.stop('empty');
            return;
          }
          if (btn.customId === 'sug_prev') index = Math.max(0, index - 1);
          if (btn.customId === 'sug_next') index = Math.min(pending.length - 1, index + 1);
          await btn.update({
            embeds:     [buildBrowserEmbed(pending[index], index, pending.length, guild)],
            components: [buildRow(index, pending.length, false, pending[index].locked)],
          });
          return;
        }

        // ── Approve ──────────────────────────────────────────────────────────
        if (btn.customId === 'sug_approve') {
          const current = pending[index];
          if (current.locked) { await btn.deferUpdate(); return; } // guard

          const modal = new ModalBuilder()
            .setCustomId(`sug_approve_modal_${current.id}`)
            .setTitle(`Approve  •  #${current.id}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('note')
                  .setLabel('Staff note (optional)')
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('Add a note for the user explaining the decision...')
                  .setMaxLength(500)
                  .setRequired(false)
              )
            );

          await btn.showModal(modal);

          let modalSubmit;
          try {
            modalSubmit = await btn.awaitModalSubmit({
              filter: i => i.user.id === user.id && i.customId === `sug_approve_modal_${current.id}`,
              time: 120_000,
            });
          } catch { return; }

          await modalSubmit.deferUpdate();
          const note = modalSubmit.fields.getTextInputValue('note')?.trim() || 'No note provided.';

          await applyDecision({ interaction, suggestion: current, status: 'approved', noteOrReason: note, guild });

          pending = getPending(guild.id);
          index   = Math.min(index, Math.max(0, pending.length - 1));

          if (pending.length === 0) {
            await interaction.editReply({ embeds: [buildEmptyEmbed(guild)], components: [] });
            collector.stop('empty');
          } else {
            await interaction.editReply({
              embeds:     [buildBrowserEmbed(pending[index], index, pending.length, guild)],
              components: [buildRow(index, pending.length, false, pending[index].locked)],
            });
          }
          return;
        }

        // ── Deny ─────────────────────────────────────────────────────────────
        if (btn.customId === 'sug_deny') {
          const current = pending[index];
          if (current.locked) { await btn.deferUpdate(); return; } // guard

          const modal = new ModalBuilder()
            .setCustomId(`sug_deny_modal_${current.id}`)
            .setTitle(`Deny  •  #${current.id}`)
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('reason')
                  .setLabel('Reason for denial (optional)')
                  .setStyle(TextInputStyle.Paragraph)
                  .setPlaceholder('Explain why this suggestion is being denied...')
                  .setMaxLength(500)
                  .setRequired(false)
              )
            );

          await btn.showModal(modal);

          let modalSubmit;
          try {
            modalSubmit = await btn.awaitModalSubmit({
              filter: i => i.user.id === user.id && i.customId === `sug_deny_modal_${current.id}`,
              time: 120_000,
            });
          } catch { return; }

          await modalSubmit.deferUpdate();
          const reason = modalSubmit.fields.getTextInputValue('reason')?.trim() || 'No reason provided.';

          await applyDecision({ interaction, suggestion: current, status: 'denied', noteOrReason: reason, guild });

          pending = getPending(guild.id);
          index   = Math.min(index, Math.max(0, pending.length - 1));

          if (pending.length === 0) {
            await interaction.editReply({ embeds: [buildEmptyEmbed(guild)], components: [] });
            collector.stop('empty');
          } else {
            await interaction.editReply({
              embeds:     [buildBrowserEmbed(pending[index], index, pending.length, guild)],
              components: [buildRow(index, pending.length, false, pending[index].locked)],
            });
          }
          return;
        }

      } catch {
        try { await btn.deferUpdate(); } catch { /* ignore */ }
      }
    });

    // ── Timeout — disable all buttons ─────────────────────────────────────────
    collector.on('end', async (_, reason) => {
      if (reason === 'empty') return;
      try {
        const cur = getPending(guild.id);
        if (cur.length === 0) {
          await interaction.editReply({ embeds: [buildEmptyEmbed(guild)], components: [] });
        } else {
          await interaction.editReply({ components: [buildRow(index, cur.length, true)] });
        }
      } catch { /* interaction may have expired */ }
    });
  },
};
