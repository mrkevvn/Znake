'use strict';

const { EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonStyle, ButtonBuilder } = require('discord.js');

const db = require('./database');
const config = require('../config.json');
const { isStaff } = require('./../utils/permissions');
const { parseDuration } = require('./formatters');
const { buildActiveEmbed, buildEndedEmbed, pickWinnersCrypto } = require('./giveawayManager');
const { setWizardState, getWizardState, deleteWizardState } = require('./giveawayWizard');

const WIZARD_TTL_MS = 10 * 60_000;

function buildPreviewEmbed(giveawayData, botUser) {
  const requirements = [];
  if (giveawayData.requirements?.requiredRoleId) requirements.push(`Required Role: <@&${giveawayData.requirements.requiredRoleId}>`);
  if (typeof giveawayData.requirements?.requiredInvites === 'number' && giveawayData.requirements.requiredInvites > 0) {
    requirements.push(`Required Invites: ${giveawayData.requirements.requiredInvites}`);
  }
  if (typeof giveawayData.requirements?.requiredMessages === 'number' && giveawayData.requirements.requiredMessages > 0) {
    requirements.push(`Required Messages: ${giveawayData.requirements.requiredMessages}`);
  }

  const reqText = requirements.length ? requirements.join('\n') : 'None';

  return new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('🎯 Giveaway Setup Preview')
    .addFields(
      { name: '🎁 Prize', value: giveawayData.prize || 'Unknown', inline: false },
      { name: '⏱ Duration', value: giveawayData.durationLabel || 'Unknown', inline: false },
      { name: '🏆 Winners', value: String(giveawayData.winnerCount ?? 1), inline: false },
      { name: '📌 Requirements', value: reqText, inline: false },
    )
    .setFooter({ text: 'Choose an action to proceed' })
    .setTimestamp();
}

function dynamicHype(prize) {
  const p = prize || 'a prize';
  const variants = [
    `🎉 Big news everyone! A wild ${p} just dropped!`,
    `🔥 Don’t miss this — ${p} is live!`,
    `🎁 Something special awaits: ${p}!`,
    `🚨 Giveaway alert! ${p} is up for grabs!`,
  ];
  const idx = Math.abs(require('crypto').createHash('sha256').update(p).digest()[0]) % variants.length;
  return variants[idx];
}

