'use strict';

const {
  MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType,
} = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config.json');

const ITEMS_PER_PAGE = 5;

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
    .setColor('#5865F2')
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
    .setColor('#5865F2')
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
      name: `${b.name}`,
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

function buildNavRow(page, totalPages, backupId) {
  const row = new ActionRowBuilder();

  if (totalPages > 1) {
    const first = new ButtonBuilder()
      .setCustomId(`backup_first:${backupId || ''}`)
      .setLabel('<<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1);
    const prev = new ButtonBuilder()
      .setCustomId(`backup_prev:${backupId || ''}`)
      .setLabel('<')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 1);
    const next = new ButtonBuilder()
      .setCustomId(`backup_next:${backupId || ''}`)
      .setLabel('>')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages);
    const last = new ButtonBuilder()
      .setCustomId(`backup_last:${backupId || ''}`)
      .setLabel('>>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages);

    row.addComponents(first, prev, next, last);
  }

  return row;
}

function buildBackupActionRow(backupId, canDelete) {
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

async function createBackup(guild, name, description, userId) {
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
      name: r.name,
      color: r.hexColor,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position,
      icon: r.icon || null,
      unicodeEmoji: r.unicodeEmoji || null,
    }));

  const backupId = generateBackupId();

  return {
    id: backupId,
    name,
    description: description || null,
    createdBy: userId,
    createdAt: Date.now(),
    memberCount: guild.memberCount,
    channels,
    roles,
  };
}

