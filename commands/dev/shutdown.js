'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');

const db = require('../../utils/database');
const logger = require('../../utils/logger');
const config = require('../../config.json');
const { logDevAction } = require('../../utils/devLogger');
const { safeShutdown } = require('../../utils/restartManager');

const EXECUTING = new Set();

const DB_NAMES = [
  'warnings', 'staff_roles', 'log_channels', 'tickets', 'ticket_config',
  'ticket_counter', 'giveaways', 'polls', 'welcome',
  'autorole', 'security', 'suggestions', 'reports', 'message_logs',
  'backups', 'config', 'embed_store', 'maintenance',
];

module.exports = {
  name: 'shutdown',
  category: 'dev',
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('shutdown')
    .setDescription('[Dev] Safely shut down the bot process.'),

  async execute(interaction) {
    const { client, user } = interaction;

    if (!isOwner(user.id)) {
      await logDevAction({ interaction, command: 'dev shutdown', status: 'FAILED', details: 'Unauthorized access attempt', target: null });
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.errorColor || '#ED4245')
          .setAuthor({ name: '🔒  Developer Console  ·  Access Denied', iconURL: client.user.displayAvatarURL({ size: 64 }) })
          .setTitle('Unauthorized')
          .setDescription('This command is restricted to **bot owners** only.')
          .addFields(
            { name: '🔑 Required', value: 'Bot Owner only', inline: true },
            { name: '🆔 Your ID', value: `\`${user.id}\``, inline: true },
          )
          .setFooter({ text: 'Contact the bot owner if you believe this is an error.' })
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (EXECUTING.has('shutdown')) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor || '#FEE75C')
          .setTitle('⚠️ Already Shutting Down')
          .setDescription('A shutdown is already in progress. Please wait.')
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }
    EXECUTING.add('shutdown');

    try {
      await interaction.deferReply();

      const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const guilds = client.guilds.cache.size;
      const uptime = Math.floor((client.uptime ?? 0) / 1000);
      const nodeVer = process.version;
      const botTag = client.user.tag;

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#ED4245')
          .setAuthor({ name: '🧹  Developer Console  ·  Shutdown', iconURL: client.user.displayAvatarURL({ size: 64 }) })
          .setTitle('Shutdown Initiated')
          .setDescription('Bot is shutting down safely...')
          .addFields(
            { name: '🛑 Status', value: 'Shutting down...', inline: true },
            { name: '🏠 Guilds', value: `**${guilds}**`, inline: true },
            { name: '💾 Memory', value: `**${memMB} MB**`, inline: true },
            { name: '⏱️ Uptime', value: `**${uptime}s**`, inline: true },
            { name: '🔖 Version', value: `**v${config.version ?? '1.0.0'}**`, inline: true },
            { name: '👤 Requested By', value: `${user} (\`${user.id}\`)`, inline: false },
          )
          .setFooter({ text: `${botTag} · Node ${nodeVer} · Shutting down` })
          .setTimestamp()],
      });

      await logDevAction({
        interaction,
        command: 'dev shutdown',
        status: 'SUCCESS',
        details: `Shutdown initiated — uptime ${uptime}s, memory ${memMB} MB`,
        target: null,
      });

      logger.info(`[Shutdown] Initiated by ${user.username} (${user.id})`);

      // Give Discord time to process the embed before we disconnect
      await new Promise(resolve => setTimeout(resolve, 1500));

      logger.info('[Shutdown] Flushing databases...');
      for (const name of DB_NAMES) {
        try { db.write(name, db.read(name)); } catch (e) {
          logger.info(`[Shutdown] DB flush skipped for "${name}": ${e.message}`);
        }
      }

      await safeShutdown(client);

      logger.info('[Shutdown] Process exiting. Goodbye.');
    } catch (err) {
      logger.info(`[Shutdown] Expected shutdown notice: ${err?.message || err}`);
    }

    EXECUTING.delete('shutdown');
    process.exitCode = 0;
    process.exit(0);
  },
};
