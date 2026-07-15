'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

const TYPE_META = {
  [ChannelType.GuildText]:         { label: 'Text Channel',          icon: '#️⃣' },
  [ChannelType.GuildVoice]:        { label: 'Voice Channel',         icon: '🔊' },
  [ChannelType.GuildCategory]:     { label: 'Category',              icon: '📁' },
  [ChannelType.GuildAnnouncement]: { label: 'Announcement Channel',  icon: '📢' },
  [ChannelType.GuildStageVoice]:   { label: 'Stage Channel',         icon: '🎭' },
  [ChannelType.GuildForum]:        { label: 'Forum Channel',         icon: '💬' },
  [ChannelType.PublicThread]:      { label: 'Public Thread',         icon: '🧵' },
  [ChannelType.PrivateThread]:     { label: 'Private Thread',        icon: '🔒' },
  [ChannelType.AnnouncementThread]:{ label: 'Announcement Thread',   icon: '🧵' },
};

function slowmodeLabel(seconds) {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

module.exports = {
  name: "channelinfo",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('View detailed information about a channel.')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to inspect (defaults to current channel)')
        .setRequired(false)
    ),
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const picked = interaction.options.getChannel('channel');

    // Always fetch the full channel object — partial channels are missing most properties
    let channel;
    try {
      channel = await interaction.guild.channels.fetch(picked?.id ?? interaction.channelId);
    } catch {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Channel Not Found')
            .setDescription('Could not fetch that channel. Make sure I have access to it.')
            .setTimestamp(),
        ],
      });
    }

    const meta = TYPE_META[channel.type] ?? { label: 'Unknown', icon: '❓' };
    const separator = '─'.repeat(32);

    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: `${meta.icon}  Channel Info` })
      .setTitle(`${channel.name}`)
      .setDescription(`\`${separator}\``)
      .setTimestamp();

    // ── Core fields ──────────────────────────────────────────────────────────
    embed.addFields(
      { name: '🆔 Channel ID',  value: `\`${channel.id}\``,          inline: true },
      { name: '📂 Type',        value: meta.label,                    inline: true },
      { name: '📅 Created',     value: discordTimestamp(channel.createdAt, 'R'), inline: true },
    );

    // ── Category ─────────────────────────────────────────────────────────────
    if (channel.parent) {
      embed.addFields({ name: '📁 Category', value: channel.parent.name, inline: true });
    }

    // ── Text / Announcement channel extras ───────────────────────────────────
    if (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    ) {
      embed.addFields(
        { name: '🔞 NSFW', value: channel.nsfw ? '✅ Yes' : '❌ No', inline: true },
      );
      const slow = slowmodeLabel(channel.rateLimitPerUser);
      if (slow) embed.addFields({ name: '⏱️ Slowmode', value: slow, inline: true });
      if (channel.topic) {
        embed.addFields({ name: '📝 Topic', value: channel.topic.slice(0, 1024), inline: false });
      }
    }

    // ── Voice / Stage channel extras ─────────────────────────────────────────
    if (
      channel.type === ChannelType.GuildVoice ||
      channel.type === ChannelType.GuildStageVoice
    ) {
      embed.addFields(
        { name: '🎵 Bitrate',    value: `${Math.floor(channel.bitrate / 1000)} kbps`,          inline: true },
        { name: '👥 User Limit', value: channel.userLimit ? `${channel.userLimit}` : 'Unlimited', inline: true },
        { name: '🎤 Connected',  value: `${channel.members?.size ?? 0} user(s)`,                 inline: true },
      );
    }

    // ── Forum extras ─────────────────────────────────────────────────────────
    if (channel.type === ChannelType.GuildForum) {
      embed.addFields(
        { name: '🧵 Active Threads', value: `${channel.threads?.cache?.size ?? 0}`, inline: true },
      );
    }

    // ── Thread extras ────────────────────────────────────────────────────────
    if (
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.AnnouncementThread
    ) {
      embed.addFields(
        { name: '👥 Members',    value: `${channel.memberCount ?? 'N/A'}`, inline: true },
        { name: '💬 Messages',   value: `${channel.messageCount ?? 'N/A'}`, inline: true },
        { name: '🔒 Locked',     value: channel.locked ? '✅ Yes' : '❌ No', inline: true },
        { name: '📌 Parent',     value: channel.parent?.name ?? 'Unknown', inline: true },
      );
    }

    // ── Position ─────────────────────────────────────────────────────────────
    if (channel.position !== undefined && channel.position !== null) {
      embed.addFields({ name: '📌 Position', value: `${channel.position + 1}`, inline: true });
    }

    embed.setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });

    await interaction.editReply({ embeds: [embed] });
  },
};