async function startGiveawayFromWizard(client, guildId, wizardId, interaction) {
  const state = getWizardState(guildId, wizardId);
  if (!state || state.step !== 3 || !state.data) {
    return interaction.reply({ content: 'Wizard state expired. Please run /giveaway again.', flags: MessageFlags.Ephemeral });
  }

  const giveaway = state.data;
  const channelId = giveaway.channelId || state.previewChannelId;
  const imageUrl = state.imageUrl || giveaway.image || null;

  // ── ATOMIC CLAIM ──────────────────────────────────────────────────────────
  // Delete the wizard session RIGHT NOW, before any async yields (guild.fetch,
  // channel.fetch, channel.send).  This ensures that if the user clicks Confirm
  // multiple times in rapid succession, the SECOND click will fail the
  // getWizardState check above and never reach channel.send.
  deleteWizardState(guildId, wizardId);

  // ── Everything below is safe from double-execution ────────────────────────

  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return interaction.reply({ content: 'Guild not found.', flags: MessageFlags.Ephemeral });
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return interaction.reply({ content: 'Target channel not found.', flags: MessageFlags.Ephemeral });
  }

  const botName = client.user?.username ?? 'Bot';

  const record = {
    messageId: null,
    channelId,
    endTime: Date.now() + giveaway.durationMs,
    prize: giveaway.prize,
    title: giveaway.title,
    maxWinners: giveaway.winnerCount,
    winnerCount: giveaway.winnerCount,
    durationMs: giveaway.durationMs,
    requirements: giveaway.requirements,
    requirement: giveaway.requirementLegacy || giveaway.requirementsText || 'None',
    image: imageUrl,
    entries: [],
    participants: [],
    invalidEntries: [],
    ended: false,
    winners: [],
    hostedBy: interaction.user.id,
    disqualifiedUsers: [],
    createdAt: Date.now(),
  };

  const content = `@everyone\n${dynamicHype(giveaway.prize)}`;

  const msg = await channel.send({
    content,
    embeds: [buildActiveEmbed(record, guild, botName)],
    components: [require('./giveawayManager').buildJoinButton('PENDING')],
  });

  record.messageId = msg.id;

  await msg.edit({
    embeds: [buildActiveEmbed(record, guild, botName)],
    components: [require('./giveawayManager').buildJoinButton(msg.id)],
  }).catch(() => {});

  const all = db.read('giveaways');
  if (!all[guildId]) all[guildId] = {};
  all[guildId][msg.id] = record;
  db.write('giveaways', all);

  await interaction.update({
    content: `✅ Giveaway started! [Message ID: ${msg.id}]`,
    embeds: [],
    components: [],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function handleGiveawayWizardButton(client, interaction) {
  // customId format: `giveaway_wizard_<action>:<wizardId>`
  // The action lives in the prefix segment (before the first colon); the
  // wizardId is everything after it and itself contains colons
  // (`gw:<guildId>:<userId>:<interactionId>`).
  const firstColon = interaction.customId.indexOf(':');
  const prefix = firstColon === -1 ? interaction.customId : interaction.customId.slice(0, firstColon);
  const action = prefix.replace('giveaway_wizard_', '');
  const wizardId = firstColon === -1 ? '' : interaction.customId.slice(firstColon + 1);

  const guildId = interaction.guildId;
  if (!guildId) return;

  if (!isStaff(interaction.member, guildId)) {
    return interaction.reply({ content: '🚫 Staff Only', flags: MessageFlags.Ephemeral });
  }

  if (action === 'confirm') {
    return startGiveawayFromWizard(client, guildId, wizardId, interaction);
  }

  if (action === 'cancel') {
    deleteWizardState(guildId, wizardId);
    return interaction.update({ content: '❌ Wizard cancelled.', embeds: [], components: [] }).catch(() => {});
  }

  if (action === 'edit') {
    const state = getWizardState(guildId, wizardId);
    if (!state) {
      return interaction.reply({ content: 'Wizard expired. Please run /giveaway again.', flags: MessageFlags.Ephemeral });
    }

    // Reopen modal with current data as defaults (Discord modals don't support defaults natively; we just prefill in labels? keep simple)
    const { prize, durationStr, winnerCount, requirementsText } = state.data || {};

    const modal = new ModalBuilder()
      .setCustomId(`giveaway_wizard_modal:${wizardId}`)
      .setTitle('🎯 Create Giveaway');

    const prizeInput = new TextInputBuilder().setCustomId('prize').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true);
    const durationInput = new TextInputBuilder().setCustomId('duration').setLabel('Duration').setStyle(TextInputStyle.Short).setRequired(true);
    const winnersInput = new TextInputBuilder().setCustomId('winners').setLabel('Winners').setStyle(TextInputStyle.Short).setRequired(true);

    const reqInput = new TextInputBuilder()
      .setCustomId('requirements')
      .setLabel('Required Role / Invites / Messages')
      .setPlaceholder('role:<roleId>, invites:<count>, messages:<count>')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    // Note: discord.js modal TextInputBuilder has setValue for prefill.
    if (prize) prizeInput.setValue(String(prize).slice(0, 100));
    if (durationStr) durationInput.setValue(String(durationStr));
    if (winnerCount) winnersInput.setValue(String(winnerCount));
    if (requirementsText) reqInput.setValue(String(requirementsText).slice(0, 1000));

    modal.addComponents(
      new ActionRowBuilder().addComponents(prizeInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(winnersInput),
      new ActionRowBuilder().addComponents(reqInput),
    );

    return interaction.showModal(modal);
  }
}

module.exports = {
  handleGiveawayWizardButton,
};

