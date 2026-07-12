'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const { generateId, parseDuration } = require('../../utils/formatters');
const config = require('../../config.json');

const VOTE_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const MEDAL = ['🥇', '🥈', '🥉'];

function buildBar(votes, total, length = 12) {
  if (total === 0) return '░'.repeat(length);
  const filled = Math.round((votes / total) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function buildPollEmbed(question, optionsList, pollId, endTime, creator) {
  const separator = '─'.repeat(32);

  const optionLines = optionsList.map((opt, i) =>
    `${VOTE_EMOJIS[i]}  ${opt}`
  ).join('\n');

  const durationLine = endTime
    ? `⏱️  Closes <t:${Math.floor(endTime / 1000)}:R> — <t:${Math.floor(endTime / 1000)}:f>`
    : '⏱️  No expiry — open until manually ended';

  return new EmbedBuilder()
    .setColor(config.embedColor || '#5865F2')
    .setAuthor({
      name: '📊  Active Poll',
      iconURL: creator.displayAvatarURL({ dynamic: true }),
    })
    .setTitle(question)
    .setDescription(
      `\`${separator}\`\n` +
      `${optionLines}\n` +
      `\`${separator}\`\n\n` +
      `${durationLine}`
    )
    .addFields({
      name: '🗳️  How to Vote',
      value: 'React with the number emoji matching your choice below.',
      inline: false,
    })
    .setFooter({
      text: `Poll ID: ${pollId}  •  Created by ${creator.username}`,
      iconURL: creator.displayAvatarURL({ dynamic: true }),
    })
    .setTimestamp();
}

function buildResultsEmbed(poll, messageId, ended, requestedBy) {
  const options = poll.options;
  const totalVotes = Object.values(options).reduce((a, o) => a + (o.count || 0), 0);

  // Sort options by votes descending for winner detection
  const sorted = Object.entries(options)
    .map(([emoji, o]) => ({ emoji, text: o.text, count: o.count || 0 }))
    .sort((a, b) => b.count - a.count);

  const winner = sorted[0];
  const isTie = sorted.length > 1 && sorted[0].count === sorted[1].count && sorted[0].count > 0;

  // Build per-option result rows (in original order)
  const originalOrder = Object.entries(options).map(([emoji, o]) => ({ emoji, text: o.text, count: o.count || 0 }));

  const resultLines = originalOrder.map(({ emoji, text, count }) => {
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const bar = buildBar(count, totalVotes);
    const isTop = !isTie && count === winner.count && count > 0;
    return (
      `${isTop ? '**' : ''}${emoji}  ${text}${isTop ? '**' : ''}\n` +
      `\`${bar}\`  **${pct}%**  *(${count} vote${count !== 1 ? 's' : ''})*`
    );
  });

  const winnerLine = totalVotes === 0
    ? '> ⚠️  No votes were cast.'
    : isTie
    ? `> 🤝  **It's a tie!** — ${sorted.filter(o => o.count === sorted[0].count).map(o => `**${o.text}**`).join(' & ')} are equal.`
    : `> 🏆  **${winner.text}** wins with **${winner.count}** vote${winner.count !== 1 ? 's' : ''} (${Math.round(winner.count / totalVotes * 100)}%)`;

  const statusLabel = ended ? '🔴  Poll Ended' : '🟢  Live Results';
  const separator = '─'.repeat(32);

  return new EmbedBuilder()
    .setColor(ended ? config.errorColor || '#ED4245' : config.successColor || '#57F287')
    .setAuthor({ name: `📊  ${statusLabel}` })
    .setTitle(poll.question)
    .setDescription(
      `${winnerLine}\n\n` +
      `\`${separator}\`\n` +
      resultLines.join('\n\n') +
      `\n\`${separator}\``
    )
    .addFields(
      { name: '🗳️  Total Votes', value: `${totalVotes}`, inline: true },
      { name: '📋  Options', value: `${Object.keys(options).length}`, inline: true },
      { name: '🆔  Poll ID', value: poll.id, inline: true },
    )
    .setFooter({
      text: `${ended ? 'Ended' : 'Results checked'} by ${requestedBy.username}  •  Message ID: ${messageId}`,
      iconURL: requestedBy.displayAvatarURL({ dynamic: true }),
    })
    .setTimestamp();
}

module.exports = {
  name: "poll",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create and manage server polls.')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new poll in a channel.')
        .addStringOption(opt =>
          opt.setName('question')
            .setDescription('The poll question')
            .setMinLength(5)
            .setMaxLength(200)
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('options')
            .setDescription('Options separated by | or comma — e.g. Yes | No | Maybe')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('duration')
            .setDescription('How long the poll runs — e.g. 1h, 30m, 2d (leave blank for no expiry)')
            .setRequired(false)
        )
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel to post the poll in (defaults to current channel)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End a poll and display the final results.')
        .addStringOption(opt =>
          opt.setName('messageid')
            .setDescription('The message ID of the poll to end')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('results')
        .setDescription('View the current live results of an active poll.')
        .addStringOption(opt =>
          opt.setName('messageid')
            .setDescription('The message ID of the poll')
            .setRequired(true)
        )
    ),

  cooldown: 10,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;

    const polls = db.read('polls');
    if (!polls[guild.id]) polls[guild.id] = {};

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (sub === 'create') {
      if (!isStaff(interaction.member, guild.id)) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('🚫 Staff Only')
              .setDescription('Only staff members can create polls.')
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const question = interaction.options.getString('question').trim();
      const optionsStr = interaction.options.getString('options');
      const durationStr = interaction.options.getString('duration');

      const separator = optionsStr.includes('|') ? '|' : ',';
      const optionsList = optionsStr.split(separator).map(o => o.trim()).filter(Boolean).slice(0, 10);

      if (optionsList.length < 2) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Not Enough Options')
              .setDescription(
                'Provide at least **2 options** separated by `|` or `,`.\n\n' +
                '**Examples:**\n' +
                '> `Yes | No | Maybe`\n' +
                '> `Option A, Option B, Option C`'
              )
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const ms = durationStr ? parseDuration(durationStr) : null;
      if (durationStr && !ms) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Invalid Duration')
              .setDescription('Use a valid format like `30m`, `2h`, `1d`, or `1h30m`.')
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const endTime = ms ? Date.now() + ms : null;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let targetChannel;
      const channelOption = interaction.options.getChannel('channel');
      if (channelOption) {
        try {
          targetChannel = await guild.channels.fetch(channelOption.id);
        } catch {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(config.errorColor)
                .setTitle('❌ Channel Not Found')
                .setDescription('Could not resolve that channel. Make sure I have access to it.')
                .setTimestamp(),
            ],
          });
        }
      } else {
        targetChannel = interaction.channel;
      }

      const pollId = generateId(6);
      const pollOptions = {};
      for (let i = 0; i < optionsList.length; i++) {
        pollOptions[VOTE_EMOJIS[i]] = { text: optionsList[i], count: 0, voters: [] };
      }

      const pollEmbed = buildPollEmbed(question, optionsList, pollId, endTime, user);

      let pollMsg;
      try {
        pollMsg = await targetChannel.send({ embeds: [pollEmbed] });
        for (const emoji of Object.keys(pollOptions)) {
          await pollMsg.react(emoji);
        }
      } catch (err) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Failed to Post Poll')
              .setDescription(`Could not post in ${targetChannel}: \`${err.message}\``)
              .setTimestamp(),
          ],
        });
      }

      polls[guild.id][pollMsg.id] = {
        id: pollId,
        question,
        options: pollOptions,
        channelId: targetChannel.id,
        createdBy: user.id,
        ended: false,
        endTime: endTime || null,
      };
      db.write('polls', polls);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('✅ Poll Created')
            .setDescription(
              `Your poll is live in ${targetChannel}!\n\n` +
              `**Question:** ${question}\n` +
              `**Options:** ${optionsList.length}\n` +
              (endTime ? `**Closes:** <t:${Math.floor(endTime / 1000)}:R>` : '**Expiry:** None — end it manually with `/poll end`')
            )
            .setFooter({ text: `Poll ID: ${pollId}  •  Message ID: ${pollMsg.id}` })
            .setTimestamp(),
        ],
      });
    }

    // ── END & RESULTS ────────────────────────────────────────────────────────
    if (sub === 'end' || sub === 'results') {
      if (sub === 'end' && !isStaff(interaction.member, guild.id)) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('🚫 Staff Only')
              .setDescription('Only staff members can end polls.')
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ ephemeral: sub === 'results' });

      const messageId = interaction.options.getString('messageid').trim();
      const poll = polls[guild.id][messageId];

      if (!poll) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Poll Not Found')
              .setDescription('No poll found with that message ID in this server.\n\nMake sure you copied the **message ID** of the poll, not the poll ID.')
              .setTimestamp(),
          ],
        });
      }

      if (sub === 'end' && poll.ended) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.warningColor)
              .setTitle('⚠️ Already Ended')
              .setDescription('This poll has already been ended.')
              .setTimestamp(),
          ],
        });
      }

      // Sync reaction counts from the live message if possible
      try {
        const pollChannel = await guild.channels.fetch(poll.channelId);
        const pollMsg = await pollChannel.messages.fetch(messageId);

        for (const [emoji, opt] of Object.entries(poll.options)) {
          const reaction = pollMsg.reactions.cache.get(emoji);
          opt.count = reaction ? Math.max(0, reaction.count - 1) : opt.count; // subtract bot's own reaction
        }
      } catch { /* message may be deleted — use stored counts */ }

      const ended = sub === 'end';
      const resultEmbed = buildResultsEmbed(poll, messageId, ended, user);

      if (ended) {
        poll.ended = true;
        db.write('polls', polls);
      }

      return interaction.editReply({ embeds: [resultEmbed] });
    }
  },
};
