'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOwner }       = require('../../utils/isOwner');

const { logDevAction }  = require('../../utils/devLogger');
const maintenance       = require('../../utils/maintenanceManager');
const logger            = require('../../utils/logger');
const config            = require('../../config.json');

function deniedEmbed(client, userId) {
  return new EmbedBuilder()
    .setColor('#ED4245')
    .setAuthor({ name: '🔒  Developer Console  ·  Access Denied', iconURL: client.user.displayAvatarURL({ size: 64 }) })
    .setTitle('Unauthorized')
    .setDescription('This command is restricted to **bot owners** only.')
    .addFields(
      { name: '🔑 Required Access', value: 'Bot Owner only', inline: true },
      { name: '🆔 Your User ID',    value: `\`${userId}\``,            inline: true },
    )
    .setFooter({ text: 'Contact the bot owner if you believe this is an error.' })
    .setTimestamp();
}

module.exports = {
  name: "maintenance",
  category: "dev",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('[Dev] Toggle or check maintenance mode.')
    .addSubcommand(s => s.setName('on').setDescription('Enable maintenance mode — blocks all non-owner commands.'))
    .addSubcommand(s => s.setName('off').setDescription('Disable maintenance mode — restore normal operation.'))
    .addSubcommand(s => s.setName('status').setDescription('Check the current maintenance mode status.')),

  async execute(interaction) {
    const { client, user } = interaction;

    if (!isOwner(user.id)) {
      await logDevAction({ interaction, command: 'dev maintenance', status: 'FAILED', details: 'Unauthorized access attempt', target: null });
      return interaction.reply({ embeds: [deniedEmbed(client, user.id)], flags: MessageFlags.Ephemeral });
    }

    const sub   = interaction.options.getSubcommand();
    const state = maintenance.getState();

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (sub === 'status') {
      const embed = new EmbedBuilder()
        .setColor(state.enabled ? '#ED4245' : '#57F287')
        .setAuthor({ name: '🛠️  Developer Console  ·  Maintenance Status', iconURL: client.user.displayAvatarURL({ size: 64 }) })
        .setTitle(state.enabled ? '🔴  Maintenance Mode is Active' : '🟢  Bot is Online')
        .addFields({ name: '📊 Status', value: state.enabled ? '🔴 **Active** — non-owner commands are blocked' : '🟢 **Inactive** — all commands are available', inline: false });

      if (state.enabled) {
        const enabledTs = state.enabledAt ? Math.floor(state.enabledAt / 1000) : null;
        if (state.enabledBy)  embed.addFields({ name: '👤 Enabled By',    value: state.enabledBy,                                         inline: true });
        if (enabledTs)        embed.addFields({ name: '🕐 Active Since',  value: `<t:${enabledTs}:F>\n<t:${enabledTs}:R>`,               inline: true });
        embed.setFooter({ text: 'Use /maintenance off to restore normal operation.' });
      } else {
        embed.setFooter({ text: 'Use /maintenance on to enable maintenance mode.' });
      }

      await logDevAction({ interaction, command: 'dev maintenance status', status: 'SUCCESS', details: `Status: ${state.enabled ? 'enabled' : 'disabled'}`, target: null });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── ON ────────────────────────────────────────────────────────────────────
    if (sub === 'on') {
      if (maintenance.isEnabled()) {
        const ts = state.enabledAt ? `<t:${Math.floor(state.enabledAt / 1000)}:R>` : 'unknown';
        await logDevAction({ interaction, command: 'dev maintenance on', status: 'FAILED', details: 'Already enabled', target: null });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setAuthor({ name: '🛠️  Developer Console  ·  Maintenance', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('⚠️  Already Active')
              .setDescription(`Maintenance mode is already enabled.\nEnabled by **${state.enabledBy ?? 'Unknown'}** ${ts}.`)
              .setFooter({ text: 'Use /maintenance off to disable it.' })
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      maintenance.enable(client, user);
      logger.info(`[Maintenance] Enabled by ${user.username} (${user.id})`);
      await logDevAction({ interaction, command: 'dev maintenance on', status: 'SUCCESS', details: 'Maintenance mode enabled', target: null });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#FEE75C')
            .setAuthor({ name: '🛠️  Developer Console  ·  Maintenance Enabled', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle('🔴  Maintenance Mode is Now Active')
            .setDescription(
              'The bot has entered maintenance mode.\n\n' +
              '> 🚫 Normal users and staff **cannot** use any commands.\n' +
              '> 👑 Bot owners can still use all commands.\n' +
              '> 🔴 Bot status changed to **Do Not Disturb**.\n' +
              '> 💾 State is saved — persists through restarts.'
            )
            .addFields(
              { name: '👤 Enabled By', value: `${user}  (\`${user.id}\`)`, inline: true },
              { name: '🕐 Activated',  value: `<t:${Math.floor(Date.now() / 1000)}:R>`,  inline: true },
            )
            .setFooter({ text: 'Use /maintenance off to restore normal operation.' })
            .setTimestamp(),
        ],
      });
    }

    // ── OFF ───────────────────────────────────────────────────────────────────
    if (sub === 'off') {
      if (!maintenance.isEnabled()) {
        await logDevAction({ interaction, command: 'dev maintenance off', status: 'FAILED', details: 'Not currently active', target: null });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setAuthor({ name: '🛠️  Developer Console  ·  Maintenance', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('⚠️  Not Active')
              .setDescription('Maintenance mode is not currently enabled.')
              .setFooter({ text: 'Use /maintenance on to enable it.' })
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const enabledTs = state.enabledAt ? `<t:${Math.floor(state.enabledAt / 1000)}:R>` : 'unknown';
      maintenance.disable(client);
      logger.info(`[Maintenance] Disabled by ${user.username} (${user.id})`);
      await logDevAction({ interaction, command: 'dev maintenance off', status: 'SUCCESS', details: 'Maintenance mode disabled', target: null });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#57F287')
            .setAuthor({ name: '🛠️  Developer Console  ·  Maintenance Disabled', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle('🟢  Bot is Back Online')
            .setDescription(
              'Maintenance mode has been disabled.\n\n' +
              '> ✅ All commands restored for users and staff.\n' +
              '> 🟢 Bot status restored to **Online**.\n' +
              '> 💾 State saved automatically.'
            )
            .addFields(
              { name: '👤 Disabled By',   value: `${user}  (\`${user.id}\`)`, inline: true },
              { name: '🕐 Was Active',    value: enabledTs,                    inline: true },
            )
            .setFooter({ text: 'Use /maintenance on to enable maintenance mode again.' })
            .setTimestamp(),
        ],
      });
    }
  },
};
