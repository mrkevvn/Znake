'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const { buildSuggestionEmbed } = require('../../utils/suggestionEmbed');
const config = require('../../config.json');

module.exports = {
  name: "approve",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('approve')
    .setDescription('Approve a pending suggestion.')
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('The suggestion ID (e.g. EI5T77)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('note')
        .setDescription('Optional note to include with the approval')
        .setMaxLength(500)
        .setRequired(false)
    ),
  cooldown: 5,

  async execute(interaction) {
    // ── Defer FIRST — must happen within 3 seconds of Discord sending the interaction ──
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Staff Only')
            .setDescription('Only staff members can approve suggestions.')
            .setTimestamp(),
        ],
      });
    }

    const { guild, user } = interaction;
    const id   = interaction.options.getString('id').trim().toUpperCase();
    const note = interaction.options.getString('note')?.trim() || 'No note provided.';

    const suggestions     = db.read('suggestions');
    const guildSuggestions = suggestions[guild.id] ?? {};
    const suggestion      = guildSuggestions[id];

    if (!suggestion) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Suggestion Not Found')
            .setDescription(
              `No suggestion with ID \`${id}\` exists in this server.\n\n` +
              'Make sure you are using the exact ID shown on the suggestion embed.'
            )
            .setFooter({ text: 'Suggestion System' })
            .setTimestamp(),
        ],
      });
    }

    if (suggestion.status !== 'pending') {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('⚠️ Already Reviewed')
            .setDescription(`Suggestion \`${id}\` has already been marked as **${suggestion.status}**.`)
            .setFooter({ text: 'Suggestion System' })
            .setTimestamp(),
        ],
      });
    }

    // ── Snapshot reaction votes from the original message ────────────────────
    if (suggestion.channelId && suggestion.messageId) {
      try {
        const ch  = await guild.channels.fetch(suggestion.channelId);
        const msg = await ch?.messages.fetch(suggestion.messageId);
        if (msg) {
          const upReaction   = msg.reactions.cache.get('👍');
          const downReaction = msg.reactions.cache.get('👎');
          suggestion.votes = {
            up:   Math.max(0, (upReaction?.count   ?? 1) - 1),
            down: Math.max(0, (downReaction?.count ?? 1) - 1),
          };
        }
      } catch { /* silently skip */ }
    }

    // ── Update record ─────────────────────────────────────────────────────────
    suggestion.status       = 'approved';
    suggestion.reviewedBy   = user.globalName || user.username;
    suggestion.reviewedById = user.id;
    suggestion.reviewNote   = note;
    suggestion.reviewedAt   = Date.now();
    db.write('suggestions', suggestions);

    // ── Edit original suggestion embed ────────────────────────────────────────
    if (suggestion.channelId && suggestion.messageId) {
      try {
        const ch  = await guild.channels.fetch(suggestion.channelId);
        const msg = await ch?.messages.fetch(suggestion.messageId);
        if (msg) await msg.edit({ embeds: [buildSuggestionEmbed(suggestion)] });
      } catch { /* message may be deleted — silently skip */ }
    }

    // ── Post confirmation in suggestion channel ───────────────────────────────
    if (suggestion.channelId) {
      try {
        const ch = await guild.channels.fetch(suggestion.channelId);
        if (ch) {
          await ch.send({
            embeds: [
              new EmbedBuilder()
                .setColor(config.successColor)
                .setAuthor({
                  name: `${user.globalName || user.username}  •  Staff Decision`,
                  iconURL: user.displayAvatarURL({ dynamic: true }),
                })
                .setTitle('✅ Suggestion Approved')
                .addFields(
                  { name: '🆔 Suggestion ID', value: `\`${id}\``,                inline: true },
                  { name: '👤 Submitted By',  value: `<@${suggestion.userId}>`,  inline: true },
                  { name: '✅ Approved By',   value: `${user}`,                  inline: true },
                  { name: '📝 Note',          value: note,                       inline: false },
                )
                .setFooter({ text: 'Suggestion Board' })
                .setTimestamp(),
            ],
          });
        }
      } catch { /* skip */ }
    }

    // ── DM the user ───────────────────────────────────────────────────────────
    try {
      const submitter = await interaction.client.users.fetch(suggestion.userId);
      await submitter.send({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('✅ Your Suggestion Was Approved!')
            .setDescription(
              `Your suggestion in **${guild.name}** has been reviewed and **approved** by staff.\n\n` +
              `> ${suggestion.text.length > 200 ? suggestion.text.slice(0, 197) + '…' : suggestion.text}`
            )
            .addFields(
              { name: '🆔 Suggestion ID', value: `\`${id}\``,                inline: true },
              { name: '✅ Approved By',   value: user.globalName || user.username, inline: true },
              { name: '📝 Staff Note',    value: note,                       inline: false },
            )
            .setFooter({ text: `${guild.name}  •  Suggestion Board` })
            .setTimestamp(),
        ],
      });
    } catch { /* DMs may be closed */ }

    // ── Confirm to staff ──────────────────────────────────────────────────────
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.successColor)
          .setTitle('✅ Suggestion Approved')
          .addFields(
            { name: '🆔 Suggestion ID', value: `\`${id}\``,                inline: true },
            { name: '👤 Submitted By',  value: `<@${suggestion.userId}>`,  inline: true },
            { name: '📝 Note',          value: note,                       inline: false },
          )
          .setDescription('The suggestion embed has been updated and the user has been notified via DM.')
          .setFooter({ text: 'Suggestion System' })
          .setTimestamp(),
      ],
    });
  },
};
