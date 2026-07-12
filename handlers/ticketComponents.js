'use strict';

const {
  MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, PermissionFlagsBits, AttachmentBuilder,
  ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const db = require('../utils/database');
const { isStaff } = require('../utils/permissions');
const config = require('../config.json');
const {
  CATEGORIES, PRIORITIES,
  generateTicketId, addTimeline, logAction,
  buildTicketEmbed, buildActionRow, updateTicketEmbed,
  closeTicket, getTicketByChannel, generateTranscript,
  buildCategorySelectOptions, sendTranscript, syncLinkedCase,
} = require('../utils/ticketManager');

const PENDING_CATEGORY = new Map();

async function handleTicketButton(interaction, client) {
  try {
    const { customId, guild, member, user, channel } = interaction;

  if (customId === 'ticket_panel_btn') {
    const tickets = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};
    const existing = Object.values(tickets[guild.id]).find(t => t.userId === user.id && t.status !== 'closed');
    if (existing) {
      const existChannel = guild.channels.cache.get(existing.channelId);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('⚠️ Ticket Already Open')
          .setDescription(`You already have an open ticket: ${existChannel ? existChannel.toString() : '(channel deleted)'}`)
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_sel')
      .setPlaceholder('Select a support category…')
      .addOptions(buildCategorySelectOptions());

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle('🎫 Open a Ticket')
        .setDescription('Please select the category that best matches your issue.')
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(selectMenu)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (customId === 'ticket_close_btn') {
    const ticket = getTicketByChannel(guild.id, channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Not a Ticket').setDescription('This is not an active ticket channel.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle('🔒 Closing Ticket')
        .setDescription(`Ticket will be closed in **5 seconds**.\nClosed by ${user}.`)
        .setTimestamp()],
    });

    const tickets = db.read('tickets');
    await closeTicket(guild, ticket, user, 'Closed via button', client);
    return;
  }

  if (customId === 'ticket_claim_btn') {
    if (!isStaff(member, guild.id)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Staff Only').setDescription('Only staff members can claim tickets.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const tickets = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};
    const ticket = getTicketByChannel(guild.id, channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Not a Ticket').setDescription('This is not an active ticket channel.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (ticket.claimedBy === user.id) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      ticket.claimedBy = null;
      ticket.status    = 'open';
      ticket.lastActivity = Date.now();
      addTimeline(ticket, `Unclaimed by ${user.username}`, user.id);
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      syncLinkedCase(ticket);
      logAction(guild.id, 'UNCLAIMED', ticket.id, user.id);
      await updateTicketEmbed(guild, ticket);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('✅ Ticket Unclaimed').setDescription('You have unclaimed this ticket.').setTimestamp()],
      });
    }

    if (ticket.claimedBy && ticket.claimedBy !== user.id && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      const claimer = await client.users.fetch(ticket.claimedBy).catch(() => null);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('⚠️ Already Claimed').setDescription(`This ticket is already claimed by **${claimer ? (claimer.globalName || claimer.username) : 'Unknown'}**.`).setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    ticket.claimedBy = user.id;
    ticket.status    = 'claimed';
    ticket.lastActivity = Date.now();
    addTimeline(ticket, `Claimed by ${user.username}`, user.id);
    tickets[guild.id][ticket.id] = ticket;
    db.write('tickets', tickets);
    syncLinkedCase(ticket);
    logAction(guild.id, 'CLAIMED', ticket.id, user.id);
    await updateTicketEmbed(guild, ticket);

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('🙋 Ticket Claimed')
        .setDescription(`${user} has claimed this ticket and will be your primary point of contact.`)
        .setTimestamp()],
    });

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('✅ Claimed').setDescription('You have claimed this ticket.').setTimestamp()],
    });
  }



  // ── TRANSCRIPT BUTTON ────────────────────────────────────────────
  if (customId === 'ticket_transcript_btn') {
    if (!isStaff(member, guild.id)) {
      return interaction.reply({

        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Staff Only').setDescription('Only staff members can generate transcripts.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const ticket = getTicketByChannel(guild.id, channel.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const ticketConfig = db.read('ticket_config');
      let transcriptChannelId = ticketConfig[guild.id]?.transcriptChannelId || null;
      let targetChannel;

      if (transcriptChannelId) {
        targetChannel = guild.channels.cache.get(transcriptChannelId);
        if (!targetChannel) {
          transcriptChannelId = null;
          if (ticketConfig[guild.id]) {
            delete ticketConfig[guild.id].transcriptChannelId;
            db.write('ticket_config', ticketConfig);
          }
        }
      }

      if (!transcriptChannelId) {
        const textChannels = guild.channels.cache
          .filter(c => c.type === ChannelType.GuildText)
          .sort((a, b) => a.position - b.position)
          .first(25);

        if (textChannels.length === 0) {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ No Text Channels')
              .setDescription('There are no text channels available for transcripts.')
              .setTimestamp()],
          });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId('transcript_channel_sel')
          .setPlaceholder('Where to send?')
          .addOptions(
            textChannels.map(c => ({
              label: c.name.length > 100 ? c.name.slice(0, 97) + '\u2026' : c.name,
              value: c.id,
            })),
          );

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(config.embedColor)
            .setTitle('📄 Where to send?')
            .setDescription('Select a text channel to send the transcript to. This will be saved for future use.')
            .setTimestamp()],
          components: [new ActionRowBuilder().addComponents(menu)],
        });

        const selection = await interaction.awaitMessageComponent({
          filter: i => i.customId === 'transcript_channel_sel' && i.user.id === user.id,
          time: 60000,
        });

        transcriptChannelId = selection.values[0];
        targetChannel = guild.channels.cache.get(transcriptChannelId);

        if (!targetChannel) {
          await selection.deferUpdate();
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Channel Not Found')
              .setDescription('The selected channel no longer exists.')
              .setTimestamp()],
            components: [],
          });
        }

        const cfg = db.read('ticket_config');
        if (!cfg[guild.id]) cfg[guild.id] = {};
        cfg[guild.id].transcriptChannelId = transcriptChannelId;
        db.write('ticket_config', cfg);

        await selection.deferUpdate();
      }

      const { messageCount } = await sendTranscript(targetChannel, ticket, client, guild, user, ticket?.closeReason || 'Transcript generated via button');

      if (ticket) {
        addTimeline(ticket, `Transcript generated by ${user.username}`, user.id);
        const tickets = db.read('tickets');
        if (tickets[guild.id]) tickets[guild.id][ticket.id] = ticket;
        db.write('tickets', tickets);
        logAction(guild.id, 'TRANSCRIPT', ticket.id, user.id);
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.successColor)
          .setTitle('✅ Transcript Sent')
          .setDescription(`Transcript successfully sent to ${targetChannel}.\n**${messageCount}** messages captured.`)
          .setTimestamp()],
        components: [],
      });
    } catch (err) {
      if (err.code === 'INTERACTION_COLLECTOR_ERROR') {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('⏰ Timed Out')
            .setDescription('Channel selection timed out. Click the Transcript button again.')
            .setTimestamp()],
          components: [],
        });
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('❌ Transcript Failed')
          .setDescription(`${err.message}`)
          .setTimestamp()],
        components: [],
      });
    }
  }

  // ── NOTIFY USER BUTTON ───────────────────────────────────────────
  if (customId === 'ticket_notify_btn') {
    if (!isStaff(member, guild.id)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Staff Only').setDescription('Only staff members can notify the ticket creator.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const ticket = getTicketByChannel(guild.id, channel.id);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Not a Ticket').setDescription('This is not an active ticket channel.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await channel.send({
      content: `<@${ticket.userId}>`,
      embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle('🔔 Staff Needs Your Attention')
        .setDescription(`You have been notified by ${user}. Please check back in this ticket at your earliest convenience.`)
        .setTimestamp()],
    });

    const creator = await client.users.fetch(ticket.userId).catch(() => null);
    if (creator) {
      creator.send({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle(`🔔 Ticket Update — ${guild.name}`)
          .setDescription(`Staff member **${user.username}** is requesting your attention in ticket **${ticket.id}**.\n\n➡️ <#${channel.id}>`)
          .setTimestamp()],
      }).catch(() => {});
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('✅ User Notified')
        .setDescription(`${ticket.userTag} has been pinged in the channel and notified via DM.`)
        .setTimestamp()],
    });
    return;
  }

  } catch (err) {
    if (interaction.deferred && !interaction.replied) {
      try { await interaction.editReply({ content: `An error occurred. Please try again.`, embeds: [] }); } catch {}
    } else if (!interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: `An error occurred. Please try again.`, flags: MessageFlags.Ephemeral }); } catch {}
    }
    if (err.code === 10062) return;
    const details = `${err.code ? `[${err.code}] ` : ''}${err.message}${err.method ? ` (${err.method} ${err.url})` : ''}${err.rawError?.errors ? ' | ' + JSON.stringify(err.rawError.errors).slice(0, 400) : ''}`;
    logger.error(`[TicketButton] ${details}`);
    console.error(err.stack || err.message);
  }
}

