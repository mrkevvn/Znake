'use strict';

// Message Reaction Add - handles poll votes, giveaway entries, and suggestion vote tracking
const { EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const { buildSuggestionEmbed } = require('../utils/suggestionEmbed');
const config = require('../config.json');

module.exports = {
  name: 'messageReactionAdd',
  once: false,
  async execute(client, reaction, user) {
    if (user.bot) return;

    // Fetch partial data if needed
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch(); } catch { return; }
    }

    const { message } = reaction;
    if (!message.guild) return;

    const guildId = message.guild.id;

    // ── Giveaway entry ────────────────────────────────────────────────────────
    if (reaction.emoji.name === '🎉') {
      const giveaways      = db.read('giveaways');
      const guildGiveaways = giveaways[guildId] ?? {};
      const giveaway       = guildGiveaways[message.id];

      if (giveaway && !giveaway.ended) {
        // ── Role requirement check ───────────────────────────────────────────
        if (giveaway.requireRoleId) {
          let member = message.guild.members.cache.get(user.id);
          if (!member) {
            try { member = await message.guild.members.fetch(user.id); } catch { /* ignore */ }
          }

          if (!member?.roles.cache.has(giveaway.requireRoleId)) {
            // Remove the reaction silently
            try { await reaction.users.remove(user.id); } catch { /* missing permissions */ }

            // DM the user explaining why they can't enter
            try {
              await user.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(config.errorColor ?? '#ED4245')
                    .setAuthor({
                      name:    `${message.guild.name}  ·  Giveaway Entry Denied`,
                      iconURL: message.guild.iconURL({ dynamic: true }) ?? undefined,
                    })
                    .setTitle('❌ You Cannot Enter This Giveaway')
                    .setDescription(
                      `You do not have the required role to enter the **${giveaway.prize}** giveaway in **${message.guild.name}**.`
                    )
                    .addFields(
                      { name: '🔒 Required Role', value: `<@&${giveaway.requireRoleId}>`, inline: true },
                      { name: '📺 Server',        value: message.guild.name,              inline: true },
                    )
                    .setFooter({ text: 'Obtain the required role and try again.' })
                    .setTimestamp(),
                ],
              });
            } catch { /* DMs closed — silently ignore */ }
            return;
          }
        }

        // ── Record entry ─────────────────────────────────────────────────────
        // Skip if already entered (base entry exists)
        const alreadyEntered = giveaway.entries.includes(user.id);
        if (!alreadyEntered) {
          // Base entry
          giveaway.entries.push(user.id);

          // Bonus entries for bonus role
          if (giveaway.bonusRoleId && giveaway.bonusMultiplier > 1) {
            let member = message.guild.members.cache.get(user.id);
            if (!member) {
              try { member = await message.guild.members.fetch(user.id); } catch { /* ignore */ }
            }
            if (member?.roles.cache.has(giveaway.bonusRoleId)) {
              // Add (multiplier - 1) extra copies so total = multiplier
              for (let i = 1; i < giveaway.bonusMultiplier; i++) {
                giveaway.entries.push(user.id);
              }
            }
          }

          giveaways[guildId][message.id] = giveaway;
          db.write('giveaways', giveaways);
        }
      }
    }

    // ── Poll vote ─────────────────────────────────────────────────────────────
    const polls      = db.read('polls');
    const guildPolls = polls[guildId] ?? {};
    const poll       = guildPolls[message.id];

    if (poll && !poll.ended) {
      const emoji = reaction.emoji.name;
      if (poll.options[emoji] !== undefined) {
        for (const [opt, data] of Object.entries(poll.options)) {
          if (opt !== emoji && data.voters?.includes(user.id)) {
            try {
              const otherReaction = message.reactions.cache.get(opt);
              if (otherReaction) await otherReaction.users.remove(user.id);
            } catch { /* ignore */ }
            poll.options[opt].voters = data.voters.filter(id => id !== user.id);
            poll.options[opt].count  = Math.max(0, (data.count || 0) - 1);
          }
        }

        if (!poll.options[emoji].voters) poll.options[emoji].voters = [];
        if (!poll.options[emoji].voters.includes(user.id)) {
          poll.options[emoji].voters.push(user.id);
          poll.options[emoji].count = (poll.options[emoji].count || 0) + 1;
          polls[guildId][message.id] = poll;
          db.write('polls', polls);
        }
      }
    }

    // ── Suggestion vote tracking ──────────────────────────────────────────────
    const emoji = reaction.emoji.name;
    if (emoji !== '👍' && emoji !== '👎') return;

    const suggestions      = db.read('suggestions');
    const guildSuggestions = suggestions[guildId] ?? {};
    const suggestion       = Object.values(guildSuggestions)
      .find(s => s.messageId === message.id && s.status === 'pending');

    if (!suggestion) return;

    if (!suggestion.votes) suggestion.votes = { up: 0, down: 0 };
    if (!suggestion.votes.upVoters) suggestion.votes.upVoters = [];
    if (!suggestion.votes.downVoters) suggestion.votes.downVoters = [];
    const previousUp = suggestion.votes.up;

    // Prevent double-counting: check if user already voted for this option
    if (emoji === '👍' && !suggestion.votes.upVoters.includes(user.id)) {
      suggestion.votes.upVoters.push(user.id);
      suggestion.votes.up = suggestion.votes.upVoters.length;
    }
    if (emoji === '👎' && !suggestion.votes.downVoters.includes(user.id)) {
      suggestion.votes.downVoters.push(user.id);
      suggestion.votes.down = suggestion.votes.downVoters.length;
    }

    suggestions[guildId][suggestion.id] = suggestion;
    db.write('suggestions', suggestions);

    // ── Threshold check ───────────────────────────────────────────────────────
    const guildConfig     = db.getGuild('config', guildId);
    const threshold       = guildConfig.suggestionVoteThreshold    ?? 0;
    const notifyThreshold = guildConfig.suggestionNotifyOnThreshold ?? false;

    if (threshold <= 0) return;

    const justCrossed = previousUp < threshold && suggestion.votes.up >= threshold;
    if (!justCrossed) return;

    // Edit the suggestion message to show unlocked status
    try {
      await message.edit({ embeds: [buildSuggestionEmbed(suggestion)] });
    } catch { /* message may be deleted or uneditable */ }

    // Optional channel notification
    if (notifyThreshold) {
      try {
        await message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor('#57F287')
              .setTitle('🗳️ Suggestion Ready for Review')
              .setDescription(
                `Suggestion \`${suggestion.id}\` has reached the vote threshold (**${threshold} 👍**) ` +
                `and is now in the staff review queue.`
              )
              .addFields(
                { name: '💡 Suggestion',  value: suggestion.text.length > 100 ? suggestion.text.slice(0, 97) + '…' : suggestion.text, inline: false },
                { name: '🗳️ Final Votes', value: `👍 **${suggestion.votes.up}**  ·  👎 **${suggestion.votes.down}**`,                inline: true  },
              )
              .setFooter({ text: 'Staff can review it with /suggestions' })
              .setTimestamp(),
          ],
        });
      } catch { /* ignore */ }
    }
  },
};
