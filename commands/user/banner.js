// /banner - Premium user banner command
'use strict';

const {
  MessageFlags,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const config = require('../../config.json');
const logger = require('../../utils/logger');

// Cache banner data briefly for performance.
const cache = new Map();
const CACHE_MS = 60_000;

function getFooterText() {
  // Keep it resilient if botName isn't in config.
  return `${config.botName || 'Bot'} • ${new Date().toLocaleString()}`;
}

function buildPremiumEmbed({ user, bannerType, bannerURL }) {
  const embedColor = user?.accentColor || config.embedColor || 0x5865f2;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Banner')
    .setThumbnail(user.displayAvatarURL({ size: 512 }))
    .addFields(
      { name: 'Username', value: `**${user.globalName || user.username}**`, inline: true },
      { name: 'Tag', value: `\t${user.tag}`, inline: true },
      {
        name: 'Banner Type',
        value: bannerType === 'GIF' ? 'GIF' : bannerType === 'PNG' ? 'PNG' : 'None',
        inline: false,
      },
    )
    .setFooter({ text: getFooterText() })
    .setTimestamp();

  if (bannerURL) embed.setImage(bannerURL);

  return embed;
}

function getBannerURLs(user, { size = 4096 } = {}) {
  // Animated banners are served via a .gif endpoint.
  // Animated banners typically have banner hash prefixed with 'a_'.
  const bannerHash = user.banner;
  const hasBanner = Boolean(bannerHash);
  if (!hasBanner) return { bannerURL: null, cdnURL: null, type: 'NONE' };

  const isAnimated = typeof bannerHash === 'string' && bannerHash.startsWith('a_');

  if (isAnimated) {
    // GIF animated banner
    const cdnURL = `https://cdn.discordapp.com/banners/${user.id}/${bannerHash}.gif?size=${size}`;
    return { bannerURL: cdnURL, cdnURL, type: 'GIF' };
  }

  // Static fallback: CDN accepts the hash at .png?size=...
  // Even if the user originally had JPG, Discord CDN will still provide a usable image.
  const cdnURL = `https://cdn.discordapp.com/banners/${user.id}/${bannerHash}.png?size=${size}`;
  return { bannerURL: cdnURL, cdnURL, type: 'PNG' };
}

async function fetchBannerData(user) {
  const cached = cache.get(user.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;

  // Fetch user so banner hash is available.
  await user.fetch().catch(() => null);

  if (!user.banner) {
    const none = {
      bannerURL: null,
      type: 'NONE',
      fetchedAt: Date.now(),
    };
    cache.set(user.id, none);
    return none;
  }

  const { bannerURL, type } = getBannerURLs(user, { size: 4096 });

  const result = { bannerURL, type, fetchedAt: Date.now() };
  cache.set(user.id, result);
  return result;
}

module.exports = {
  name: "banner",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('banner')
    .setDescription("View a user's profile banner")
    .addUserOption((opt) => opt.setName('user').setDescription('User to check (defaults to yourself)')),

  cooldown: 5,

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!targetUser?.id) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Error').setDescription('Invalid user provided.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const user = await interaction.client.users.fetch(targetUser.id).catch(() => null);
      if (!user) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Error').setDescription('Could not fetch that user.')],
        });
      }

      const { bannerURL, type } = await fetchBannerData(user);

      if (!bannerURL || type === 'NONE') {
        const embed = new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('👤 User Banner')
          .setThumbnail(user.displayAvatarURL({ size: 512 }))
          .setDescription('This user has no banner set.')
          .setFooter({ text: getFooterText() })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`banner_open:${user.id}:none`).setLabel('🖼️ Open Banner').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId(`banner_refresh:${user.id}:none`).setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`banner_download:${user.id}:none`).setLabel('📥 Download').setStyle(ButtonStyle.Primary).setDisabled(true),
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      const embed = buildPremiumEmbed({ user, bannerType: type, bannerURL });

      const openBtn = new ButtonBuilder()
        .setCustomId(`banner_open:${user.id}:${type}`)
        .setLabel('🖼️ Open Banner')
        .setStyle(ButtonStyle.Link)
        .setURL(bannerURL);

      const refreshBtn = new ButtonBuilder()
        .setCustomId(`banner_refresh:${user.id}:${Date.now()}`)
        .setLabel('🔄 Refresh')
        .setStyle(ButtonStyle.Secondary);

      const downloadBtn = new ButtonBuilder()
        .setCustomId(`banner_download:${user.id}:${type}:${Date.now()}`)
        .setLabel('📥 Download')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(openBtn, refreshBtn, downloadBtn);

      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      logger.error(`Banner command error: ${err?.message}`);
      logger.error(err?.stack);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Unable to fetch banner')
            .setDescription('An error occurred while fetching the banner. Please try again later.'),
        ],
      }).catch(() => null);
    }
  },
};

// Optional: button handler helper. If your project doesn't route these customIds elsewhere,
// you may need to add a small handler in events/interactionCreate.js.
module.exports.handleButton = async function handleButton(interaction, client) {
  if (!interaction.isButton() || !interaction.customId.startsWith('banner_')) return;

  const parts = interaction.customId.split(':');
  const action = parts[0];
  const userId = parts[1];

  try {
    const target = await client.users.fetch(userId).catch(() => null);
    if (!target) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Error').setDescription('Could not fetch that user.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'banner_open') {
      const { bannerURL } = await fetchBannerData(target);
      if (!bannerURL) {
        return interaction.reply({ content: 'This user has no banner set.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: bannerURL, flags: MessageFlags.Ephemeral });
    }

    if (action === 'banner_refresh') {
      cache.delete(target.id);
      const { bannerURL, type } = await fetchBannerData(target);

      if (!bannerURL || type === 'NONE') {
        const embed = new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('👤 User Banner')
          .setThumbnail(target.displayAvatarURL({ size: 512 }))
          .setDescription('This user has no banner set.')
          .setFooter({ text: getFooterText() })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`banner_open:${target.id}:none`).setLabel('🖼️ Open Banner').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId(`banner_refresh:${target.id}:${Date.now()}`).setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`banner_download:${target.id}:none`).setLabel('📥 Download').setStyle(ButtonStyle.Primary).setDisabled(true),
        );

        return interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
      }

      const embed = buildPremiumEmbed({ user: target, bannerType: type, bannerURL });

      const openBtn = new ButtonBuilder()
        .setCustomId(`banner_open:${target.id}:${type}`)
        .setLabel('🖼️ Open Banner')
        .setStyle(ButtonStyle.Link)
        .setURL(bannerURL);

      const refreshBtn = new ButtonBuilder()
        .setCustomId(`banner_refresh:${target.id}:${Date.now()}`)
        .setLabel('🔄 Refresh')
        .setStyle(ButtonStyle.Secondary);

      const downloadBtn = new ButtonBuilder()
        .setCustomId(`banner_download:${target.id}:${type}:${Date.now()}`)
        .setLabel('📥 Download')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(openBtn, refreshBtn, downloadBtn);

      return interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    }

    if (action === 'banner_download') {
      const { bannerURL } = await fetchBannerData(target);
      if (!bannerURL) return interaction.reply({ content: 'This user has no banner set.', flags: MessageFlags.Ephemeral });

      // Direct link (Discord renders it reliably). Attachment fallback can be added later.
      return interaction.reply({
        content: `Here is the banner link:\n${bannerURL}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    logger.error(`Banner button error: ${err?.message}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Failed').setDescription('Could not process that banner action.')],
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
  }
};