async function handleTicketSelect(interaction, client) {
  try {
    const { customId, guild, user, values } = interaction;

  if (customId === 'ticket_status_sel') {
    const newStatus = values[0];
    const statusMeta = require('../utils/ticketManager').STATUSES[newStatus];

    if (!isStaff(interaction.member, guild.id)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Staff Only').setDescription('Only staff members can change ticket status.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const tickets = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};
    const ticket = getTicketByChannel(guild.id, interaction.channel.id);

    if (!ticket) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Not Found').setDescription('Could not find the ticket for this channel.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (ticket.status === newStatus) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('⚠️ No Change').setDescription(`The ticket is already **${statusMeta.label}**.`).setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const oldMeta = require('../utils/ticketManager').STATUSES[ticket.status] || require('../utils/ticketManager').STATUSES.open;
    await interaction.deferUpdate();

    ticket.status       = newStatus;
    ticket.lastActivity = Date.now();
    addTimeline(ticket, `Status changed: ${oldMeta.label} → ${statusMeta.label}`, user.id);

    if (newStatus === 'closed') {
      ticket.closedAt    = Date.now();
      ticket.closedBy    = user.id;
      ticket.closeReason = 'Status set to Closed by staff';
    }
    if (newStatus !== 'closed' && ticket.status === 'closed') {
      ticket.closedAt   = null;
      ticket.closedBy   = null;
      ticket.closeReason = null;
    }
    if (newStatus === 'claimed' && !ticket.claimedBy) ticket.claimedBy = user.id;

     tickets[guild.id][ticket.id] = ticket;
    db.write('tickets', tickets);
    syncLinkedCase(ticket);
    logAction(guild.id, 'STATUS_CHANGE', ticket.id, user.id, `${oldMeta.label} → ${statusMeta.label}`);

    const { updateTicketEmbed: ute } = require('../utils/ticketManager');
    await ute(guild, ticket);

    await interaction.channel.send({
      embeds: [new EmbedBuilder()
        .setColor(
          newStatus === 'closed'    ? (config.errorColor   || '#ED4245') :
          newStatus === 'resolved'  ? (config.successColor || '#57F287') :
          (config.embedColor || '#5865F2'),
        )
        .setTitle('🔄 Status Updated')
        .setDescription(`${user} changed the ticket status.\n\n${oldMeta.emoji} **${oldMeta.label}** → ${statusMeta.emoji} **${statusMeta.label}**`)
        .setTimestamp()],
    });

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('✅ Status Changed')
        .setDescription(`Status set to ${statusMeta.emoji} **${statusMeta.label}**.`)
        .setTimestamp()],
      components: [],
    });
  }

  if (customId === 'ticket_category_sel') {
    const category = values[0];
    if (category === 'report') {
      const modal = new ModalBuilder()
        .setCustomId('ticket_report_modal')
        .setTitle('🚨 User Report');

      const reportedUserInput = new TextInputBuilder()
        .setCustomId('reported_user')
        .setLabel('Reported User (ID, Tag, or Username)')
        .setPlaceholder('e.g. 735920558218149919 or username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const reasonInput = new TextInputBuilder()
        .setCustomId('report_reason')
        .setLabel('Reason for the Report')
        .setPlaceholder('Describe the violation in detail...')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true);

      const evidenceInput = new TextInputBuilder()
        .setCustomId('report_evidence')
        .setLabel('Evidence / Attachments (Optional)')
        .setPlaceholder('Links to screenshots, messages, or other proof...')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reportedUserInput),
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(evidenceInput)
      );

      return interaction.showModal(modal);
    }

    PENDING_CATEGORY.set(user.id, category);

    await interaction.deferUpdate();

    const tickets = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};

    const existing = Object.values(tickets[guild.id]).find(t => t.userId === user.id && t.status !== 'closed');
    if (existing) {
      const existChannel = guild.channels.cache.get(existing.channelId);
      PENDING_CATEGORY.delete(user.id);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('⚠️ Ticket Already Open')
          .setDescription(`You already have an open ticket: ${existChannel ? existChannel.toString() : '(channel deleted)'}`)
          .setTimestamp()],
        components: [],
      });
    }

    const priorityMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_priority_sel')
      .setPlaceholder('Select priority level…')
      .addOptions(
        { label: 'Low',    value: 'low',    emoji: '🟢', description: 'Minor issue, no urgency' },
        { label: 'Medium', value: 'medium', emoji: '🟡', description: 'Standard priority for most tickets' },
        { label: 'High',   value: 'high',   emoji: '🔴', description: 'Urgent issue requiring immediate attention' },
      );

    const catMeta = CATEGORIES[category] || CATEGORIES.technical;

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle('⚡ Select Priority')
        .setDescription(`**Category:** ${catMeta.emoji} ${catMeta.label}\n\nNow select the priority level for your ticket.`)
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(priorityMenu)],
    });
  }

  if (customId === 'ticket_priority_sel') {
    const priority = values[0];
    const category = PENDING_CATEGORY.get(user.id);
    PENDING_CATEGORY.delete(user.id);

    if (!category) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('❌ Session Expired')
          .setDescription('Your category selection has expired. Please click **Create Ticket** again.')
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferUpdate();

    const catMeta  = CATEGORIES[category] || CATEGORIES.technical;
    const tickets  = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};

    const existing = Object.values(tickets[guild.id]).find(t => t.userId === user.id && t.status !== 'closed');
    if (existing) {
      const existChannel = guild.channels.cache.get(existing.channelId);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('⚠️ Ticket Already Open')
          .setDescription(`You already have an open ticket: ${existChannel ? existChannel.toString() : '(channel deleted)'}`)
          .setTimestamp()],
        components: [],
      });
    }

    const ticketCounter = db.read('ticket_counter');
    if (!ticketCounter[guild.id]) ticketCounter[guild.id] = 0;
    const ticketNum = ++ticketCounter[guild.id];
    db.write('ticket_counter', ticketCounter);

    const ticketId = generateTicketId();
    const ticketConfig = db.read('ticket_config');

    let ticketChannel;
    try {
      const shortCat = category;
      const channelName = `${shortCat}-ticket-${ticketNum.toString().padStart(3, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);

      const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ];

      const assistanceRoleId = ticketConfig[guild.id]?.assistanceRoleId;
      if (assistanceRoleId) {
        overwrites.push({
          id: assistanceRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }

      const staffDb = db.read('staff_roles');
      const guildStaffRoles = staffDb[guild.id];
      if (Array.isArray(guildStaffRoles)) {
        for (const roleId of guildStaffRoles) {
          if (roleId !== assistanceRoleId) {
            overwrites.push({
              id: roleId,
              deny: [PermissionFlagsBits.ViewChannel],
            });
          }
        }
      }

      const channelOptions = {
        name: channelName,
        permissionOverwrites: overwrites,
        topic: `Ticket #${ticketNum} | ${catMeta.label} | ${user.username}`,
      };
      if (ticketConfig[guild.id]?.categoryId) channelOptions.parent = ticketConfig[guild.id].categoryId;

      const { ChannelType } = require('discord.js');
      channelOptions.type = ChannelType.GuildText;
      ticketChannel = await guild.channels.create(channelOptions);
    } catch (err) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('❌ Failed')
          .setDescription(`Could not create ticket: ${err.message}`)
          .setTimestamp()],
        components: [],
      });
    }


    const ticketData = {
      id: ticketId, number: ticketNum,
      userId: user.id, userTag: user.globalName || user.username,
      channelId: ticketChannel.id,
      category, reason: `${catMeta.label} support request`,
      priority, status: 'open',
      assignedTo: null, claimedBy: null, ticketMessageId: null,
      timeline: [], createdAt: Date.now(), lastActivity: Date.now(),
      closedAt: null, closedBy: null, closeReason: null,
      inactivityWarned: false,
    };

    addTimeline(ticketData, 'Ticket Created via Panel', user.id);

    const embed = buildTicketEmbed(ticketData);
    const row   = buildActionRow(ticketData);

    const ticketMsg = await ticketChannel.send({
      content: `${user} — Welcome to your ticket!`,
      embeds: [embed],
      components: [row],
    });

    ticketData.ticketMessageId = ticketMsg.id;
    tickets[guild.id][ticketId] = ticketData;
    db.write('tickets', tickets);
    logAction(guild.id, 'CREATED', ticketId, user.id, `Category: ${catMeta.label} (via panel), Priority: ${priority}`);

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('✅ Ticket Created')
        .setDescription(`Your ticket has been opened: ${ticketChannel}\n\n${catMeta.emoji} **Category:** ${catMeta.label}\n${(PRIORITIES[priority] || {}).emoji || ''} **Priority:** ${(PRIORITIES[priority] || {}).label || priority}`)
        .setFooter({ text: ticketId })
        .setTimestamp()],
      components: [],
    });
  }

  // ── CATCH-ALL: UNKNOWN SELECT MENU ID ──────────────────────────
  if (!interaction.replied && !interaction.deferred) {
    try { await interaction.deferUpdate(); } catch {}
    try {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('❓ Unknown Action')
          .setDescription('This selection is not recognized. Please try again.')
          .setTimestamp()],
        components: [],
      });
    } catch {}
  }

  } catch (err) {
    if (interaction.deferred && !interaction.replied) {
      try { await interaction.editReply({ content: `An error occurred. Please try again.`, embeds: [], components: [] }); } catch {}
    } else if (!interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: `An error occurred. Please try again.`, flags: MessageFlags.Ephemeral }); } catch {}
    }
    if (err.code === 10062) return;
    const details = `${err.code ? `[${err.code}] ` : ''}${err.message}${err.method ? ` (${err.method} ${err.url})` : ''}${err.rawError?.errors ? ' | ' + JSON.stringify(err.rawError.errors).slice(0, 400) : ''}`;
    logger.error(`[TicketSelect] ${details}`);
    console.error(err.stack || err.message);
  }
}

