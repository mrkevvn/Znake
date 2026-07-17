'use strict';

const {
  MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType,
} = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config.json');
const logger = require('../../utils/logger');

const ITEMS_PER_PAGE = 5;
const MAX_BACKUPS_PER_GUILD = 50;
const CONFIRM_TIMEOUT = 30_000;
const LIST_COLLECTOR_TIMEOUT = 120_000;
const MODAL_TIMEOUT = 600_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(size) {
  if (!size || size === 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let i = 0;
  let s = size;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(1)} ${units[i]}`;
}

function estimateBackupSize(data) {
  try {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  } catch {
    return 0;
  }
}

function getChannelTypeLabel(type) {
  const labels = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildStageVoice]: 'Stage',
  };
  return labels[type] || 'Other';
}

function generateBackupId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ── Embeds ───────────────────────────────────────────────────────────────────

function buildBackupEmbed(backup, guild, page, totalPages) {
  const size = estimateBackupSize(backup);
  const created = backup.createdAt ? `<t:${Math.floor(backup.createdAt / 1000)}:F>` : 'Unknown';
  const creator = backup.createdBy ? `<@${backup.createdBy}>` : 'Unknown';

  const channelSummary = {};
  for (const ch of backup.channels || []) {
    const label = getChannelTypeLabel(ch.type);
    channelSummary[label] = (channelSummary[label] || 0) + 1;
  }
  const channelLines = Object.entries(channelSummary)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');

  const roleCount = (backup.roles || []).length;

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`Backup: ${backup.name}`)
    .setDescription([
      `> ID: \`${backup.id}\``,
      `> Size: ${formatBytes(size)}`,
    ].join('\n'))
    .addFields(
      { name: 'Creator', value: creator, inline: true },
      { name: 'Created', value: created, inline: true },
      { name: 'Member Count', value: `${backup.memberCount || 'Unknown'}`, inline: true },
      { name: 'Channels', value: `${(backup.channels || []).length} total\n${channelLines || 'None'}`, inline: true },
      { name: 'Roles', value: `${roleCount} total`, inline: true },
    )
    .setTimestamp();

  if (backup.description) {
    embed.addFields({ name: 'Description', value: backup.description.slice(0, 1024), inline: false });
  }

  if (totalPages > 1) {
    embed.setFooter({ text: `Page ${page} / ${totalPages} | ${backup.id}` });
  } else {
    embed.setFooter({ text: backup.id });
  }

  return embed;
}

function buildBackupListEmbed(guild, backups, page) {
  const totalPages = Math.max(1, Math.ceil(backups.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * ITEMS_PER_PAGE;
  const pageItems = backups.slice(start, start + ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`Backups - ${guild.name}`)
    .setDescription(backups.length === 0
      ? 'No backups have been created for this server yet.'
      : `**${backups.length}** backup${backups.length === 1 ? '' : 's'} stored`)
    .setTimestamp();

  if (backups.length === 0) {
    embed.setFooter({ text: 'Use /backup create to make one' });
    return { embed, totalPages, safePage };
  }

  for (const b of pageItems) {
    const size = formatBytes(estimateBackupSize(b));
    const created = b.createdAt ? `<t:${Math.floor(b.createdAt / 1000)}:R>` : 'Unknown';
    embed.addFields({
      name: b.name,
      value: [
        `ID: \`${b.id}\``,
        `Created: ${created} by <@${b.createdBy}>`,
        `Channels: ${(b.channels || []).length} | Roles: ${(b.roles || []).length} | ${size}`,
      ].join('\n'),
    });
  }

  embed.setFooter({ text: `Page ${safePage} / ${totalPages}` });
  return { embed, totalPages, safePage };
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

// ── UI Components ────────────────────────────────────────────────────────────

function buildNavRow(page, totalPages) {
  if (totalPages <= 1) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('backup_first')
      .setLabel('<<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId('backup_prev')
      .setLabel('<')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId('backup_next')
      .setLabel('>')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId('backup_last')
      .setLabel('>>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
}

function buildActionRow(backupId, { canDelete = false } = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`backup_load:${backupId}`)
      .setLabel('Load Backup')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId(`backup_info:${backupId}`)
      .setLabel('Details')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('ℹ️'),
  );

  if (canDelete) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`backup_delete:${backupId}`)
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
    );
  }

  return row;
}

