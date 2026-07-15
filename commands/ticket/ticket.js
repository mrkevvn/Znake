'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits,
  ChannelType, MessageFlags,
} = require('discord.js');
const db = require('../../utils/database');
const { isStaff } = require('../../utils/permissions');
const config = require('../../config.json');
const {
  PRIORITIES, STATUSES, CATEGORIES,
  generateTicketId, addTimeline, logAction,
  getTicketByChannel, buildTicketEmbed, buildActionRow,
  updateTicketEmbed, closeTicket,
  buildCategorySelectOptions, syncLinkedCase,
} = require('../../utils/ticketManager');

const COOLDOWN_MAP = new Map();
const COOLDOWN_MS = 30_000;

const PANEL_DEFAULTS = {
  title: '🧭 Support Operations Center',
  description: 'This system is designed to handle support requests in a structured and efficient manner.\n\nTo proceed, select a category below that best matches your request. Our support team will respond based on priority and category classification.',
};

const CATEGORY_CHOICES = [
  { name: 'Technical Support',    value: 'technical' },
  { name: 'Bug Report',           value: 'bug' },
  { name: 'User Report',          value: 'report' },
  { name: 'Billing / Purchase',   value: 'billing' },
  { name: 'Partnership Request',  value: 'partnership' },
  { name: 'Staff Application',    value: 'staffapp' },
  { name: 'Account / Security',   value: 'security' },
  { name: 'Suggestions',          value: 'suggestion' },
  { name: 'Configuration Help',   value: 'config' },
  { name: '📈 Investments',       value: 'investment' },
  { name: 'Other Request',        value: 'other' },
];

const PROFIT_PIT_GUILD_ID = '1513846355075006494';
const PROFIT_PIT_SAFE_TITLE = PANEL_DEFAULTS.title;
const PROFIT_PIT_SAFE_DESC = PANEL_DEFAULTS.description;

const VALID_CATEGORY_KEYS = new Set(Object.keys(CATEGORIES));
const VALID_CATEGORY_VALUES = new Set(CATEGORY_CHOICES.map(c => c.value));
const DEFAULT_CATEGORY = 'other';

function _forceResetProfitPitConfig() {
  const allConfig = db.read('ticket_config');
  delete allConfig[PROFIT_PIT_GUILD_ID].panel;
  allConfig[PROFIT_PIT_GUILD_ID].ticketSystem = {
    panelTitle: PROFIT_PIT_SAFE_TITLE,
    panelDescription: PROFIT_PIT_SAFE_DESC,
  };
  db.write('ticket_config', allConfig);
}

function _sanitizeCategoryData(guildId) {
  const allTickets = db.read('tickets');
  if (!allTickets[guildId]) return;
  let changed = false;
  for (const ticket of Object.values(allTickets[guildId])) {
    if (ticket && ticket.category && !VALID_CATEGORY_KEYS.has(ticket.category)) {
      ticket.category = DEFAULT_CATEGORY;
      changed = true;
    }
  }
  if (changed) db.write('tickets', allTickets);
}

const PRIORITY_CHOICES = [
  { name: 'Low',    value: 'low' },
  { name: 'Medium', value: 'medium' },
  { name: 'High',   value: 'high' },
];

function _getTicketConfig(guildId) {
  const all = db.read('ticket_config');
  if (!all[guildId]) all[guildId] = {};
  return all[guildId];
}

function _saveTicketConfig(guildId, data) {
  const all = db.read('ticket_config');
  all[guildId] = data;
  db.write('ticket_config', all);
}

function _buildPanelEmbed(guild) {
  const isProfitPit = guild.id === PROFIT_PIT_GUILD_ID;
  const panelTitle = isProfitPit ? PROFIT_PIT_SAFE_TITLE : (_getTicketConfig(guild.id).panel?.title || PANEL_DEFAULTS.title);
  const panelDesc = isProfitPit ? PROFIT_PIT_SAFE_DESC : (_getTicketConfig(guild.id).panel?.description || PANEL_DEFAULTS.description);
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(panelTitle)
    .setDescription([
      panelDesc,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '📂 **Category Selection** — Select the category that best matches your request.',
      '⚡ **Response Priority** — Tickets are triaged by category and priority level.',
      '🔒 **Confidential** — All ticket communications are private between you and staff.',
    ].join('\n'))
    .setThumbnail(guild.iconURL() || null)
    .setFooter({ text: 'Ticket System', iconURL: guild.iconURL() || undefined })
    .setTimestamp();
}

function _buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_panel_btn')
      .setLabel('Create Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  );
}

function _staffOnly() {
  return new EmbedBuilder()
    .setColor(config.errorColor || '#ED4245')
    .setTitle('Staff Only')
    .setDescription('You need a staff role to use this command.')
    .setTimestamp();
}

function _hasOpenTicket(tickets, guildId, userId) {
  return Object.values(tickets[guildId] || {}).find(t => t.userId === userId && t.status !== 'closed') || null;
}

function _checkCooldown(userId) {
  const now = Date.now();
  if (COOLDOWN_MAP.has(userId)) {
    const remaining = COOLDOWN_MAP.get(userId) - now;
    if (remaining > 0) return remaining;
  }
  return 0;
}

function _setCooldown(userId) {
  COOLDOWN_MAP.set(userId, Date.now() + COOLDOWN_MS);
}

async function _createTicketChannel(guild, ticketConfig, user, client, category, reason, ticketNum, ticketId) {
  const safeCategory = VALID_CATEGORY_KEYS.has(category) ? category : 'other';
  const catMeta = CATEGORIES[safeCategory] || CATEGORIES.technical;
  const channelName = `${safeCategory}-ticket-${ticketNum.toString().padStart(3, '0')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
  ];

  const assistanceRoleId = ticketConfig?.assistanceRoleId;
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

  const opts = {
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
    topic: `Ticket #${ticketNum} | ${catMeta.label} | ${user.username} | ${reason.slice(0, 100)}`,
  };
  if (ticketConfig?.categoryId) opts.parent = ticketConfig.categoryId;

  const channel = await guild.channels.create(opts);
  return channel;
}