async function handleTicketBulkConfirm(interaction, client) {
  const { guild, member } = interaction;
  const { isStaff } = require('../utils/permissions');
  if (!member.permissions.has(8n) && !isStaff(member, guild.id)) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Staff Only').setDescription('You need a staff role to confirm bulk actions.').setTimestamp()],
      flags: MessageFlags.Ephemeral,
    });
  }

  const params   = interaction.customId.slice('ticket_bulk_confirm:'.length).split(':');
  const action   = params[0];
  const fromId   = params[1];
  const toId     = params[2];
  const tickets  = db.read('tickets');
  const now      = Date.now();

  if (!tickets[guild.id]) tickets[guild.id] = {};

  let targets = Object.values(tickets[guild.id]);
  if (action === 'close-resolved')  targets = targets.filter(t => t.status === 'resolved');
  if (action === 'close-waiting')   targets = targets.filter(t => t.status === 'waiting_for_user');
  if (action === 'reassign')        targets = targets.filter(t => t.status !== 'closed' && (t.assignedTo === fromId || t.claimedBy === fromId));

  if (targets.length === 0) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('⚠️ Nothing to Do').setDescription('No tickets matched the criteria when the action was executed — they may have already been updated.').setTimestamp()],
      components: [],
    });
  }

  let successCount = 0;
  const errors = [];

  for (const ticket of targets) {
    try {
      if (action.startsWith('close-')) {
        ticket.status       = 'closed';
        ticket.closedAt     = now;
        ticket.closeReason  = `Bulk close by ${member.user.tag}`;
        ticket.closedBy     = member.user.id;
        ticket.timeline     = ticket.timeline || [];
        ticket.timeline.push({ event: `Bulk closed by ${member.user.tag} (${action})`, timestamp: now });

        const ch = guild.channels.cache.get(ticket.channelId);
        if (ch) {
          const safeName = `closed-${ticket.number}`;
          await ch.setName(safeName).catch(() => null);
          await ch.permissionOverwrites.edit(ticket.userId, { ViewChannel: false }).catch(() => null);
        }
      } else if (action === 'reassign') {
        if (ticket.claimedBy === fromId)  ticket.claimedBy  = toId;
        if (ticket.assignedTo === fromId) ticket.assignedTo = toId;
        ticket.timeline = ticket.timeline || [];
        ticket.timeline.push({ event: `Bulk reassigned from ${fromId} to ${toId} by ${member.user.tag}`, timestamp: now });
      }
      successCount++;
    } catch (err) {
      errors.push(`\`${ticket.id}\`: ${err.message}`);
    }
  }

  db.write('tickets', tickets);

  const ACTION_DONE = {
    'close-resolved':  '✅ Closed all Resolved tickets',
    'close-waiting':   '✅ Closed all Waiting For User tickets',
    'reassign':        '✅ Reassigned tickets',
  };

  const resultEmbed = new EmbedBuilder()
    .setColor(config.successColor)
    .setTitle('✅ Bulk Action Complete')
    .setDescription(`**${ACTION_DONE[action] || 'Action'}**\n\u200b`)
    .addFields(
      { name: '✅ Succeeded', value: `**${successCount}** ticket${successCount !== 1 ? 's' : ''}`, inline: true },
      { name: '❌ Failed',    value: `**${errors.length}** ticket${errors.length !== 1 ? 's' : ''}`, inline: true },
    );

  if (errors.length) {
    resultEmbed.addFields({ name: 'Errors', value: errors.slice(0, 5).join('\n'), inline: false });
  }

  resultEmbed.setFooter({ text: `Executed by ${member.user.tag}` }).setTimestamp();

  return interaction.update({ embeds: [resultEmbed], components: [] });
}