function buildConfirmRow(confirmId, cancelId, label, emoji) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(label)
      .setStyle(ButtonStyle.Danger)
      .setEmoji(emoji),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

// ── Data Operations ──────────────────────────────────────────────────────────

function readGuildBackups(guildId) {
  const all = db.read('backups');
  if (!all[guildId]) all[guildId] = {};
  return all;
}

function writeAllBackups(data) {
  return db.write('backups', data);
}

function createBackup(guild, name, description, userId) {
  const channels = guild.channels.cache.map(ch => ({
    name: ch.name,
    type: ch.type,
    parentId: ch.parentId,
    parentName: ch.parent ? ch.parent.name : null,
    position: ch.position,
    topic: ch.topic || null,
    nsfw: ch.nsfw || false,
    rateLimitPerUser: ch.rateLimitPerUser || 0,
    bitrate: ch.bitrate || null,
    userLimit: ch.userLimit || 0,
    rtcRegion: ch.rtcRegion || null,
    videoQualityMode: ch.videoQualityMode || null,
    defaultAutoArchiveDuration: ch.defaultAutoArchiveDuration || null,
    permissionOverwrites: ch.permissionOverwrites.cache.map(ov => ({
      id: ov.id,
      type: ov.type,
      allow: ov.allow.bitfield.toString(),
      deny: ov.deny.bitfield.toString(),
    })),
  }));

  const roles = guild.roles.cache
    .filter(r => !r.managed && r.id !== guild.id)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
      icon: r.icon || null,
      unicodeEmoji: r.unicodeEmoji || null,
    }));

  return {
    id: generateBackupId(),
    name,
    description: description || null,
    createdBy: userId,
    createdAt: Date.now(),
    memberCount: guild.memberCount,
    channels,
    roles,
  };
}

// ── Restore Logic ────────────────────────────────────────────────────────────

