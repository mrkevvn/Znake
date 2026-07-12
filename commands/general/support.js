'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const config = require('../../config.json');

function normalizeLink(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length ? v : null;
}

function getSupportLinks() {
  const website = normalizeLink(config.website);
  const invite = normalizeLink(config.inviteLink);
  const discord = normalizeLink(config.supportServer);

  return { website, invite, discord };
}

module.exports = {
  name: "support",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Get help, report issues, and contact the support team.'),

  cooldown: 3,

  async execute(interaction) {
    try {
      const links = getSupportLinks();

      const embed = new EmbedBuilder()
        .setColor(config.infoColor || '#5865F2')
        .setTitle('🛡️ Support Center')
        .setDescription('Follow the steps below to get fast, accurate help.')
        .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: '📌 Start Here',
            value: [
              '`/help` — browse all commands',
              'Check permissions for the bot and your roles',
              'Copy the exact error text (if any)',
            ].join('\n'),
            inline: false,
          },
          {
            name: '🧾 Include These Details',
            value: [
              'Server name + approximate time',
              'The command you ran',
              'Channel name (if applicable)',
              'Screenshots/logs (if the issue is visual)',
            ].join('\n'),
            inline: false,
          },
          {
            name: '📨 Contact',
            value: 'Use the buttons below to reach support.',
            inline: false,
          }
        )
        .setFooter({
          text: `Requested by ${interaction.user.username} • ${interaction.client.user.tag}`,
          iconURL: interaction.client.user.displayAvatarURL({ size: 64 }),
        })
        .setTimestamp();

      const row = new ActionRowBuilder();
      const buttons = [];

      if (links.discord) {
        buttons.push(
          new ButtonBuilder()
            .setLabel('Discord Support Server')
            .setStyle(ButtonStyle.Link)
            .setURL(links.discord)
        );
      }

      if (links.website) {
        buttons.push(
          new ButtonBuilder()
            .setLabel('Website')
            .setStyle(ButtonStyle.Link)
            .setURL(links.website)
        );
      }

      if (links.invite) {
        buttons.push(
          new ButtonBuilder()
            .setLabel('Bot Invite')
            .setStyle(ButtonStyle.Link)
            .setURL(links.invite)
        );
      }

      for (const b of buttons.slice(0, 5)) row.addComponents(b);

      return interaction.reply({
        embeds: [embed],
        components: row.components.length ? [row] : [],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      const msg = err?.message || String(err);
      const errorEmbed = new EmbedBuilder()
        .setColor(config.errorColor || '#ED4245')
        .setTitle('⛔ Support Request Failed')
        .setDescription('Something went wrong while generating the support message.')
        .addFields({ name: 'Details', value: `\`${msg}\`` })
        .setTimestamp();

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ embeds: [errorEmbed], components: [] }).catch(() => {});
      }

      return interaction.reply({
        embeds: [errorEmbed],
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

