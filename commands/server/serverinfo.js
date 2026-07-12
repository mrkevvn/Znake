'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

const SEC_LABELS = ['None', 'Low — Email', 'Medium — 5m', 'High — 10m', 'Highest — Phone'];

const FILTER_LABELS = ['Disabled', 'Members without roles', 'All members'];

const TIER_LABELS = ['None', 'Tier 1', 'Tier 2', 'Tier 3'];

const BOOST_NEXT = { 0: 2, 1: 7, 2: 14, 3: 30 };

function progress(count, tier) {
  if (tier >= 3) return '``████████████████████`` **MAXED**';
  const target = BOOST_NEXT[tier];
  const fill = Math.round((count / target) * 16);
  return `\`${'█'.repeat(Math.min(fill, 16))}${'░'.repeat(Math.max(16 - fill, 0))}\` ${count}/${target}`;
}

module.exports = {
  name: "serverinfo",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('View detailed information about this server.'),
  cooldown: 10,

  async execute(interaction) {
    await interaction.deferReply();

    const { guild } = interaction;

    try {
      await guild.members.fetch();
    } catch {}
    let owner;
    try { owner = await guild.fetchOwner(); } catch { owner = null; }

    const members = guild.members.cache;
    const channels = guild.channels.cache;

    const bots = members.filter(m => m.user.bot).size;
    const humans = guild.memberCount - bots;

    const text = channels.filter(c => c.type === ChannelType.GuildText).size;
    const voice = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const cats = channels.filter(c => c.type === ChannelType.GuildCategory).size;
    const annc = channels.filter(c => c.type === ChannelType.GuildAnnouncement).size;
    const frms = channels.filter(c => c.type === ChannelType.GuildForum).size;
    const stgs = channels.filter(c => c.type === ChannelType.GuildStageVoice).size;

    const roles = guild.roles.cache.size - 1;
    const emojis = guild.emojis.cache.size;
    const stickers = guild.stickers?.cache?.size ?? 0;
    const boosts = guild.premiumSubscriptionCount || 0;

    const ownerName = owner?.user?.globalName || owner?.user?.username || 'Unknown';

    const tier = guild.premiumTier;

    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: guild.name, iconURL: guild.iconURL({ dynamic: true }) ?? undefined })
      .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
      .setDescription(`${guild.description ? `> *${guild.description}*\n\n` : ''}👑 **${ownerName}**　🆔 \`${guild.id}\`　🌍 ${guild.preferredLocale.toUpperCase()}\n📅 ${discordTimestamp(guild.createdAt, 'D')} (${discordTimestamp(guild.createdAt, 'R')})`)
      .addFields(
        {
          name: '👥 Members · 🏷️ Assets',
          value: `**Total:** ${guild.memberCount.toLocaleString()}　🧑 ${humans.toLocaleString()}　🤖 ${bots.toLocaleString()}\n**Roles:** ${roles}　**Emojis:** ${emojis}　**Stickers:** ${stickers}`,
        },
        {
          name: '📺 Channels',
          value: `**Text:** ${text}　**Voice:** ${voice}　**Forum:** ${frms}\n**Announce:** ${annc}　**Category:** ${cats}　**Stage:** ${stgs}`,
        },
        {
          name: '🛡️ Security · 🚀 Boosts',
          value: `**Verification:** ${SEC_LABELS[guild.verificationLevel] || guild.verificationLevel}\n**Content Filter:** ${FILTER_LABELS[guild.explicitContentFilter] || guild.explicitContentFilter}\n**${TIER_LABELS[tier] || tier}** — ${boosts} boost${boosts !== 1 ? 's' : ''}\n${progress(boosts, tier)}`,
        },
      )
      .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));

    await interaction.editReply({ embeds: [embed] });
  },
};