async function restoreBackup(guild, backup, onProgress) {
  let rolesCreated = 0;
  let channelsCreated = 0;
  let errors = 0;

  const sortRoles = [...(backup.roles || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  const totalRoles = sortRoles.length;
  const roleIdMap = {};

  for (let i = 0; i < sortRoles.length; i++) {
    const rd = sortRoles[i];
    try {
      const newRole = await guild.roles.create({
        name: `[R] ${rd.name}`,
        color: rd.color || '#000000',
        hoist: rd.hoist || false,
        mentionable: rd.mentionable || false,
        permissions: BigInt(rd.permissions || '0'),
        icon: rd.icon || null,
        unicodeEmoji: rd.unicodeEmoji || null,
        reason: `Backup restore: ${backup.id}`,
      });
      if (rd.id) roleIdMap[rd.id] = newRole.id;
      rolesCreated++;
    } catch {
      errors++;
    }
    if ((i + 1) % 3 === 0 || i === sortRoles.length - 1) {
      onProgress?.('Restoring roles...', i + 1, totalRoles, rolesCreated, channelsCreated, errors);
    }
  }

  const categories = (backup.channels || []).filter(c => c.type === ChannelType.GuildCategory);
  const nonCategories = (backup.channels || []).filter(c => c.type !== ChannelType.GuildCategory);
  const totalCh = categories.length + nonCategories.length;
  let chDone = 0;

  const catMap = {};
  for (const cat of categories) {
    try {
      const created = await guild.channels.create({
        name: `[R] ${cat.name}`,
        type: ChannelType.GuildCategory,
        position: cat.position,
        reason: `Backup restore: ${backup.id}`,
      });
      catMap[cat.name] = created.id;
      channelsCreated++;
    } catch {
      errors++;
    }
    chDone++;
    onProgress?.('Restoring categories...', chDone, totalCh, rolesCreated, channelsCreated, errors);
  }

  for (const cd of nonCategories) {
    try {
      const opts = {
        name: `[R] ${cd.name}`,
        type: cd.type,
        position: cd.position,
        topic: cd.topic,
        nsfw: cd.nsfw || false,
        rateLimitPerUser: cd.rateLimitPerUser || 0,
        bitrate: cd.bitrate || null,
        userLimit: cd.userLimit || 0,
        rtcRegion: cd.rtcRegion || null,
        videoQualityMode: cd.videoQualityMode || null,
        defaultAutoArchiveDuration: cd.defaultAutoArchiveDuration || null,
        reason: `Backup restore: ${backup.id}`,
      };

      if (cd.parentName && catMap[cd.parentName]) {
        opts.parent = catMap[cd.parentName];
      }

      const created = await guild.channels.create(opts);

      if (cd.permissionOverwrites && Array.isArray(cd.permissionOverwrites)) {
        for (const ov of cd.permissionOverwrites) {
          try {
            let target;
            if (ov.type === 0) {
              const newRoleId = roleIdMap[ov.id];
              target = newRoleId ? guild.roles.cache.get(newRoleId) : null;
            } else {
              target = guild.members.cache.get(ov.id);
            }
            if (target) {
              await created.permissionOverwrites.create(target, {
                allow: BigInt(ov.allow || '0'),
                deny: BigInt(ov.deny || '0'),
              });
            }
          } catch { /* non-critical */ }
        }
      }

      channelsCreated++;
    } catch {
      errors++;
    }
    chDone++;
    onProgress?.('Restoring channels...', chDone, totalCh, rolesCreated, channelsCreated, errors);
  }

  logger.info(`Backup restored: ${backup.id} (${backup.name}) in ${guild.name} - ${rolesCreated} roles, ${channelsCreated} channels, ${errors} errors`);
  return { rolesCreated, channelsCreated, errors };
}

// ── Interaction Flows ────────────────────────────────────────────────────────

async function handleLoadFlow(interaction, backup, guild, user, { fromButton = false } = {}) {
  const backupId = backup.id;
  const confirmRow = buildConfirmRow(
    `backup_confirm_load:${backupId}`,
    `backup_cancel_load:${backupId}`,
    'Confirm Restore',
    '⚠️',
  );

  const confirmEmbed = new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle('Confirm Backup Restore')
    .setDescription([
      `You are about to restore **${backup.name}** (\`${backupId}\`).`,
      '',
      '**This will create:**',
      `- ${(backup.roles || []).length} role(s)`,
      `- ${(backup.channels || []).length} channel(s)`,
      '',
      'Restored items are prefixed with `[R]` to avoid conflicts.',
      '',
      '**This action cannot be undone.**',
    ].join('\n'))
    .setTimestamp();

  if (fromButton) {
    await interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });
  } else {
    await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], flags: MessageFlags.Ephemeral });
  }

  try {
    const confirmation = await interaction.awaitMessageComponent({
      filter: (i) => i.user.id === user.id && (
        i.customId === `backup_confirm_load:${backupId}` ||
        i.customId === `backup_cancel_load:${backupId}`
      ),
      time: CONFIRM_TIMEOUT,
    });

    if (confirmation.customId === `backup_cancel_load:${backupId}`) {
      return confirmation.update({
        embeds: [new EmbedBuilder()
          .setColor(config.infoColor)
          .setTitle('Restore Cancelled')
          .setDescription('Backup restore has been cancelled.')
          .setTimestamp()],
        components: [buildActionRow(backupId, true)],
      });
    }

    await confirmation.deferUpdate();

    const statusMsg = await confirmation.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.warningColor)
        .setTitle('Loading Backup')
        .setDescription('Starting restore process...\n\u200b\n\u200b')
        .setTimestamp()],
      components: [],
    });

    const onProgress = (step, current, total, rc, cc, errs) => {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      statusMsg.edit({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('Loading Backup')
          .setDescription([
            `**Step:** ${step}`,
            `**Progress:** ${current}/${total}`,
            `\`${bar}\` ${pct}%`,
            '',
            `Roles created: ${rc}`,
            `Channels created: ${cc}`,
            `Errors: ${errs}`,
          ].join('\n'))
          .setTimestamp()],
      }).catch(() => {});
    };

    const result = await restoreBackup(guild, backup, onProgress);

    return confirmation.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('Backup Restored')
        .setDescription([
          `**${backup.name}** has been restored.`,
          '',
          `Roles created: **${result.rolesCreated}**`,
          `Channels created: **${result.channelsCreated}**`,
          result.errors > 0 ? `Errors: **${result.errors}**` : '',
        ].filter(Boolean).join('\n'))
        .setTimestamp()],
      components: [buildActionRow(backupId, true)],
    });
  } catch {
    try {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('Timed Out')
          .setDescription('Confirmation timed out. Run `/backup load` again.')
          .setTimestamp()],
        components: [buildActionRow(backupId, true)],
      });
    } catch { /* interaction may have expired */ }
  }
}