function generateBackupId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function loadBackup(guild, backup, interaction) {
  let rolesCreated = 0;
  let channelsCreated = 0;
  let errors = 0;

  const statusMsg = await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('Loading Backup')
      .setDescription('Starting restore process...\n\u200b\n\u200b')
      .setTimestamp()],
  });

  const status = (step, current, total, label) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    statusMsg.edit({
      embeds: [new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('Loading Backup')
        .setDescription([
          `**Step:** ${step}`,
          `**Progress:** ${current}/${total}`,
          `\`${bar}\` ${pct}%`,
          '',
          `Roles created: ${rolesCreated}`,
          `Channels created: ${channelsCreated}`,
          `Errors: ${errors}`,
        ].join('\n'))
        .setTimestamp()],
    }).catch(() => { });
  };

  const sortRoles = [...(backup.roles || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  const totalRoles = sortRoles.length;

  for (let i = 0; i < sortRoles.length; i++) {
    const rd = sortRoles[i];
    try {
      await guild.roles.create({
        name: `[R] ${rd.name}`,
        color: rd.color || '#000000',
        hoist: rd.hoist || false,
        mentionable: rd.mentionable || false,
        permissions: BigInt(rd.permissions || '0'),
        icon: rd.icon || null,
        unicodeEmoji: rd.unicodeEmoji || null,
        reason: `Backup restore: ${backup.id}`,
      });
      rolesCreated++;
    } catch {
      errors++;
    }
    if ((i + 1) % 3 === 0 || i === sortRoles.length - 1) {
      status('Restoring roles...', i + 1, totalRoles, 'Roles');
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
    status('Restoring categories...', chDone, totalCh, 'Categories');
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
            const target = ov.type === 0 ? guild.roles.cache.get(ov.id) : guild.members.cache.get(ov.id);
            if (target) {
              await created.permissionOverwrites.create(target, {
                allow: BigInt(ov.allow || '0'),
                deny: BigInt(ov.deny || '0'),
              });
            }
          } catch { }
        }
      }

      channelsCreated++;
    } catch {
      errors++;
    }
    chDone++;
    status('Restoring channels...', chDone, totalCh, 'Channels');
  }

  return { rolesCreated, channelsCreated, errors };
}

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
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('Permission Denied')
          .setDescription('You need **Administrator** permission to manage backups.')
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;
    const backups = db.read('backups');
    if (!backups[guild.id]) backups[guild.id] = {};

    if (sub === 'create') {
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
          time: 600000,
          filter: (i) => i.customId === 'backup_create_modal' && i.user.id === user.id,
        });

        const name = submitted.fields.getTextInputValue('backup_name')?.trim();
        const description = submitted.fields.getTextInputValue('backup_description')?.trim() || null;

        if (!name) {
          return submitted.reply({ content: 'Backup name is required.', flags: MessageFlags.Ephemeral });
        }

        await submitted.deferReply({ flags: MessageFlags.Ephemeral });

        const backup = await createBackup(guild, name, description, user.id);
        backups[guild.id][backup.id] = backup;
        db.write('backups', backups);

        const size = formatBytes(estimateBackupSize(backup));
        const embed = buildBackupEmbed(backup, guild, 1, 1);

        return submitted.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#57F287')
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
          components: [buildBackupActionRow(backup.id, true)],
        });
      } catch {
        return;
      }
    }

    if (sub === 'list') {
      const guildBackups = Object.values(backups[guild.id]).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const { embed, totalPages, safePage } = buildBackupListEmbed(guild, guildBackups, 1);
      const navRow = buildNavRow(1, totalPages, '');
      const components = navRow.components.length > 0 ? [navRow] : [];

      await interaction.reply({
        embeds: [embed],
        components,
        flags: MessageFlags.Ephemeral,
      });
      const reply = await interaction.fetchReply();

      if (totalPages <= 1) return;

      const navActions = ['first', 'prev', 'next', 'last'];
      const collector = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === user.id && navActions.some(a => i.customId.startsWith(`backup_${a}:`)),
        time: 120000,
      });

      let currentPage = 1;

      collector.on('collect', async (i) => {
        const action = i.customId.split(':')[0].replace('backup_', '');
        if (action === 'first') currentPage = 1;
        else if (action === 'prev') currentPage = Math.max(1, currentPage - 1);
        else if (action === 'next') currentPage = Math.min(totalPages, currentPage + 1);
        else if (action === 'last') currentPage = totalPages;
        else return;

        const { embed: newEmbed, totalPages: tp, safePage: sp } = buildBackupListEmbed(guild, guildBackups, currentPage);
        const newNav = buildNavRow(sp, tp, '');
        await i.update({ embeds: [newEmbed], components: newNav.components.length > 0 ? [newNav] : [] });
      });

      return;
    }

    if (sub === 'info') {
      const backupId = interaction.options.getString('id').toUpperCase();
      const backup = backups[guild.id][backupId];

      if (!backup) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('Backup Not Found')
            .setDescription([
              `No backup found with ID \`${backupId}\`.`,
              '',
              'Use `/backup list` to see all backups.',
            ].join('\n'))
            .setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = buildBackupEmbed(backup, guild, 1, 1);
      const isOwner = backup.createdBy === user.id;

      return interaction.reply({
        embeds: [embed],
        components: [buildBackupActionRow(backupId, isOwner)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'load') {
      const backupId = interaction.options.getString('id').toUpperCase();
      const backup = backups[guild.id][backupId];

      if (!backup) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('Backup Not Found')
            .setDescription([
              `No backup found with ID \`${backupId}\`.`,
              '',
              'Use `/backup list` to see all backups.',
            ].join('\n'))
            .setTimestamp()],
          flags: MessageFlags.Ephemeral,
        });
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`backup_confirm_load:${backupId}`)
          .setLabel('Confirm Restore')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⚠️'),
        new ButtonBuilder()
          .setCustomId(`backup_cancel_load:${backupId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor('#FEE75C')
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
          .setTimestamp()],
        components: [confirmRow],
        flags: MessageFlags.Ephemeral,
      });

      try {
        const confirmation = await interaction.awaitMessageComponent({
          filter: (i) => i.user.id === user.id && (i.customId.startsWith('backup_confirm_load:') || i.customId.startsWith('backup_cancel_load:')),
          time: 30000,
        });

        if (confirmation.customId.startsWith('backup_cancel_load')) {
          return confirmation.update({
            embeds: [new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('Restore Cancelled')
              .setDescription('Backup restore has been cancelled.')
              .setTimestamp()],
            components: [],
          });
        }

        await confirmation.deferUpdate();

        const result = await loadBackup(guild, backup, confirmation);

        return confirmation.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('Backup Restored')
            .setDescription([
              `**${backup.name}** has been restored.`,
              '',
              `Roles created: **${result.rolesCreated}**`,
              `Channels created: **${result.channelsCreated}**`,
              result.errors > 0 ? `Errors: **${result.errors}**` : '',
            ].filter(Boolean).join('\n'))
            .setTimestamp()],
          components: [],
        });
      } catch {
        try {
          await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(config.warningColor)
              .setTitle('Timed Out')
              .setDescription('Confirmation timed out. Run `/backup load` again.')
              .setTimestamp()],
            components: [],
          });
        } catch { }
        return;
      }
    }

    if (sub === 'delete') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (err) {
        console.error('Failed to defer reply:', err);
        return;
      }

      const backupId = interaction.options.getString('id')?.toUpperCase();
      const backup = backups[guild.id]?.[backupId];

      if (!backup) {
        try {
          return await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('Backup Not Found')
              .setDescription([
                `No backup found with ID \`${backupId || 'UNKNOWN'}\`.`,
                '',
                'Use `/backup list` to see all backups.',
              ].join('\n'))
              .setTimestamp()],
          });
        } catch (err) {
          console.error('Failed to reply for missing backup:', err);
          return;
        }
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`backup_confirm_delete:${backupId}`)
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️'),
        new ButtonBuilder()
          .setCustomId(`backup_cancel_delete:${backupId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      let message;
      try {
        message = await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#ED4245')
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
            .setTimestamp()],
          components: [confirmRow],
        });
      } catch (err) {
        console.error('Failed to send deletion confirmation:', err);
        return;
      }

      try {
        const confirmation = await message.awaitMessageComponent({
          filter: (i) => i.user.id === user.id && (i.customId.startsWith('backup_confirm_delete:') || i.customId.startsWith('backup_cancel_delete:')),
          time: 30000,
        });

        if (confirmation.customId.startsWith('backup_cancel_delete')) {
          return await confirmation.update({
            embeds: [new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('Deletion Cancelled')
              .setDescription('Backup was not deleted.')
              .setTimestamp()],
            components: [],
          });
        }

        // Async deletion and proper await
        await new Promise((resolve, reject) => {
          try {
            delete backups[guild.id][backupId];
            const success = db.write('backups', backups);
            if (!success) {
              throw new Error('Database write failed');
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        return await confirmation.update({
          embeds: [new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('Backup Deleted')
            .setDescription(`**${backup.name}** (\`${backupId}\`) has been deleted.`)
            .setTimestamp()],
          components: [],
        });
      } catch (err) {
        try {
          await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(config.warningColor)
              .setTitle('Deletion Cancelled or Timed Out')
              .setDescription(err.message === 'Database write failed' ? 'Failed to delete backup due to a database write error.' : 'Confirmation timed out or an error occurred. Run `/backup delete` again.')
              .setTimestamp()],
            components: [],
          });
        } catch (replyErr) {
          console.error('Failed to send error reply:', replyErr);
        }
        return;
      }
    }
  },
};