module.exports = {
  name: 'ticket',
  category: 'moderation',
  default_member_permissions: 'ManageGuild',
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(s => s.setName('panel').setDescription('Post the ticket creation panel in this channel'))

    .addSubcommand(s => s.setName('create').setDescription('Open a new support ticket')
      .addStringOption(o => o.setName('category').setDescription('Support category').setRequired(true)
        .addChoices(...CATEGORY_CHOICES))
      .addStringOption(o => o.setName('reason').setDescription('What do you need help with?').setMaxLength(200)))

    .addSubcommand(s => s.setName('close').setDescription('Close this ticket')
      .addStringOption(o => o.setName('reason').setDescription('Reason for closing').setMaxLength(200)))

    .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket as your responsibility'))

    .addSubcommand(s => s.setName('unassign').setDescription('Remove assignment from this ticket'))

    .addSubcommand(s => s.setName('assign').setDescription('Assign a staff member to this ticket')
      .addUserOption(o => o.setName('staff').setDescription('Staff member to assign').setRequired(true)))

    .addSubcommand(s => s.setName('priority').setDescription('Set ticket priority')
      .addStringOption(o => o.setName('level').setDescription('Priority level').setRequired(true)
        .addChoices(...PRIORITY_CHOICES)))

    .addSubcommand(s => s.setName('reopen').setDescription('Reopen a closed ticket'))

    .addSubcommand(s => s.setName('info').setDescription('View detailed ticket information'))

    .addSubcommand(s => s.setName('statistics').setDescription('View ticket analytics for this server'))



    .addSubcommand(s => s.setName('add').setDescription('Add a user to this ticket')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)))

    .addSubcommand(s => s.setName('remove').setDescription('Remove a user from this ticket')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)))

    .addSubcommand(s => s.setName('rename').setDescription('Rename this ticket channel')
      .addStringOption(o => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(60)))

    .addSubcommand(s => s.setName('setticketchannel').setDescription('Configure the ticket system panel and category')
      .addChannelOption(o => o.setName('panel-channel').setDescription('Channel where the ticket panel will be posted').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName('ticket-category').setDescription('Category where ticket channels will be created').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))

    .addSubcommand(s => s.setName('inactivity').setDescription('Configure auto-close for inactive tickets')
      .addIntegerOption(o => o.setName('hours').setDescription('Hours before auto-close (0 = disabled)').setMinValue(0).setMaxValue(168).setRequired(true)))

    .addSubcommand(s => s.setName('setconfig').setDescription('Configure the ticket system settings')
      .addChannelOption(o => o.setName('ticketcategory').setDescription('Discord category where ticket channels are created').addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption(o => o.setName('transcriptchannel').setDescription('Channel where transcripts are automatically sent').addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName('assistance').setDescription('Set the role that will manage and assist in tickets'))
      .addStringOption(o => o.setName('reset').setDescription('Reset a specific setting').addChoices(
        { name: 'Ticket Category',       value: 'categoryId' },
        { name: 'Transcript Channel',    value: 'transcriptChannelId' },
        { name: 'Assistance Role',      value: 'assistanceRoleId' },
        { name: 'All Settings',         value: 'all' },
      )))


    .addSubcommand(s => s.setName('viewconfig').setDescription('View current ticket system configuration'))

    .addSubcommand(s => s.setName('status').setDescription('Change the status of this ticket'))

    .addSubcommand(s => s.setName('note').setDescription('Add or remove an internal staff note on this ticket')
      .addStringOption(o => o.setName('text').setDescription('Note content to add').setMaxLength(500))
      .addIntegerOption(o => o.setName('remove').setDescription('Remove a note by its number (see /ticket info)').setMinValue(1)))

    .addSubcommand(s => s.setName('tag').setDescription('Add or remove freeform tags on this ticket')
      .addStringOption(o => o.setName('add').setDescription('Tag to add -- e.g. billing, vip, follow-up').setMaxLength(32))
      .addStringOption(o => o.setName('remove').setDescription('Tag to remove')))

    .addSubcommand(s => s.setName('search').setDescription('Search and filter tickets across this server')
      .addStringOption(o => o.setName('status').setDescription('Filter by status').addChoices(
        { name: 'Open',              value: 'open' },
        { name: 'Claimed',           value: 'claimed' },
        { name: 'In Progress',       value: 'in_progress' },
        { name: 'Waiting For User',  value: 'waiting_for_user' },
        { name: 'Resolved',          value: 'resolved' },
        { name: 'Closed',            value: 'closed' },
      ))
      .addStringOption(o => o.setName('priority').setDescription('Filter by priority').addChoices(
        { name: 'Low',    value: 'low' },
        { name: 'Medium', value: 'medium' },
        { name: 'High',   value: 'high' },
      ))
      .addStringOption(o => o.setName('category').setDescription('Filter by category').addChoices(...CATEGORY_CHOICES))
      .addUserOption(o => o.setName('assignee').setDescription('Filter by assigned or claimed staff member'))
      .addUserOption(o => o.setName('creator').setDescription('Filter by the user who opened the ticket'))
      .addStringOption(o => o.setName('query').setDescription('Search keyword in ticket reason, notes, or tags').setMaxLength(100))
      .addIntegerOption(o => o.setName('page').setDescription('Page number (default: 1)').setMinValue(1)))

    .addSubcommand(s => s.setName('bulk').setDescription('Preview and execute bulk actions across multiple tickets')
      .addStringOption(o => o.setName('action').setDescription('Bulk action to perform').setRequired(true).addChoices(
        { name: 'Close all Resolved tickets',           value: 'close-resolved' },
        { name: 'Close all Waiting For User tickets',   value: 'close-waiting' },
        { name: 'Reassign tickets between staff',       value: 'reassign' },
      ))
      .addUserOption(o => o.setName('from').setDescription('Reassign: staff member to move tickets away from'))
      .addUserOption(o => o.setName('to').setDescription('Reassign: staff member to assign those tickets to'))),

  cooldown: 5,

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const { guild, member, user, channel } = interaction;

    const tickets = db.read('tickets');
    if (!tickets[guild.id]) tickets[guild.id] = {};
    const ticketConfig = db.read('ticket_config');
    if (!ticketConfig[guild.id]) ticketConfig[guild.id] = {};

    if (sub === 'panel') {
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Missing Permission').setDescription('You need **Manage Server** to post a ticket panel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (guild.id === PROFIT_PIT_GUILD_ID) _forceResetProfitPitConfig();
      _sanitizeCategoryData(guild.id);

      try {
        await channel.send({ embeds: [_buildPanelEmbed(guild)], components: [_buildPanelRow()] });
      } catch {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Failed').setDescription('Could not send the ticket panel in this channel.').setTimestamp()],
        });
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Panel Posted').setDescription('Ticket panel has been posted in this channel.\nInvalid ticket categories have been reset.').setTimestamp()],
      });
    }

    if (sub === 'create') {
      const cooldownRemaining = _checkCooldown(user.id);
      if (cooldownRemaining > 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Cooldown Active').setDescription(`Please wait **${Math.ceil(cooldownRemaining / 1000)}** seconds before creating another ticket.`).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const existing = _hasOpenTicket(tickets, guild.id, user.id);
      if (existing) {
        const existCh = guild.channels.cache.get(existing.channelId);
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Ticket Already Open').setDescription(`You already have an open ticket: ${existCh ? existCh.toString() : '(channel deleted)'}`).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const category = interaction.options.getString('category');
      const safeCategory = VALID_CATEGORY_KEYS.has(category) ? category : 'other';
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const catMeta = CATEGORIES[safeCategory] || CATEGORIES.technical;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const ticketCounter = db.read('ticket_counter');
      if (!ticketCounter[guild.id]) ticketCounter[guild.id] = 0;
      const ticketNum = ++ticketCounter[guild.id];
      db.write('ticket_counter', ticketCounter);

      const ticketId = generateTicketId();

      let ticketChannel;
      try {
        ticketChannel = await _createTicketChannel(guild, ticketConfig[guild.id], user, client, category, reason, ticketNum, ticketId);
      } catch (err) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Failed to Create').setDescription(`Could not create ticket channel:\n\`${err.message}\``).setTimestamp()],
        });
      }

      const ticketData = {
        id: ticketId, number: ticketNum,
        userId: user.id, userTag: user.globalName || user.username,
        channelId: ticketChannel.id,
        category: safeCategory, reason,
        priority: 'medium', status: 'open',
        assignedTo: null, claimedBy: null, ticketMessageId: null,
        timeline: [], createdAt: Date.now(), lastActivity: Date.now(),
        closedAt: null, closedBy: null, closeReason: null,
        inactivityWarned: false,
      };

      addTimeline(ticketData, 'Ticket Created', user.id);

      const embed = buildTicketEmbed(ticketData);
      const row = buildActionRow(ticketData);
      const msg = await ticketChannel.send({ content: `${user} \u2014 Welcome to your ticket!`, embeds: [embed], components: [row] });

      ticketData.ticketMessageId = msg.id;
      tickets[guild.id][ticketId] = ticketData;
      db.write('tickets', tickets);
      logAction(guild.id, 'CREATED', ticketId, user.id, `Category: ${catMeta.label}`);

      _setCooldown(user.id);

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket Created').setDescription(`Your ticket has been opened: ${ticketChannel}\n\n${catMeta.emoji} **Category:** ${catMeta.label}\n**Reason:** ${reason}`).setFooter({ text: ticketId }).setTimestamp()],
      });
    }

    if (sub === 'close') {
      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside an active ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Closing Ticket').setDescription(`Ticket will be closed in **5 seconds**.\n**Reason:** ${reason}`).setTimestamp()],
      });
      await closeTicket(guild, ticket, user, reason, client);
      return;
    }

    if (sub === 'claim') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside an active ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (ticket.claimedBy && ticket.claimedBy !== user.id && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        const claimer = await client.users.fetch(ticket.claimedBy).catch(() => null);
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Already Claimed').setDescription(`This ticket is already claimed by **${claimer ? (claimer.globalName || claimer.username) : 'Unknown'}**.`).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();
      ticket.claimedBy = user.id;
      ticket.status = 'claimed';
      ticket.lastActivity = Date.now();
      addTimeline(ticket, `Claimed by ${user.username}`, user.id);
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      syncLinkedCase(ticket);
      logAction(guild.id, 'CLAIMED', ticket.id, user.id);
      await updateTicketEmbed(guild, ticket);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket Claimed').setDescription(`${user} has claimed this ticket.`).setTimestamp()],
      });
    }

    if (sub === 'unassign') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside an active ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();
      ticket.assignedTo = null;
      ticket.claimedBy = null;
      ticket.status = 'open';
      ticket.lastActivity = Date.now();
      addTimeline(ticket, `Unassigned by ${user.username}`, user.id);
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      syncLinkedCase(ticket);
      logAction(guild.id, 'UNASSIGNED', ticket.id, user.id);
      await updateTicketEmbed(guild, ticket);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Assignment Removed').setDescription('This ticket is now open for any staff member.').setTimestamp()],
      });
    }

    if (sub === 'assign') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside an active ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const staffUser = interaction.options.getUser('staff');
      await interaction.deferReply();

      ticket.assignedTo = staffUser.id;
      ticket.status = 'in_progress';
      ticket.lastActivity = Date.now();
      addTimeline(ticket, `Assigned to ${staffUser.username} by ${user.username}`, user.id);
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      syncLinkedCase(ticket);
      logAction(guild.id, 'ASSIGNED', ticket.id, user.id, `To: ${staffUser.id}`);
      await updateTicketEmbed(guild, ticket);

      staffUser.send({
        embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Ticket Assigned to You').setDescription(`You have been assigned to ticket **${ticket.id}** in **${guild.name}**.\n\n**Category:** ${CATEGORIES[ticket.category]?.label || ticket.category}\n**Reason:** ${ticket.reason}\n**Channel:** <#${ticket.channelId}>`).setTimestamp()],
      }).catch(() => {});

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket Assigned').setDescription(`${staffUser} has been assigned. Status updated to **In Progress**.`).setTimestamp()],
      });
    }

    if (sub === 'priority') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket || ticket.status === 'closed') {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside an active ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const level = interaction.options.getString('level');
      const priority = PRIORITIES[level];
      await interaction.deferReply();

      const old = ticket.priority;
      ticket.priority = level;
      ticket.lastActivity = Date.now();
      addTimeline(ticket, `Priority: ${PRIORITIES[old]?.label || old} \u2192 ${priority.label}`, user.id);
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      logAction(guild.id, 'PRIORITY_CHANGE', ticket.id, user.id, `${old} \u2192 ${level}`);
      await updateTicketEmbed(guild, ticket);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(priority.color).setTitle(`${priority.emoji} Priority Updated`).setDescription(`Priority set to **${priority.label}**.`).setTimestamp()],
      });
    }

    if (sub === 'reopen') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside a ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (ticket.status !== 'closed') {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Not Closed').setDescription('This ticket is not closed.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();

      ticket.status = 'open';
      ticket.closedAt = null;
      ticket.closedBy = null;
      ticket.closeReason = null;
      ticket.lastActivity = Date.now();
      ticket.inactivityWarned = false;
      addTimeline(ticket, `Reopened by ${user.username}`, user.id);
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      syncLinkedCase(ticket);
      logAction(guild.id, 'REOPENED', ticket.id, user.id);

      await channel.permissionOverwrites.create(ticket.userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});

      const embed = buildTicketEmbed(ticket);
      const row = buildActionRow(ticket);
      const newMsg = await channel.send({ embeds: [embed], components: [row] });
      ticket.ticketMessageId = newMsg.id;
      db.write('tickets', tickets);

      const creator = await client.users.fetch(ticket.userId).catch(() => null);
      if (creator) {
        creator.send({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket Reopened').setDescription(`Your ticket **${ticket.id}** in **${guild.name}** has been reopened by staff.`).setTimestamp()],
        }).catch(() => {});
      }

      if (ticket.assignedTo) {
        const staffMember = await client.users.fetch(ticket.assignedTo).catch(() => null);
        if (staffMember) {
          staffMember.send({
            embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Assigned Ticket Reopened').setDescription(`Ticket **${ticket.id}** in **${guild.name}** has been reopened.\n**Channel:** <#${channel.id}>`).setTimestamp()],
          }).catch(() => {});
        }
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket Reopened').setDescription('Ticket is now open. The creator has been notified.').setTimestamp()],
      });
    }

    if (sub === 'info') {
      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside a ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();

      const priority = PRIORITIES[ticket.priority] || PRIORITIES.medium;
      const status = STATUSES[ticket.status] || STATUSES.open;
      const catMeta = CATEGORIES[ticket.category] || CATEGORIES.technical;
      const assignedUser = ticket.assignedTo ? await client.users.fetch(ticket.assignedTo).catch(() => null) : null;
      const claimedUser = ticket.claimedBy ? await client.users.fetch(ticket.claimedBy).catch(() => null) : null;

      const embed = new EmbedBuilder()
        .setColor(priority.color)
        .setTitle(`Ticket Info \u2014 ${ticket.id}`)
        .setDescription(`${catMeta.emoji} **Category:** ${catMeta.label}\n**Reason:** ${ticket.reason}`)
        .addFields(
          { name: 'Ticket ID', value: `\`${ticket.id}\``, inline: true },
          { name: 'Number', value: `#${ticket.number}`, inline: true },
          { name: `${status.emoji} Status`, value: status.label, inline: true },
          { name: `${priority.emoji} Priority`, value: priority.label, inline: true },
          { name: 'Creator', value: `<@${ticket.userId}> (${ticket.userTag})`, inline: true },
          { name: 'Assigned To', value: assignedUser ? `<@${assignedUser.id}>` : 'Unassigned', inline: true },
          { name: 'Claimed By', value: claimedUser ? `<@${claimedUser.id}>` : 'Unclaimed', inline: true },
          { name: 'Created', value: `<t:${Math.floor(ticket.createdAt / 1000)}:F>`, inline: true },
          { name: 'Last Activity', value: `<t:${Math.floor((ticket.lastActivity || ticket.createdAt) / 1000)}:R>`, inline: true },
        );

      if (ticket.closedAt) {
        embed.addFields(
          { name: 'Closed', value: `<t:${Math.floor(ticket.closedAt / 1000)}:F>`, inline: true },
          { name: 'Close Reason', value: ticket.closeReason || 'N/A', inline: false },
        );
      }

      if (ticket.tags?.length) {
        embed.addFields({ name: 'Tags', value: ticket.tags.map(t => `\`${t}\``).join('  '), inline: false });
      }

      if (ticket.notes?.length) {
        embed.addFields({
          name: 'Staff Notes',
          value: ticket.notes.map((n, i) => `**#${i + 1}** \u2014 <@${n.authorId}> <t:${Math.floor(n.timestamp / 1000)}:R>\n> ${n.text}`).join('\n').slice(0, 1024),
          inline: false,
        });
      }

      if (ticket.timeline?.length) {
        embed.addFields({
          name: 'Full Timeline',
          value: ticket.timeline.map(e => `<t:${Math.floor(e.timestamp / 1000)}:t> \u2014 ${e.event}`).join('\n').slice(0, 1024),
          inline: false,
        });
      }

      embed.setFooter({ text: `Ticket #${ticket.number}` }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'statistics') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });
      await interaction.deferReply();

      const guildTickets = Object.values(tickets[guild.id] || {});
      const total = guildTickets.length;
      const open = guildTickets.filter(t => t.status !== 'closed').length;
      const closed = guildTickets.filter(t => t.status === 'closed').length;
      const claimed = guildTickets.filter(t => t.claimedBy).length;
      const escalated = guildTickets.filter(t => t.status === 'escalated').length;
      const critical = guildTickets.filter(t => t.priority === 'critical' && t.status !== 'closed').length;
      const high = guildTickets.filter(t => t.priority === 'high' && t.status !== 'closed').length;

      const staffCounts = {};
      for (const t of guildTickets) {
        if (t.claimedBy) staffCounts[t.claimedBy] = (staffCounts[t.claimedBy] || 0) + 1;
        if (t.assignedTo && t.assignedTo !== t.claimedBy) staffCounts[t.assignedTo] = (staffCounts[t.assignedTo] || 0) + 1;
      }
      const topStaff = Object.entries(staffCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const topStr = topStaff.length ? topStaff.map(([id, c], i) => `${['1.', '2.', '3.'][i]} <@${id}>: **${c}**`).join('\n') : 'No data';

      const catCounts = {};
      for (const t of guildTickets) catCounts[t.category] = (catCounts[t.category] || 0) + 1;
      const catStr = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${CATEGORIES[k]?.emoji || ''} ${CATEGORIES[k]?.label || k}: **${v}**`).join('\n') || 'No tickets';

      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`Ticket Statistics \u2014 ${guild.name}`)
        .addFields(
          { name: 'Total', value: `${total}`, inline: true },
          { name: 'Open', value: `${open}`, inline: true },
          { name: 'Closed', value: `${closed}`, inline: true },
          { name: 'Claimed', value: `${claimed}`, inline: true },
          { name: 'Escalated', value: `${escalated}`, inline: true },
          { name: 'Critical', value: `${critical}`, inline: true },
          { name: 'High Priority', value: `${high}`, inline: true },
          { name: 'Top Staff', value: topStr, inline: false },
          { name: 'By Category', value: catStr, inline: false },
        )
        .setFooter({ text: `Requested by ${user.username}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }



    if (sub === 'add') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser('user');
      await interaction.deferReply();
      try {
        await channel.permissionOverwrites.create(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('User Added').setDescription(`${target} has been added to this ticket.`).setTimestamp()],
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Failed').setDescription(`Could not add user: ${err.message}`).setTimestamp()],
        });
      }
    }

    if (sub === 'remove') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const target = interaction.options.getUser('user');
      await interaction.deferReply();
      try {
        await channel.permissionOverwrites.delete(target.id);
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('User Removed').setDescription(`${target} has been removed from this ticket.`).setTimestamp()],
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Failed').setDescription(`Could not remove user: ${err.message}`).setTimestamp()],
        });
      }
    }

    if (sub === 'rename') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60);
      await interaction.deferReply();
      try {
        await channel.setName(name);
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Renamed').setDescription(`Channel renamed to \`${name}\`.`).setTimestamp()],
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Failed').setDescription(`${err.message}`).setTimestamp()],
        });
      }
    }

    if (sub === 'setticketchannel') {
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Permission Denied').setDescription('You need **Manage Server** to configure the ticket system.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const panelChannel = interaction.options.getChannel('panel-channel');
      const ticketCategory = interaction.options.getChannel('ticket-category');

      if (panelChannel.type !== ChannelType.GuildText) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Invalid Channel').setDescription('Panel channel must be a text channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (ticketCategory.type !== ChannelType.GuildCategory) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Invalid Category').setDescription('Ticket category must be a category channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const cfg = ticketConfig[guild.id];
      cfg.ticketSystem = {
        panelChannelId: panelChannel.id,
        ticketCategoryId: ticketCategory.id,
      };
      cfg.categoryId = ticketCategory.id;
      db.write('ticket_config', ticketConfig);

      try {
        await panelChannel.send({ embeds: [_buildPanelEmbed(guild)], components: [_buildPanelRow()] });
      } catch {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Configuration Saved').setDescription(`Panel Channel: ${panelChannel}\nTicket Category: **${ticketCategory.name}**\n\n⚠️ Could not post the panel to ${panelChannel}. Check my permissions.`).setTimestamp()],
        });
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket System Configured').setDescription(`Panel Channel: ${panelChannel}\nTicket Category: **${ticketCategory.name}**\n\nThe ticket panel has been posted.`).setTimestamp()],
      });
    }

    if (sub === 'inactivity') {
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Missing Permission').setDescription('You need **Manage Server** to configure inactivity settings.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const hours = interaction.options.getInteger('hours');
      ticketConfig[guild.id].inactivityHours = hours === 0 ? null : hours;
      db.write('ticket_config', ticketConfig);

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Inactivity Settings Updated').setDescription(hours === 0 ? 'Auto-close is now **disabled**.' : `Tickets will auto-close after **${hours} hour${hours === 1 ? '' : 's'}** of inactivity.\nA warning is sent 1 hour before closure.`).setTimestamp()],
      });
    }

    if (sub === 'note') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = Object.values(tickets[guild.id] || {}).find(t => t.channelId === interaction.channelId);
      if (!ticket) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket Channel').setDescription('Run this command inside a ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!ticket.notes) ticket.notes = [];

      const removeIndex = interaction.options.getInteger('remove');
      const text = interaction.options.getString('text');

      if (!removeIndex && !text) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('No Action').setDescription('Provide `text` to add a note, or `remove` with a note number to delete one.\n\nView existing notes with `/ticket info`.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (removeIndex) {
        if (removeIndex > ticket.notes.length) {
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Invalid Note Number').setDescription(`This ticket only has **${ticket.notes.length}** note${ticket.notes.length === 1 ? '' : 's'}. Use \`/ticket info\` to see all notes.`).setTimestamp()],
            flags: MessageFlags.Ephemeral,
          });
        }

        const removed = ticket.notes.splice(removeIndex - 1, 1)[0];
        addTimeline(ticket, `Note #${removeIndex} removed by ${user.username}`, user.id);
        ticket.lastActivity = Date.now();
        tickets[guild.id][ticket.id] = ticket;
        db.write('tickets', tickets);
        logAction(guild.id, 'NOTE_REMOVED', ticket.id, user.id, `Note #${removeIndex}`);

        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Note Removed').setDescription(`Note #${removeIndex} has been removed.`).addFields({ name: 'Removed Content', value: `> ${removed.text}` }).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const note = { text, authorId: user.id, authorTag: user.globalName || user.username, timestamp: Date.now() };
      ticket.notes.push(note);
      addTimeline(ticket, `Note added by ${user.username}`, user.id);
      ticket.lastActivity = Date.now();
      tickets[guild.id][ticket.id] = ticket;
      db.write('tickets', tickets);
      logAction(guild.id, 'NOTE_ADDED', ticket.id, user.id, text.slice(0, 100));

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('Staff Note Added').setDescription(`> ${text}`).addFields(
          { name: 'Author', value: `<@${user.id}>`, inline: true },
          { name: 'Note #', value: `${ticket.notes.length}`, inline: true },
          { name: 'Added', value: `<t:${Math.floor(note.timestamp / 1000)}:R>`, inline: true },
        ).setFooter({ text: `${ticket.notes.length} total note${ticket.notes.length === 1 ? '' : 's'} on this ticket` }).setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'tag') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = Object.values(tickets[guild.id] || {}).find(t => t.channelId === interaction.channelId);
      if (!ticket) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket Channel').setDescription('Run this command inside a ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!ticket.tags) ticket.tags = [];

      const addTag = interaction.options.getString('add');
      const removeTag = interaction.options.getString('remove');

      if (!addTag && !removeTag) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Ticket Tags').setDescription(ticket.tags.length ? ticket.tags.map(t => `\`${t}\``).join('  ') : '*No tags on this ticket yet.*\n\nUse `/ticket tag add:` to add one.').setFooter({ text: `${ticket.tags.length} tag${ticket.tags.length === 1 ? '' : 's'} \u00b7 ${ticket.id}` }).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (addTag && removeTag) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('One Action at a Time').setDescription('Provide either `add` or `remove`, not both.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (addTag) {
        const normalized = addTag.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
        if (!normalized) {
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Invalid Tag').setDescription('Tags may only contain letters, numbers, and hyphens.').setTimestamp()],
            flags: MessageFlags.Ephemeral,
          });
        }
        if (ticket.tags.includes(normalized)) {
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Duplicate Tag').setDescription(`This ticket already has the tag \`${normalized}\`.`).setTimestamp()],
            flags: MessageFlags.Ephemeral,
          });
        }
        if (ticket.tags.length >= 10) {
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Tag Limit Reached').setDescription('Tickets can have a maximum of **10 tags**. Remove one before adding another.').setTimestamp()],
            flags: MessageFlags.Ephemeral,
          });
        }

        ticket.tags.push(normalized);
        addTimeline(ticket, `Tag added: ${normalized} by ${user.username}`, user.id);
        tickets[guild.id][ticket.id] = ticket;
        db.write('tickets', tickets);

        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Tag Added').addFields(
            { name: 'Tag', value: `\`${normalized}\``, inline: true },
            { name: 'Added By', value: `${member}`, inline: true },
            { name: 'All Tags', value: ticket.tags.map(t => `\`${t}\``).join('  ') || '*none*', inline: false },
          ).setFooter({ text: `${ticket.tags.length}/10 tags \u00b7 ${ticket.id}` }).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (removeTag) {
        const normalized = removeTag.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
        const idx = ticket.tags.indexOf(normalized);
        if (idx === -1) {
          const closest = ticket.tags.length ? `\n\n**Current tags:** ${ticket.tags.map(t => `\`${t}\``).join('  ')}` : '';
          return interaction.reply({
            embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Tag Not Found').setDescription(`\`${normalized}\` is not on this ticket.${closest}`).setTimestamp()],
            flags: MessageFlags.Ephemeral,
          });
        }

        ticket.tags.splice(idx, 1);
        addTimeline(ticket, `Tag removed: ${normalized} by ${user.username}`, user.id);
        tickets[guild.id][ticket.id] = ticket;
        db.write('tickets', tickets);

        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Tag Removed').addFields(
            { name: 'Removed', value: `\`${normalized}\``, inline: true },
            { name: 'Removed By', value: `${member}`, inline: true },
            { name: 'Remaining', value: ticket.tags.length ? ticket.tags.map(t => `\`${t}\``).join('  ') : '*No tags remaining*', inline: false },
          ).setFooter({ text: `${ticket.tags.length}/10 tags \u00b7 ${ticket.id}` }).setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (sub === 'search') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const fStatus = interaction.options.getString('status');
      const fPriority = interaction.options.getString('priority');
      const fCategory = interaction.options.getString('category');
      const fAssignee = interaction.options.getUser('assignee');
      const fCreator = interaction.options.getUser('creator');
      const query = interaction.options.getString('query')?.toLowerCase().trim();
      const page = interaction.options.getInteger('page') || 1;
      const PAGE_SIZE = 7;

      const PRIO_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

      let results = Object.values(tickets[guild.id] || {});

      if (fStatus) results = results.filter(t => t.status === fStatus);
      if (fPriority) results = results.filter(t => t.priority === fPriority);
      if (fCategory) results = results.filter(t => t.category === fCategory);
      if (fAssignee) results = results.filter(t => t.assignedTo === fAssignee.id || t.claimedBy === fAssignee.id);
      if (fCreator) results = results.filter(t => t.userId === fCreator.id);
      if (query) {
        results = results.filter(t =>
          t.reason?.toLowerCase().includes(query) ||
          t.id.toLowerCase().includes(query) ||
          t.userTag?.toLowerCase().includes(query) ||
          t.notes?.some(n => n.text.toLowerCase().includes(query)) ||
          t.tags?.some(tag => tag.includes(query)),
        );
      }

      results.sort((a, b) => {
        const aClosed = a.status === 'closed';
        const bClosed = b.status === 'closed';
        if (aClosed !== bClosed) return aClosed ? 1 : -1;
        const prioDiff = (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2);
        if (prioDiff !== 0) return prioDiff;
        return (b.lastActivity || b.createdAt) - (a.lastActivity || a.createdAt);
      });

      if (results.length === 0) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('No Tickets Found').setDescription('No tickets matched the applied filters.\n\nTry relaxing some filters or using `/ticket statistics` for an overview.').setTimestamp()],
        });
      }

      const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
      const safePage = Math.min(page, totalPages);
      const sliceStart = (safePage - 1) * PAGE_SIZE;
      const pageItems = results.slice(sliceStart, sliceStart + PAGE_SIZE);

      const activeFilters = [
        fStatus && `${STATUSES[fStatus]?.emoji || ''} **${STATUSES[fStatus]?.label || fStatus}**`,
        fPriority && `${PRIORITIES[fPriority]?.emoji || ''} **${PRIORITIES[fPriority]?.label || fPriority}**`,
        fCategory && `${CATEGORIES[fCategory]?.emoji || ''} **${CATEGORIES[fCategory]?.label || fCategory}**`,
        fAssignee && `**${fAssignee.username}**`,
        fCreator && `by **${fCreator.username}**`,
        query && `"${query}"`,
      ].filter(Boolean);

      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`Ticket Search \u2014 ${results.length} result${results.length === 1 ? '' : 's'}`)
        .setDescription(activeFilters.length ? `**Active Filters:** ${activeFilters.join(' \u00b7 ')}\n\u200b` : '*No filters \u2014 showing all tickets sorted by priority*\n\u200b');

      for (const t of pageItems) {
        const priority = PRIORITIES[t.priority] || PRIORITIES.medium;
        const status = STATUSES[t.status] || STATUSES.open;
        const catMeta = CATEGORIES[t.category] || CATEGORIES.technical;
        const reasonText = t.reason?.length > 72 ? `${t.reason.slice(0, 72)}...` : (t.reason || 'No reason');
        const staffLine = t.claimedBy ? `<@${t.claimedBy}>` : t.assignedTo ? `<@${t.assignedTo}>` : 'Unassigned';

        embed.addFields({
          name: `${priority.emoji} ${status.emoji} ${catMeta.emoji}  \`${t.id}\`  \u00b7  #${t.number}  \u00b7  ${status.label}`,
          value: [
            `> ${reasonText}`,
            `<@${t.userId}> (${t.userTag})  \u00b7  ${staffLine}`,
            `<t:${Math.floor(t.createdAt / 1000)}:R>  \u00b7  <t:${Math.floor((t.lastActivity || t.createdAt) / 1000)}:R>  \u00b7  <#${t.channelId}>`,
          ].join('\n'),
          inline: false,
        });
      }

      const rangeStart = sliceStart + 1;
      const rangeEnd = Math.min(sliceStart + PAGE_SIZE, results.length);

      embed.setFooter({ text: `Page ${safePage} / ${totalPages}  \u00b7  Showing ${rangeStart}-${rangeEnd} of ${results.length} ticket${results.length === 1 ? '' : 's'}  \u00b7  Sorted by priority then activity` }).setTimestamp();

      if (page > totalPages) {
        embed.setDescription(`${embed.data.description}\nPage ${page} doesn't exist \u2014 showing page ${safePage}.`);
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'setconfig') {
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Missing Permission').setDescription('You need **Manage Server** to configure the ticket system.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const resetKey = interaction.options.getString('reset');
      const ticketCat = interaction.options.getChannel('ticketcategory');
      const transcriptCh = interaction.options.getChannel('transcriptchannel');
      const assistanceRole = interaction.options.getRole?.('assistance') || null;


      if (!resetKey && !ticketCat && !transcriptCh && !assistanceRole) {

        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('No Changes').setDescription('Provide at least one option to update, or use `reset` to clear a setting.\n\nUse `/ticket viewconfig` to see the current configuration.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (resetKey) {
        if (resetKey === 'all') {
          ticketConfig[guild.id] = {
            categoryId: null,
            transcriptChannelId: null,
            assistanceRoleId: null,
            inactivityHours: ticketConfig[guild.id]?.inactivityHours ?? null,
          };
        } else {
          ticketConfig[guild.id][resetKey] = null;
        }

        // Ignore legacy keys safely
        delete ticketConfig[guild.id]?.seniorStaffRoleId;
        delete ticketConfig[guild.id]?.logChannelId;

        db.write('ticket_config', ticketConfig);
        const resetLabel = resetKey === 'all' ? 'all settings' : `**${resetKey}**`;
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Setting Reset').setDescription(`Successfully reset ${resetLabel}.`).setTimestamp()],
        });
      }

      const changes = [];
      if (ticketCat) { ticketConfig[guild.id].categoryId = ticketCat.id; changes.push(`Ticket Category -> **${ticketCat.name}**`); }
      if (transcriptCh) { ticketConfig[guild.id].transcriptChannelId = transcriptCh.id; changes.push(`Transcript Channel -> ${transcriptCh}`); }
      if (assistanceRole) {
        ticketConfig[guild.id].assistanceRoleId = assistanceRole.id;
        changes.push(`Assistance Role -> <@&${assistanceRole.id}>`);
      }
      // legacy key cleanup (ignore legacy configs safely)
      delete ticketConfig[guild.id]?.seniorStaffRoleId;
      delete ticketConfig[guild.id]?.logChannelId;

      db.write('ticket_config', ticketConfig);


      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.successColor).setTitle('Ticket Config Updated').setDescription(changes.join('\n')).setFooter({ text: 'Use /ticket viewconfig to see all settings' }).setTimestamp()],
      });
    }

    if (sub === 'viewconfig') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const cfg = ticketConfig[guild.id] || {};

      const ticketCat = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : null;
      const transcriptCh = cfg.transcriptChannelId ? guild.channels.cache.get(cfg.transcriptChannelId) : null;
      const assistanceRole = cfg.assistanceRoleId ? guild.roles.cache.get(cfg.assistanceRoleId) : null;

      const panel = cfg.panel || {};
      const panelTitle = panel.title || PANEL_DEFAULTS.title;
      const panelDesc = panel.description || PANEL_DEFAULTS.description;

      const guildTickets = Object.values(tickets[guild.id] || {});
      const openCount = guildTickets.filter(t => t.status !== 'closed').length;
      const closedCount = guildTickets.filter(t => t.status === 'closed').length;
      const criticalCount = guildTickets.filter(t => t.priority === 'critical' && t.status !== 'closed').length;

      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle('Ticket System Configuration')
        .setThumbnail(guild.iconURL() || null)
        .addFields(
          { name: 'Ticket Category', value: ticketCat ? `**${ticketCat.name}** (\`${ticketCat.id}\`)` : '`Not set` \u2014 Tickets will appear at top level', inline: false },
          { name: 'Transcript Channel', value: transcriptCh ? `${transcriptCh} (\`${transcriptCh.name}\`)` : '`Not set` \u2014 Use `/ticket setconfig transcriptchannel:` to set one', inline: false },
          { name: 'Assistance Role', value: assistanceRole ? `${assistanceRole} (\`${assistanceRole.id}\`)` : '`Not set` \u2014 Use `/ticket setconfig assistance:` to set one', inline: false },
          { name: 'Inactivity Auto-Close', value: cfg.inactivityHours ? `After **${cfg.inactivityHours} hour${cfg.inactivityHours === 1 ? '' : 's'}** of inactivity` : '`Disabled`', inline: false },
          { name: 'Panel Title', value: panelTitle, inline: false },
          { name: 'Panel Description', value: panelDesc.length > 100 ? panelDesc.slice(0, 100) + '...' : panelDesc, inline: false },
          { name: 'Quick Stats', value: [`Open: **${openCount}**`, `Closed: **${closedCount}**`, `Critical Open: **${criticalCount}**`].join('  \u00b7  '), inline: false },
        )
        .setFooter({ text: 'Use /ticket setconfig to change settings' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'status') {
      if (!isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const ticket = getTicketByChannel(guild.id, channel.id);
      if (!ticket) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Not a Ticket').setDescription('Use this inside a ticket channel.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const current = STATUSES[ticket.status] || STATUSES.open;

      const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_status_sel')
        .setPlaceholder(`Current: ${current.emoji} ${current.label}`)
        .addOptions(
          Object.entries(STATUSES).map(([value, meta]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(meta.label)
              .setEmoji(meta.emoji)
              .setValue(value)
              .setDescription(value === ticket.status ? '<- Current status' : `Set status to ${meta.label}`)
              .setDefault(value === ticket.status)
          ),
        );

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('Change Ticket Status').setDescription(`Select a new status for ticket **${ticket.id}**.\n\nCurrent: ${current.emoji} **${current.label}**`).setFooter({ text: 'This update will be visible to everyone in the channel.' }).setTimestamp()],
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'bulk') {
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      if (!isAdmin && !isStaff(member, guild.id)) return interaction.reply({ embeds: [_staffOnly()], flags: MessageFlags.Ephemeral });

      const action = interaction.options.getString('action');
      const fromUser = interaction.options.getUser('from');
      const toUser = interaction.options.getUser('to');

      if (action === 'reassign' && (!fromUser || !toUser)) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('Missing Options').setDescription('**Reassign** requires both `from:` (current staff) and `to:` (new staff) options.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      let affected = Object.values(tickets[guild.id] || {});
      if (action === 'close-resolved') affected = affected.filter(t => t.status === 'resolved');
      if (action === 'close-waiting') affected = affected.filter(t => t.status === 'waiting_for_user');
      if (action === 'close-escalated') affected = affected.filter(t => t.status === 'escalated');
      if (action === 'reassign') affected = affected.filter(t => t.status !== 'closed' && (t.assignedTo === fromUser.id || t.claimedBy === fromUser.id));

      if (affected.length === 0) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(config.warningColor).setTitle('Nothing to Do').setDescription('No tickets matched the selected action\'s criteria.').setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const ACTION_LABEL = {
        'close-resolved': 'Close all **Resolved** tickets',
        'close-waiting': 'Close all **Waiting For User** tickets',
        'close-escalated': 'Close all **Escalated** tickets',
        'reassign': `Reassign from **${fromUser?.username}** -> **${toUser?.username}**`,
      };

      const previewLines = affected.slice(0, 6).map(t => `. \`${t.id}\` #${t.number} \u2014 ${t.userTag}`).join('\n');
      const overflow = affected.length > 6 ? `\n*...and ${affected.length - 6} more*` : '';

      const params = action === 'reassign' ? `${action}:${fromUser.id}:${toUser.id}` : action;

      const confirmEmbed = new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle('Confirm Bulk Action')
        .setDescription(`**Action:** ${ACTION_LABEL[action]}\n**Affected:** **${affected.length}** ticket${affected.length !== 1 ? '' : 's'}\n\u200b`)
        .addFields({ name: 'Preview', value: previewLines + overflow, inline: false })
        .setFooter({ text: 'This action is permanent \u2014 review carefully before confirming' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_bulk_confirm:${params}`).setLabel(`Confirm  (${affected.length} ticket${affected.length !== 1 ? '' : 's'})`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_bulk_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      return interaction.reply({ embeds: [confirmEmbed], components: [row], flags: MessageFlags.Ephemeral });
    }
  },
};
