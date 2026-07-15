'use strict';

const { MessageFlags } = require('discord.js');


const { JOIN_BUTTON_PREFIX } = require('./giveawayManager');
const db = require('./database');


async function handleGiveawayJoin(client, interaction) {
  const messageId = interaction.customId.split(':').slice(2).join(':');
  const guildId = interaction.guildId;

  const allGiveaways = db.read('giveaways');
  const giveaway = allGiveaways?.[guildId]?.[messageId];

  if (!giveaway || giveaway.ended) {
    return interaction.reply({
      content: 'This giveaway is no longer active.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Ensure state exists (migration-safe)
  if (!Array.isArray(giveaway.entries)) giveaway.entries = [];
  if (!Array.isArray(giveaway.participants)) giveaway.participants = [];
  if (!Array.isArray(giveaway.invalidEntries)) giveaway.invalidEntries = [];
  if (!Array.isArray(giveaway.disqualifiedUsers)) giveaway.disqualifiedUsers = [];


  // Eligibility engine
  const { eligibilityForInteraction } = require('./giveawayEligibility');
  const eligibility = await eligibilityForInteraction({
    client,
    interaction,
    giveaway,
  }).catch(() => ({ ok: false, reason: 'Eligibility check failed.' }));

  if (!eligibility.ok) {
    // Track invalid entry silently
    if (!giveaway.invalidEntries.includes(interaction.user.id)) {
      giveaway.invalidEntries.push(interaction.user.id);
    }

    return await interaction.reply({
      content: `❌ Entry rejected${eligibility.reason ? `: ${eligibility.reason}` : '.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const participantsSet = new Set(giveaway.entries.map(String));
  if (participantsSet.has(interaction.user.id)) {
    return await interaction.reply({
      content: '🎉 You are already entered in this giveaway!',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Store entry (write to both fields for backward compatibility)
  giveaway.entries.push(interaction.user.id);
  giveaway.participants.push(interaction.user.id);

  allGiveaways[guildId][messageId] = giveaway;
  db.write('giveaways', allGiveaways);

  // Live-update the announcement embed so the entry count stays current.
  try {
    const { buildActiveEmbed } = require('./giveawayManager');
    const botName = client.user?.username ?? 'Bot';
    if (interaction.message?.editable) {
      await interaction.message.edit({
        embeds: [buildActiveEmbed(giveaway, interaction.guild, botName)],
      }).catch(() => {});
    }
  } catch (_) {
    // Non-fatal: entry is already recorded even if the embed refresh fails.
  }

  return await interaction.reply({
    content: '🎉 You have successfully entered the giveaway!',
    flags: MessageFlags.Ephemeral,
  });
}


module.exports = { handleGiveawayJoin, JOIN_BUTTON_PREFIX };