async function handleDeleteFlow(interaction, backup, backupId, guild, user, backups, { fromButton = false } = {}) {
  const confirmRow = buildConfirmRow(
    `backup_confirm_delete:${backupId}`,
    `backup_cancel_delete:${backupId}`,
    'Confirm Delete',
    '🗑️',
  );

  const confirmEmbed = new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle('Confirm Deletion')
    .setDescription([
      `Are you sure you want to delete **${backup.name}** (\`${backupId}\`)?`,
      '',
      `Channels: ${(backup.channels || []).length}`,
      `Roles: ${(backup.roles || []).length}`,
      `Created: ${backup.createdAt ? `<t:${Math.floor(backup.createdAt / 1000)}:R>` : 'Unknown'}`,
      '',
      '**This cannot be undone.**',
    ].join('\n'))
    .setTimestamp();

  if (fromButton) {
    await interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });
  } else {
    await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], flags: MessageFlags.Ephemeral });
  }

  try {
    const confirmation = await interaction.awaitMessageComponent({
      filter: (i) => i.user.id === user.id && (
        i.customId === `backup_confirm_delete:${backupId}` ||
        i.customId === `backup_cancel_delete:${backupId}`
      ),
      time: CONFIRM_TIMEOUT,
    });

    if (confirmation.customId === `backup_cancel_delete:${backupId}`) {
      return confirmation.update({
        embeds: [new EmbedBuilder()
          .setColor(config.infoColor)
          .setTitle('Deletion Cancelled')
          .setDescription('Backup was not deleted.')
          .setTimestamp()],
        components: [buildActionRow(backupId, true)],
      });
    }

    delete backups[guild.id][backupId];
    const success = writeAllBackups(backups);
    if (!success) throw new Error('Database write failed');

    logger.info(`Backup deleted: ${backupId} (${backup.name}) in ${guild.name} by ${user.tag}`);

    return confirmation.update({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('Backup Deleted')
        .setDescription(`**${backup.name}** (\`${backupId}\`) has been deleted.`)
        .setTimestamp()],
      components: [],
    });
  } catch (err) {
    try {
      const message = err.message === 'Database write failed'
        ? 'Failed to delete backup due to a database write error.'
        : 'Confirmation timed out or an error occurred. Run `/backup delete` again.';
      await interaction.editReply({
        embeds: [errorEmbed('Deletion Failed', message)],
        components: [],
      });
    } catch { /* interaction may have expired */ }
  }
}

// ── Subcommand Handlers ──────────────────────────────────────────────────────