async function handleTicketBulkCancel(interaction) {
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('🚫 Bulk Action Cancelled')
      .setDescription('No changes were made.')
      .setTimestamp()],
    components: [],
  });
}

async function handleTicketReportModal(interaction, client) {
  try {
    const reportedUserRaw = interaction.fields.getTextInputValue('reported_user').trim();
    const reason = interaction.fields.getTextInputValue('report_reason').trim();
    const evidence = interaction.fields.getTextInputValue('report_evidence')?.trim() || null;
    const { guild, user } = interaction;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let reportedUser = null;
    const cleanInput = reportedUserRaw.replace(/[<@!>]/g, '').trim();
    if (/^\d{17,20}$/.test(cleanInput)) {
      reportedUser = await client.users.fetch(cleanInput).catch(() => null);
    } else {
      await guild.members.fetch().catch(() => {});
      const member = guild.members.cache.find(m => m.user.username.toLowerCase() === cleanInput.toLowerCase() || m.user.tag.toLowerCase() === cleanInput.toLowerCase() || m.displayName.toLowerCase() === cleanInput.toLowerCase());
      if (member) reportedUser = member.user;
    }

    if (!reportedUser) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.errorColor)
          .setTitle('❌ User Not Found')
          .setDescription(`Could not find a user matching \`${reportedUserRaw}\`.\n\nPlease provide their exact User ID (e.g. \`735920558218149919\`) or their exact username.`)],
      });
    }

    if (reportedUser.id === user.id) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.errorColor)
          .setTitle('❌ Invalid Report')
          .setDescription('You cannot report yourself.')],
      });
    }

    if (reportedUser.bot) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.errorColor)
          .setTitle('❌ Invalid Report')
          .setDescription('You cannot report a bot.')],
      });
    }

    const tickets = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};

    const existing = Object.values(tickets[guild.id]).find(t => t.userId === user.id && t.status !== 'closed');
    if (existing) {
      const existChannel = guild.channels.cache.get(existing.channelId);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('⚠️ Ticket Already Open')
          .setDescription(`You already have an open ticket: ${existChannel ? existChannel.toString() : '(channel deleted)'}`)
          .setTimestamp()],
      });
    }

    // Generate ticket counter
    const ticketCounter = db.read('ticket_counter');
    if (!ticketCounter[guild.id]) ticketCounter[guild.id] = 0;
    const ticketNum = ++ticketCounter[guild.id];
    db.write('ticket_counter', ticketCounter);

    const ticketId = generateTicketId();
    const caseId = require('../utils/caseManager').generateCaseId();
    const ticketConfig = db.read('ticket_config');

    let ticketChannel;
    try {
      const channelName = `report-ticket-${ticketNum.toString().padStart(3, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);

      const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ];

      const assistanceRoleId = ticketConfig[guild.id]?.assistanceRoleId;
      if (assistanceRoleId) {
        overwrites.push({
          id: assistanceRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }

      const staffDb = db.read('staff_roles');
      const guildStaffRoles = staffDb[guild.id];
      if (Array.isArray(guildStaffRoles)) {
        for (const roleId of guildStaffRoles) {
          if (roleId !== assistanceRoleId) {
            overwrites.push({
              id: roleId,
              deny: [PermissionFlagsBits.ViewChannel],
            });
          }
        }
      }

      const channelOptions = {
        name: channelName,
        permissionOverwrites: overwrites,
        topic: `Report Case #${ticketNum} | ${reportedUser.username} | ${user.username}`,
        type: ChannelType.GuildText,
      };
      if (ticketConfig[guild.id]?.categoryId) channelOptions.parent = ticketConfig[guild.id].categoryId;

      ticketChannel = await guild.channels.create(channelOptions);
    } catch (err) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('❌ Failed')
          .setDescription(`Could not create ticket: ${err.message}`)
          .setTimestamp()],
      });
    }

    // Save Case Data
    const caseData = {
      caseId,
      type: 'report',
      guildId: guild.id,
      reporterId: user.id,
      reportedUserId: reportedUser.id,
      assignedStaffId: null,
      status: 'Open',
      reason,
      evidence,
      resolution: null,
      timeline: [],
      createdAt: Date.now(),
      resolvedAt: null,
      reportMessageId: null,
      reportChannelId: null,
      ticketId: ticketId,
      channelId: ticketChannel.id,
    };
    caseData.timeline.push({ event: 'Case Created via Ticket System', actorId: user.id, timestamp: Date.now() });

    const cases = db.read('cases');
    cases[caseId] = caseData;
    db.write('cases', cases);

    // Save Ticket Data
    const ticketData = {
      id: ticketId, number: ticketNum,
      userId: user.id, userTag: user.globalName || user.username,
      channelId: ticketChannel.id,
      category: 'report', reason: `User Report against ${reportedUser.tag}`,
      priority: 'medium', status: 'open',
      assignedTo: null, claimedBy: null, ticketMessageId: null,
      timeline: [], createdAt: Date.now(), lastActivity: Date.now(),
      closedAt: null, closedBy: null, closeReason: null,
      inactivityWarned: false,
      caseId: caseId,
    };

    addTimeline(ticketData, 'Ticket Created (User Report)', user.id);

    const embed = buildTicketEmbed(ticketData);
    const row   = buildActionRow(ticketData);

    const ticketMsg = await ticketChannel.send({
      content: `${user} — Welcome to your User Report ticket!`,
      embeds: [embed],
      components: [row],
    });

    ticketData.ticketMessageId = ticketMsg.id;
    tickets[guild.id][ticketId] = ticketData;
    db.write('tickets', tickets);
    logAction(guild.id, 'CREATED', ticketId, user.id, `Category: User Report, Case ID: ${caseId}`);

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('✅ Ticket Created')
        .setDescription(`Your report ticket has been opened: ${ticketChannel}\n\n🚨 **Case ID:** \`${caseId}\`\n🎯 **Reported User:** ${reportedUser}\n📝 **Reason:** ${reason}`)
        .setFooter({ text: ticketId })
        .setTimestamp()],
    });

  } catch (err) {
    if (config.logger) config.logger.error(`[ReportModal] ${err.message}`);
    else console.error(`[ReportModal] ${err.message}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `An error occurred: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.editReply({ content: `An error occurred: ${err.message}` }).catch(() => {});
    }
  }
}

module.exports = {
  handleTicketButton,
  handleTicketSelect,
  handleTicketBulkConfirm,
  handleTicketBulkCancel,
  handleTicketReportModal,
};
