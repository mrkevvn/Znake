// interactionCreate.js - simplified to default Discord permission handling
"use strict";

const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cooldown = require('../utils/cooldown');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const db = require('../utils/database');
const config = require('../config.json');
const { isOwner } = require('../utils/isOwner');

// Missing imports added below
const { handleHelpSelect, handleHelpBack } = require('../handlers/helpComponents');
const { handleTicketButton, handleTicketSelect, handleTicketBulkConfirm, handleTicketBulkCancel, handleTicketReportModal } = require('../handlers/ticketComponents');
const { getCaseById, addTimeline, logAction, buildCaseEmbed } = require('../utils/caseManager');

// ── Global interaction deduplication ────────────────────────────────────────
// Prevents any single interaction ID from being processed more than once.
// This catches rare Discord API retries that deliver the same interaction
// twice, as well as any accidental duplicate handler registration.
const processedInteractions = new Set();
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_SIZE = 10_000;

function dedupInteraction(interactionId) {
  if (processedInteractions.has(interactionId)) return false;
  // Prevent unbounded growth
  if (processedInteractions.size >= DEDUP_MAX_SIZE) processedInteractions.clear();
  processedInteractions.add(interactionId);
  setTimeout(() => processedInteractions.delete(interactionId), DEDUP_TTL_MS);
  return true;
}