async function handleCreate(interaction, guild, user, backups) {
  const modal = new ModalBuilder()
    .setCustomId('backup_create_modal')
    .setTitle('Create Server Backup');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('backup_name')
        .setLabel('Backup Name')
        .setPlaceholder('e.g. Pre-event setup, Season 2 launch')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('backup_description')
        .setLabel('Description (optional)')
        .setPlaceholder('What does this backup capture?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(300),
    ),
  );

  await interaction.showModal(modal);

  try {
    const submitted = await interaction.awaitModalSubmit({
      time: MODAL_TIMEOUT,
      filter: (i) => i.customId === 'backup_create_modal' && i.user.id === user.id,
    });

    const name = submitted.fields.getTextInputValue('backup_name')?.trim();
    const description = submitted.fields.getTextInputValue('backup_description')?.trim() || null;

    if (!name) {
      return submitted.reply({ content: 'Backup name is required.', flags: MessageFlags.Ephemeral });
    }

    await submitted.deferReply({ flags: MessageFlags.Ephemeral });

    const backupCount = Object.keys(backups[guild.id]).length;
    if (backupCount >= MAX_BACKUPS_PER_GUILD) {
      return submitted.editReply({
        embeds: [errorEmbed('Backup Limit Reached',
          `This server has reached the maximum of **${MAX_BACKUPS_PER_GUILD}** backups. Delete an existing backup before creating a new one.`)],
      });
    }

    const backup = createBackup(guild, name, description, user.id);
    backups[guild.id][backup.id] = backup;
    writeAllBackups(backups);

    logger.info(`Backup created: ${backup.id} (${backup.name}) in ${guild.name} by ${user.tag}`);

    const size = formatBytes(estimateBackupSize(backup));

    return submitted.editReply({
      embeds: [new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('Backup Created')
        .setDescription([
          `**${backup.name}** has been saved.`,
          '',
          `ID: \`${backup.id}\``,
          `Channels: ${backup.channels.length}`,
          `Roles: ${backup.roles.length}`,
          `Size: ${size}`,
        ].join('\n'))
        .setTimestamp()],
      components: [buildActionRow(backup.id, true)],
    });
  } catch {
    // Modal timed out or was dismissed
  }
}

async function handleList(interaction, guild, user, backups) {
  const guildBackups = Object.values(backups[guild.id])
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const { embed, totalPages, safePage } = buildBackupListEmbed(guild, guildBackups, 1);
  const navRow = buildNavRow(safePage, totalPages);

  await interaction.reply({
    embeds: [embed],
    components: navRow ? [navRow] : [],
    flags: MessageFlags.Ephemeral,
  });

  if (totalPages <= 1) return;

  const reply = await interaction.fetchReply();
  let currentPage = safePage;

  const collector = reply.createMessageComponentCollector({
    filter: (i) => i.user.id === user.id && ['backup_first', 'backup_prev', 'backup_next', 'backup_last'].includes(i.customId),
    time: LIST_COLLECTOR_TIMEOUT,
  });

  collector.on('collect', async (i) => {
    if (i.customId === 'backup_first') currentPage = 1;
    else if (i.customId === 'backup_prev') currentPage = Math.max(1, currentPage - 1);
    else if (i.customId === 'backup_next') currentPage = Math.min(totalPages, currentPage + 1);
    else if (i.customId === 'backup_last') currentPage = totalPages;

    const { embed: newEmbed, totalPages: tp, safePage: sp } = buildBackupListEmbed(guild, guildBackups, currentPage);
    const newNav = buildNavRow(sp, tp);
    await i.update({
      embeds: [newEmbed],
      components: newNav ? [newNav] : [],
    });
  });

  collector.on('end', async () => {
    try {
      const { embed: finalEmbed } = buildBackupListEmbed(guild, guildBackups, currentPage);
      await reply.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
    } catch { /* best effort cleanup */ }
  });
}

