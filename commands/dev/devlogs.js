'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');

const { logDevAction } = require('../../utils/devLogger');
const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

const LOG_FILE = path.join(__dirname, '../../data/devlogs.json');

async function readLogs() {
  try {
    const raw = await fs.promises.readFile(LOG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

async function writeLogs(logs) {
  await fs.promises.writeFile(LOG_FILE, JSON.stringify({ logs }, null, 2), 'utf8');
}

function formatEntry(entry, index) {
  const ts = `<t:${Math.floor(new Date(entry.timestamp).getTime() / 1000)}:R>`;
  const statusIcon = entry.status === 'SUCCESS' ? '✅' : '❌';
  const target = entry.target ? ` → \`${entry.target}\`` : '';
  return `**${index}.** ${statusIcon} \`${entry.command}\`${target}\n👤 <@${entry.userId}> (${entry.username}) • ${ts}\n📝 ${entry.details}`;
}

module.exports = {
  name: "devlogs",
  category: "dev",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('devlogs')
    .setDescription('[Dev only] View, filter, or clear developer command logs.')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View the most recent dev command logs.')
        .addIntegerOption(opt =>
          opt.setName('limit')
            .setDescription('Number of entries to show (default 10, max 25)')
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('filter')
        .setDescription('Filter logs by user, status, or command.')
        .addStringOption(opt =>
          opt.setName('status')
            .setDescription('Filter by outcome')
            .addChoices(
              { name: 'SUCCESS', value: 'SUCCESS' },
              { name: 'FAILED', value: 'FAILED' }
            )
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('userid')
            .setDescription('Filter by Discord user ID')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('command')
            .setDescription('Filter by command name (partial match)')
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName('limit')
            .setDescription('Number of results to show (default 10, max 25)')
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('Show a summary of dev command usage statistics.')
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear all dev command logs permanently.')
    )
    .addSubcommand(sub =>
      sub.setName('export')
        .setDescription('Download the full dev log as a .json file attachment.')
    )
    .addSubcommand(sub =>
      sub.setName('search')
        .setDescription('Search log entries by keyword across command and details fields.')
        .addStringOption(opt =>
          opt.setName('keyword')
            .setDescription('Word or phrase to search for')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('limit')
            .setDescription('Number of results to show (default 10, max 25)')
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      await logDevAction({
        interaction,
        command: 'dev devlogs',
        status: 'FAILED',
        details: 'User not authorized for dev commands',
        target: null,
      });
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('⛔ Access Denied')
            .setDescription('You do not have permission to use developer commands.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── VIEW ─────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const limit = interaction.options.getInteger('limit') ?? 10;
      const logs = await readLogs();

      await logDevAction({
        interaction,
        command: 'dev devlogs view',
        status: 'SUCCESS',
        details: `Viewed last ${limit} log entries (total: ${logs.length})`,
        target: null,
      });

      if (logs.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('📋 Dev Logs')
              .setDescription('No dev command logs recorded yet.')
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
        });
      }

      const recent = logs.slice(-limit).reverse();
      const lines = recent.map((e, i) => formatEntry(e, i + 1));

      const embed = new EmbedBuilder()
        .setColor(config.infoColor)
        .setTitle('📋 Dev Command Logs')
        .setDescription(lines.join('\n\n'))
        .addFields({ name: 'Total Logs', value: `${logs.length}`, inline: true })
        .setFooter({ text: `Showing ${recent.length} of ${logs.length} entries • Developer System` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── FILTER ───────────────────────────────────────────────────────────────
    if (sub === 'filter') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const statusFilter = interaction.options.getString('status');
      const userFilter = interaction.options.getString('userid');
      const commandFilter = interaction.options.getString('command')?.toLowerCase();
      const limit = interaction.options.getInteger('limit') ?? 10;

      const logs = await readLogs();

      let filtered = logs;
      if (statusFilter) filtered = filtered.filter(e => e.status === statusFilter);
      if (userFilter) filtered = filtered.filter(e => e.userId === userFilter.trim());
      if (commandFilter) filtered = filtered.filter(e => e.command.toLowerCase().includes(commandFilter));

      const filterDesc = [
        statusFilter && `status: **${statusFilter}**`,
        userFilter && `user: <@${userFilter.trim()}>`,
        commandFilter && `command contains: \`${commandFilter}\``,
      ].filter(Boolean).join(', ') || 'none';

      await logDevAction({
        interaction,
        command: 'dev devlogs filter',
        status: 'SUCCESS',
        details: `Filtered logs — ${filtered.length} results (filters: ${filterDesc})`,
        target: userFilter ?? null,
      });

      if (filtered.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.warningColor)
              .setTitle('🔍 Dev Logs — Filter')
              .setDescription(`No logs match the applied filters.\n**Filters:** ${filterDesc}`)
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
        });
      }

      const shown = filtered.slice(-limit).reverse();
      const lines = shown.map((e, i) => formatEntry(e, i + 1));

      const embed = new EmbedBuilder()
        .setColor(config.infoColor)
        .setTitle('🔍 Dev Logs — Filtered')
        .setDescription(lines.join('\n\n'))
        .addFields(
          { name: 'Filters', value: filterDesc, inline: false },
          { name: 'Matches', value: `${filtered.length}`, inline: true },
          { name: 'Showing', value: `${shown.length}`, inline: true },
        )
        .setFooter({ text: 'Developer System' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── STATS ────────────────────────────────────────────────────────────────
    if (sub === 'stats') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const logs = await readLogs();

      await logDevAction({
        interaction,
        command: 'dev devlogs stats',
        status: 'SUCCESS',
        details: `Viewed dev log statistics (total: ${logs.length})`,
        target: null,
      });

      if (logs.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('📊 Dev Log Statistics')
              .setDescription('No logs recorded yet.')
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
        });
      }

      const total = logs.length;
      const successes = logs.filter(e => e.status === 'SUCCESS').length;
      const failures = logs.filter(e => e.status === 'FAILED').length;

      const commandCounts = {};
      for (const e of logs) {
        commandCounts[e.command] = (commandCounts[e.command] || 0) + 1;
      }
      const topCommands = Object.entries(commandCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cmd, count]) => `\`${cmd}\` — ${count} use${count !== 1 ? 's' : ''}`)
        .join('\n');

      const userCounts = {};
      for (const e of logs) {
        userCounts[e.userId] = (userCounts[e.userId] || 0) + 1;
      }
      const topUsers = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([uid, count]) => `<@${uid}> — ${count} action${count !== 1 ? 's' : ''}`)
        .join('\n');

      const oldest = logs[0];
      const newest = logs[logs.length - 1];

      const embed = new EmbedBuilder()
        .setColor(config.infoColor)
        .setTitle('📊 Dev Log Statistics')
        .addFields(
          { name: '📦 Total Entries', value: `${total}`, inline: true },
          { name: '✅ Successful', value: `${successes}`, inline: true },
          { name: '❌ Failed', value: `${failures}`, inline: true },
          { name: '🏆 Top Commands', value: topCommands || 'N/A', inline: false },
          { name: '👤 Most Active', value: topUsers || 'N/A', inline: false },
          { name: '🕐 Oldest Entry', value: `<t:${Math.floor(new Date(oldest.timestamp).getTime() / 1000)}:F>`, inline: true },
          { name: '🕐 Newest Entry', value: `<t:${Math.floor(new Date(newest.timestamp).getTime() / 1000)}:F>`, inline: true },
        )
        .setFooter({ text: 'Developer System' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── CLEAR ────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const logs = await readLogs();
      const count = logs.length;

      if (count === 0) {
        await logDevAction({
          interaction,
          command: 'dev devlogs clear',
          status: 'FAILED',
          details: 'Logs were already empty',
          target: null,
        });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('📋 Logs Already Empty')
              .setDescription('There are no dev logs to clear.')
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('devlogs_clear_confirm')
          .setLabel(`Yes, delete all ${count} log${count !== 1 ? 's' : ''}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('devlogs_clear_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('⚠️ Confirm Log Clear')
            .setDescription(`You are about to permanently delete **${count} log entr${count !== 1 ? 'ies' : 'y'}**.\n\nThis cannot be undone. Are you sure?`)
            .setFooter({ text: 'Developer System • This prompt expires in 30 seconds' })
            .setTimestamp(),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });

      const filter = i => i.user.id === interaction.user.id &&
        ['devlogs_clear_confirm', 'devlogs_clear_cancel'].includes(i.customId);

      let btn;
      try {
        btn = await interaction.channel.awaitMessageComponent({ filter, time: 30_000 });
      } catch {
        await logDevAction({
          interaction,
          command: 'dev devlogs clear',
          status: 'FAILED',
          details: 'Confirmation timed out — no action taken',
          target: null,
        });
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('⏱️ Timed Out')
              .setDescription('Log clear cancelled — no response within 30 seconds.')
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
          components: [],
        });
      }

      if (btn.customId === 'devlogs_clear_cancel') {
        await logDevAction({
          interaction,
          command: 'dev devlogs clear',
          status: 'FAILED',
          details: 'Cancelled by user — no action taken',
          target: null,
        });
        return btn.update({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('🚫 Cancelled')
              .setDescription('Log clear was cancelled. No changes were made.')
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
          components: [],
        });
      }

      await writeLogs([]);

      await logDevAction({
        interaction,
        command: 'dev devlogs clear',
        status: 'SUCCESS',
        details: `Cleared ${count} dev log entr${count !== 1 ? 'ies' : 'y'}`,
        target: null,
      });

      return btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('🗑️ Logs Cleared')
            .setDescription(`Successfully deleted **${count} log entr${count !== 1 ? 'ies' : 'y'}** from the dev log.`)
            .setFooter({ text: 'Developer System' })
            .setTimestamp(),
        ],
        components: [],
      });
    }

    // ── SEARCH ───────────────────────────────────────────────────────────────
    if (sub === 'search') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const keyword = interaction.options.getString('keyword').toLowerCase();
      const limit = interaction.options.getInteger('limit') ?? 10;
      const logs = await readLogs();

      const matches = logs.filter(e =>
        e.command.toLowerCase().includes(keyword) ||
        (e.details && e.details.toLowerCase().includes(keyword)) ||
        (e.username && e.username.toLowerCase().includes(keyword))
      );

      await logDevAction({
        interaction,
        command: 'dev devlogs search',
        status: 'SUCCESS',
        details: `Searched logs for "${keyword}" — ${matches.length} match${matches.length !== 1 ? 'es' : ''} found`,
        target: null,
      });

      if (matches.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.warningColor)
              .setTitle('🔎 No Results')
              .setDescription(`No log entries matched the keyword **\`${keyword}\`**.`)
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
        });
      }

      const shown = matches.slice(-limit).reverse();
      const lines = shown.map((e, i) => formatEntry(e, i + 1));

      const embed = new EmbedBuilder()
        .setColor(config.infoColor)
        .setTitle('🔎 Dev Log Search Results')
        .setDescription(lines.join('\n\n'))
        .addFields(
          { name: '🔑 Keyword', value: `\`${keyword}\``, inline: true },
          { name: '📦 Matches', value: `${matches.length}`, inline: true },
          { name: '👁️ Showing', value: `${shown.length}`, inline: true },
        )
        .setFooter({ text: 'Searched: command • details • username • Developer System' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── EXPORT ───────────────────────────────────────────────────────────────
    if (sub === 'export') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const logs = await readLogs();

      if (logs.length === 0) {
        await logDevAction({
          interaction,
          command: 'dev devlogs export',
          status: 'FAILED',
          details: 'No logs to export — log file is empty',
          target: null,
        });
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('📋 Nothing to Export')
              .setDescription('There are no dev logs recorded yet.')
              .setFooter({ text: 'Developer System' })
              .setTimestamp(),
          ],
        });
      }

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: {
          userId: interaction.user.id,
          username: interaction.user.username,
        },
        totalEntries: logs.length,
        logs,
      };

      const fileName = `devlogs-${new Date().toISOString().slice(0, 10)}.json`;
      const buffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf8');
      const attachment = new AttachmentBuilder(buffer, { name: fileName });

      await logDevAction({
        interaction,
        command: 'dev devlogs export',
        status: 'SUCCESS',
        details: `Exported ${logs.length} log entr${logs.length !== 1 ? 'ies' : 'y'} as ${fileName}`,
        target: null,
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('📤 Dev Logs Exported')
            .addFields(
              { name: '📦 Entries', value: `${logs.length}`, inline: true },
              { name: '📄 File', value: `\`${fileName}\``, inline: true },
              { name: '👤 Exported by', value: `${interaction.user}`, inline: false },
            )
            .setFooter({ text: 'Developer System' })
            .setTimestamp(),
        ],
        files: [attachment],
      });
    }
  },
};