module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(client, interaction) {
    // ── Interaction ID dedup (applies to ALL interaction types) ──────────────
    if (!dedupInteraction(interaction.id)) return;

    // ── Blacklist Runtime Enforcement ─────────────────────────────────────────
    const blacklistService = require('../utils/blacklist');
    if (
      blacklistService.isBlacklisted({ type: 'user', id: interaction.user.id }) ||
      (interaction.guildId && blacklistService.isBlacklisted({ type: 'guild', id: interaction.guildId }))
    ) {
      if (interaction.isRepliable()) {
        try {
          await interaction.reply({
            content: 'This bot is unavailable in this server.',
            flags: MessageFlags.Ephemeral
          });
        } catch (e) {
          // ignore reply errors if interaction expired or already handled
        }
      }
      return;
    }



    // Button handling (unchanged sections retained as needed)
    if (interaction.isButton()) {
      // Giveaway join button (legacy prefix kept for compatibility)
      if (interaction.customId.startsWith('giveaway:join:')) {
        const { handleGiveawayJoin } = require('../utils/giveawayJoinHandler');
        return handleGiveawayJoin(client, interaction).catch(async () => {
          if (!interaction.replied && !interaction.deferred) {
            return await interaction.reply({ content: 'Failed to join giveaway.', flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        });
      // Giveaway wizard actions
      } else if (interaction.customId.startsWith('giveaway_wizard_')) {
        const { handleGiveawayWizardButton } = require('../utils/giveawayWizardButtonHandler');
        return handleGiveawayWizardButton(client, interaction).catch(async (err) => {
          if (!interaction.replied && !interaction.deferred) {
            return await interaction.reply({ content: 'Wizard action failed.', flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        });
      } else if (interaction.customId.startsWith('ticket_bulk_confirm:')) {
        return handleTicketBulkConfirm(interaction, client).catch(err => {
          if (err.code !== 10062) logger.error(`[${err.code}] Ticket bulk confirm: ${err.message}${err.method ? ` (${err.method} ${err.url})` : ''}`);
        });
      } else if (interaction.customId === 'ticket_bulk_cancel') {
        return handleTicketBulkCancel(interaction, client).catch(err => {
          if (err.code !== 10062) logger.error(`[${err.code}] Ticket bulk cancel: ${err.message}${err.method ? ` (${err.method} ${err.url})` : ''}`);
        });
      } else if (interaction.customId.startsWith('appeal_close:')) {
        const caseId = interaction.customId.split(':')[1];
        const caseData = getCaseById(caseId);
        if (!caseData || caseData.type !== 'appeal') {
          return interaction.reply({ embeds: [embeds.error('Appeal Not Found', 'This appeal case could not be found.')], flags: MessageFlags.Ephemeral });
        }
        if (['Closed', 'Resolved', 'Rejected'].includes(caseData.status)) {
          return interaction.reply({ embeds: [embeds.error('Already Closed', 'This appeal is already closed.')], flags: MessageFlags.Ephemeral });
        }
        const channel = interaction.channel;
        if (!channel || channel.id !== caseData.channelId) {
          return interaction.reply({ embeds: [embeds.error('Wrong Channel', 'This button can only be used inside the appeal case channel.')], flags: MessageFlags.Ephemeral });
        }
        caseData.status = 'Closed';
        caseData.resolvedAt = Date.now();
        caseData.moderatorId = interaction.user.id;
        addTimeline(caseData, 'Appeal closed by staff', interaction.user.id);
        const cases = db.read('cases');
        cases[caseData.caseId] = caseData;
        db.write('cases', cases);
        logAction('CLOSED', caseData.caseId, interaction.user.id, 'Appeal closed via button', interaction.guild?.id);
        const updateEmbed = await buildCaseEmbed(caseData, interaction.guild, client).catch(() => null);
        if (updateEmbed) {
          await interaction.message.edit({
            embeds: [updateEmbed], components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`appeal_close:${caseData.caseId}`)
                .setLabel('Close Appeal')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true)
            )]
          }).catch(() => null);
        }
        await channel.permissionOverwrites.edit(caseData.reporterId, { SendMessages: false }).catch(() => null);
        await channel.setName(`closed-appeal-${caseData.caseId.replace(/^CASE-/, '').toLowerCase()}`).catch(() => null);
        await channel.send({
          embeds: [new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('✅ Appeal Closed')
            .setDescription(`Appeal closed by ${interaction.user}. Staff will no longer receive DM updates from this case.`)
            .setTimestamp()]
        }).catch(() => null);
        return interaction.reply({ embeds: [embeds.success('Appeal Closed', 'The appeal has been closed successfully.')], flags: MessageFlags.Ephemeral });
      } else if (interaction.customId.startsWith('ticket_')) {
        return handleTicketButton(interaction, client).catch(err => {
          if (err.code === 10062) return;
          const details = `[${err.code || '?'}] ${err.message}${err.method ? ` (${err.method} ${err.url})` : ''}${err.rawError?.errors ? ' | ' + JSON.stringify(err.rawError.errors).slice(0, 300) : ''}`;
          logger.error(`Ticket button error: ${details}`);
        });
      } else if (interaction.customId === 'help_back_btn') {
        return handleHelpBack(interaction, client).catch(err => {
          if (err.code !== 10062) logger.error(`Help back error: ${err.message}`);
        });
      } else if (interaction.customId.startsWith('backup_load:') || interaction.customId.startsWith('backup_info:') || interaction.customId.startsWith('backup_delete:')) {
        const backupCommand = client.commands.get('backup');
        if (backupCommand && typeof backupCommand.handleButton === 'function') {
          return backupCommand.handleButton(interaction, client).catch(err => {
            if (err.code !== 10062) logger.error(`Backup button error: ${err.message}`);
          });
        }
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('ticket_')) {
        return handleTicketSelect(interaction, client).catch(err => {
          if (err.code === 10062) return;
          if (err.message?.includes('already been acknowledged')) {
            logger.info('Ticket select interaction already handled.');
            return;
          }
          const details = `[${err.code || '?'}] ${err.message}${err.method ? ` (${err.method} ${err.url})` : ''}${err.rawError?.errors ? ' | ' + JSON.stringify(err.rawError.errors).slice(0, 300) : ''}`;
          logger.error(`Ticket select error: ${details}`);
        });
      }
      if (interaction.customId === 'help_cat_sel') {
        return handleHelpSelect(interaction, client).catch(err => {
          if (err.code !== 10062) logger.error(`Help select error: ${err.message}`);
        });
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const modalCommands = ["giveaway", "embed", "announcement", "any-command-using-modals"]; // skip list for global deferReply safety

      // If modal is from a known modal-command flow, never auto-defer before handling
      const isModalFromSkipList = modalCommands.some((k) => interaction.customId?.includes(k));

      // Safety guard: if already replied/deferred, bail (prevents InteractionAlreadyReplied)
      if (interaction.replied || interaction.deferred) {
        console.error("Blocked modal: interaction already used.");
        return;
      }

      if (interaction.customId.startsWith('announcement_modal:')) {
        const announcementCmd = client.commands.get('announcement');
        if (announcementCmd && typeof announcementCmd.handleModalSubmit === 'function') {
          return announcementCmd.handleModalSubmit(interaction, client).catch(err => {
            logger.error(`Announcement modal submit error: ${err.message}`);
          });
        }
      }

      if (interaction.customId.startsWith('giveaway_wizard_modal:')) {
        const { isStaff } = require('../utils/permissions');
        const { parseRequirementsFromText } = require('../utils/giveawayEligibility');
        const { setWizardState, getWizardState, deleteWizardState } = require('../utils/giveawayWizard');
        const { buildJoinButton } = require('../utils/giveawayManager');
        const { formatDuration, parseDuration } = require('../utils/formatters');

        const guildId = interaction.guildId;
        // customId format: `giveaway_wizard_modal:<wizardId>` where wizardId is
        // `gw:<guildId>:<userId>:<interactionId>` and itself contains colons.
        // Strip only the known prefix so the full wizardId is preserved.
        const MODAL_PREFIX = 'giveaway_wizard_modal:';
        const wizardId = interaction.customId.slice(MODAL_PREFIX.length);

        if (!isStaff(interaction.member, guildId)) {
          return interaction.reply({ content: '🚫 Staff Only', flags: MessageFlags.Ephemeral });
        }

        const state = getWizardState(guildId, wizardId);
        if (!state) {
          return interaction.reply({ content: 'Wizard session expired. Please run /giveaway again.', flags: MessageFlags.Ephemeral });
        }

        const prize = interaction.fields.getTextInputValue('prize')?.trim();
        const durationStr = interaction.fields.getTextInputValue('duration')?.trim();
        const winnersRaw = interaction.fields.getTextInputValue('winners')?.trim();
        const requirementsText = interaction.fields.getTextInputValue('requirements')?.trim() ?? '';

        const winnerCount = Math.max(1, Math.min(20, Number(winnersRaw)));
        if (!prize || prize.length > 100) {
          return interaction.reply({ content: '❌ Invalid prize.', flags: MessageFlags.Ephemeral });
        }
        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs < 10_000) {
          return interaction.reply({ content: '❌ Invalid duration (min 10s).', flags: MessageFlags.Ephemeral });
        }
        if (!winnerCount || !Number.isFinite(winnerCount)) {
          return interaction.reply({ content: '❌ Invalid winners.', flags: MessageFlags.Ephemeral });
        }

        const requirements = parseRequirementsFromText(requirementsText);

        // Store wizard data then render preview embed (step 2)
        const previewChannelId = state.channelId ?? interaction.channelId;

        const requirementsLines = [];
        if (requirements.requiredRoleId) requirementsLines.push(`Required Role: <@&${requirements.requiredRoleId}>`);
        if (typeof requirements.requiredInvites === 'number' && requirements.requiredInvites > 0) requirementsLines.push(`Required Invites: ${requirements.requiredInvites}`);
        if (typeof requirements.requiredMessages === 'number' && requirements.requiredMessages > 0) requirementsLines.push(`Required Messages: ${requirements.requiredMessages}`);
        const requirementsClean = requirementsLines.length ? requirementsLines.join('\n') : 'None';

        const durationLabel = formatDuration(durationMs);

        const previewEmbed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🎯 Giveaway Setup Preview')
          .addFields(
            { name: '🎁 Prize', value: prize, inline: false },
            { name: '⏱ Duration', value: durationLabel, inline: false },
            { name: '🏆 Winners', value: String(winnerCount), inline: false },
            { name: '📌 Requirements', value: requirementsClean, inline: false },
            { name: '🖼 Image', value: state.imageUrl ? 'Attached ✅' : 'None', inline: false },
          )
          .setFooter({ text: 'Choose an action to proceed' })
          .setTimestamp();

        if (state.imageUrl) previewEmbed.setThumbnail(state.imageUrl);

        const confirmBtnId = `giveaway_wizard_confirm:${wizardId}`;
        const editBtnId = `giveaway_wizard_edit:${wizardId}`;
        const cancelBtnId = `giveaway_wizard_cancel:${wizardId}`;

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(confirmBtnId).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(editBtnId).setLabel('✏️ Edit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(cancelBtnId).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
        );

        await interaction.reply({ embeds: [previewEmbed], components: [row], flags: MessageFlags.Ephemeral });

        await setWizardState(guildId, wizardId, {
          step: 3,
          data: {
            title: `Giveaway`,
            prize,
            durationMs,
            durationStr,
            winnerCount,
            requirements,
            requirementsText,
            requirementsClean,
            requirementLegacy: requirementsClean,
            requirementsTextRaw: requirementsText,
            channelId: previewChannelId,
          },
          previewChannelId,
        });
        return;
      }
      if (interaction.customId === 'ticket_report_modal') {
        return handleTicketReportModal(interaction, client).catch(err => {
          logger.error(`Ticket report modal error: ${err.message}`);
        });
      }

      if (interaction.customId.startsWith('say_modal:')) {
        const targetMessageId = interaction.customId.split(':')[1];
        const rawMessage = interaction.fields.getTextInputValue('message');
        const { checkPermissions, executeSay } = require('../utils/sayShared');

        if (!checkPermissions(interaction.member)) {
          const errorEmbed = embeds.error(
            'Permission Denied',
            `You do not have the required permissions to run this command. Must be an Administrator or have the allowed role.`
          );
          return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }

        const targetMessage = await interaction.channel.messages.fetch(targetMessageId).catch(() => null);
        if (!targetMessage) {
          const errorEmbed = embeds.error('Message Not Found', 'Could not find the target message to reply to.');
          return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }

        await executeSay(interaction, {
          rawMessage,
          targetChannel: interaction.channel,
          targetMessage
        });
        return;
      }

      return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isContextMenuCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Unknown command received: /${interaction.commandName}`);
      return;
    }

    // Owner‑only check for dev commands (runtime protection only)
    if (command.ownerOnly) {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.errorColor || '#ED4245')
            .setTitle('🔒 Dev Command Restricted')
            .setDescription('Only the bot owner can use this command.')
            .setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Extra safety: dev commands must run in the dev guild
      const devGuildId = config.devGuildId;
      if (devGuildId && interaction.guildId !== devGuildId) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.errorColor || '#ED4245')
            .setTitle('🔒 Dev Command Restricted')
            .setDescription('This command can only be used in the development server.')
            .setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // Permission check for moderation commands using Discord defaults (if defined)
    if (command.data?.default_member_permissions) {
      const required = command.data.default_member_permissions;
      if (!interaction.member.permissions.has(required)) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.errorColor || '#ED4245')
            .setTitle('🔒 Permission Denied')
            .setDescription('You lack the required Discord permissions to run this command.')
            .setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    const cooldownTime = command.cooldown ?? config.cooldownDefault ?? 3;
    const { onCooldown, remaining } = cooldown.check(interaction.user.id, interaction.commandName, cooldownTime);
    if (onCooldown) {
      return interaction.reply({ embeds: [embeds.cooldown(remaining)], flags: MessageFlags.Ephemeral });
    }

    logger.command(interaction.user.username, interaction.commandName, interaction.guild ? interaction.guild.name : 'DM');
    if (!client.commandUsage) client.commandUsage = new Map();
    client.commandUsage.set(interaction.commandName, (client.commandUsage.get(interaction.commandName) || 0) + 1);
    client.totalCommandsRun = (client.totalCommandsRun || 0) + 1;

    try {
      // Modal-based commands must never be pre-deferred/replied.
      const modalCommands = ["giveaway", "embed", "announcement", "any-command-using-modals"];
      const isModalCommand = modalCommands.some((k) => interaction.commandName?.includes(k));
      if (isModalCommand && (interaction.replied || interaction.deferred)) {
        console.error("Blocked modal command execution: interaction already used.");
        return;
      }

      await command.execute(interaction, client);
    } catch (err) {
      if (err.code === 10062) return;
      logger.error(`Error executing /${interaction.commandName}: ${err.message}`);
      logger.error(err.stack);
      const errEmbed = embeds.error('Command Error', `An unexpected error occurred.\n\`${err.message}\``);
      // If interaction was already acknowledged, do not attempt to reply/followUp again.
      if (interaction.replied || interaction.deferred) return;

      try {
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      } catch (replyErr) {
        if (replyErr.code !== 10062) logger.error(`Failed to send error reply: ${replyErr.message}`);
      }
    }
  },
};