async function handleInfo(interaction, backup, backupId, { fromButton = false } = {}) {
  const embed = buildBackupEmbed(backup, interaction.guild, 1, 1);
  const isOwner = backup.createdBy === interaction.user.id;
  const components = [buildActionRow(backupId, isOwner)];

  if (fromButton) {
    return interaction.editReply({ embeds: [embed], components });
  }
  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

// ── Module Export ─────────────────────────────────────────────────────────────

module.exports = {
  name: 'backup',
  category: 'moderation',
  default_member_permissions: 'Administrator',
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Manage server backups')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a backup of server structure'))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all saved backups for this server'))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('View detailed information about a backup')
      .addStringOption(opt => opt.setName('id').setDescription('The backup ID').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('load')
      .setDescription('Load a backup and restore channels and roles')
      .addStringOption(opt => opt.setName('id').setDescription('The backup ID to load').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a saved backup')
      .addStringOption(opt => opt.setName('id').setDescription('The backup ID to delete').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 10,

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [errorEmbed('Guild Only', 'This command can only be used in a server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission to manage backups.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;
    const backups = readGuildBackups(guild.id);

    if (sub === 'create') return handleCreate(interaction, guild, user, backups);
    if (sub === 'list') return handleList(interaction, guild, user, backups);

    const backupId = interaction.options.getString('id')?.toUpperCase();
    const backup = backups[guild.id]?.[backupId];

    if (!backup) {
      return interaction.reply({
        embeds: [errorEmbed('Backup Not Found', [
          `No backup found with ID \`${backupId || 'UNKNOWN'}\`.`,
          '',
          'Use `/backup list` to see all backups.',
        ].join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'info') return handleInfo(interaction, backup, backupId);
    if (sub === 'load') return handleLoadFlow(interaction, backup, guild, user);
    if (sub === 'delete') return handleDeleteFlow(interaction, backup, backupId, guild, user, backups);
  },

  async handleButton(interaction, client) {
    const { guild, user } = interaction;

    // Defer immediately to prevent interaction timeout (3-second window).
    // After this, all responses must use editReply() instead of reply().
    await interaction.deferUpdate();

    let backups;
    try {
      backups = readGuildBackups(guild.id);
    } catch (err) {
      logger.error(`Backup button read error: ${err.message}`);
      return interaction.editReply({
        embeds: [errorEmbed('Error', 'Failed to read backup data.')],
        components: [],
      });
    }

    const parts = interaction.customId.split(':');
    const action = parts[0];
    const backupId = parts[1];
    const backup = backups[guild.id]?.[backupId];

    if (!backup) {
      return interaction.editReply({
        embeds: [errorEmbed('Backup Not Found', `No backup found with ID \`${backupId}\`.`)],
        components: [],
      });
    }

    try {
      if (action === 'backup_info') {
        return handleInfo(interaction, backup, backupId, { fromButton: true });
      }

      if (action === 'backup_load') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.editReply({
            embeds: [errorEmbed('Permission Denied', 'You need **Administrator** permission to restore backups.')],
            components: [buildActionRow(backupId, true)],
          });
        }
        return handleLoadFlow(interaction, backup, guild, user, { fromButton: true });
      }

      if (action === 'backup_delete') {
        if (backup.createdBy !== user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.editReply({
            embeds: [errorEmbed('Permission Denied', 'Only the backup creator or an Administrator can delete this backup.')],
            components: [buildActionRow(backupId, true)],
          });
        }
        return handleDeleteFlow(interaction, backup, backupId, guild, user, backups, { fromButton: true });
      }
    } catch (err) {
      logger.error(`Backup button handler error: ${err.message}`);
      try {
        await interaction.editReply({
          embeds: [errorEmbed('Error', 'An unexpected error occurred.')],
          components: [buildActionRow(backupId, true)],
        });
      } catch { /* interaction may have expired */ }
    }
  },
};
