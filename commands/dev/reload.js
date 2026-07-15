'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { logDevAction } = require('../../utils/devLogger');
const logger = require('../../utils/logger');

function deniedEmbed(client, userId) {
  return new EmbedBuilder()
    .setColor('#ED4245')
    .setAuthor({ name: '🔒  Developer Console  ·  Access Denied', iconURL: client.user.displayAvatarURL({ size: 64 }) })
    .setTitle('Unauthorized')
    .setDescription('This command is restricted to **bot owners** and **whitelisted developers** only.')
    .addFields(
      { name: '🔑 Required Access', value: 'Bot Owner or Whitelisted', inline: true },
      { name: '🆔 Your User ID', value: `\`${userId}\``, inline: true },
    )
    .setFooter({ text: 'Contact the bot owner if you believe this is an error.' })
    .setTimestamp();
}

module.exports = {
  name: "reload",
  category: "dev",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('[Dev] Full reload (commands/events/slash overwrite) without restarting the bot.'),

  async execute(interaction) {
    const { client, user } = interaction;

    if (!isOwner(user.id)) {
      await logDevAction({ interaction, command: 'dev reload', status: 'FAILED', details: 'Unauthorized access attempt', target: null });
      return interaction.reply({ embeds: [deniedEmbed(client, user.id)], flags: MessageFlags.Ephemeral });
    }

    const { reloadAll, buildEmbedFromResult } = require('../../utils/reloadManager');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await reloadAll(client).catch((err) => {
      logger.error(`[Reload] reloadAll failed: ${err?.message || err}`);
      return {
        status: 'FAILED',
        errors: [String(err?.stack || err?.message || err)].slice(0, 5000),
        okCounts: { commands: 0, events: 0 },
        failedCounts: { commands: -1, events: -1 },
        durationMs: 0,
      };
    });

    await logDevAction({
      interaction,
      command: 'dev reload',
      status: result.status,
      details: `reloadAll=${result.status} duration=${result.durationMs}ms errors=${(result.errors || []).length}`,
      target: null,
    }).catch(() => {});

    return interaction.editReply({ embeds: [buildEmbedFromResult(client, result)] });
  },
};

