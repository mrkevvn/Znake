'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

function buildBar(value, total, length = 10) {
  if (!total) return '░'.repeat(length);
  const filled = Math.round((value / total) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

module.exports = {
  name: "serverstats",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('View a full statistical breakdown of this server.'),
  cooldown: 10,

  async execute(interaction) {
    await interaction.deferReply();

    const { guild } = interaction;

    try {
      await guild.members.fetch();
    } catch { /* use cached data */ }

    const members  = guild.members.cache;
    const channels = guild.channels.cache;
    const roles    = guild.roles.cache;
    const emojis   = guild.emojis.cache;
    const stickers = guild.stickers?.cache;

    // ── Members ───────────────────────────────────────────────────────────────
    const totalMembers = guild.memberCount;
    const bots         = members.filter(m => m.user.bot).size;
    const humans       = totalMembers - bots;

    // ── Channels ──────────────────────────────────────────────────────────────
    const textCh    = channels.filter(c => c.type === ChannelType.GuildText).size;
    const voiceCh   = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const catCh     = channels.filter(c => c.type === ChannelType.GuildCategory).size;
    const annCh     = channels.filter(c => c.type === ChannelType.GuildAnnouncement).size;
    const forumCh   = channels.filter(c => c.type === ChannelType.GuildForum).size;
    const stageCh   = channels.filter(c => c.type === ChannelType.GuildStageVoice).size;
    const totalCh   = channels.size;

    // ── Roles ─────────────────────────────────────────────────────────────────
    const totalRoles  = roles.size - 1; // exclude @everyone
    const hoisted     = roles.filter(r => r.hoist && r.id !== guild.id).size;
    const mentionable = roles.filter(r => r.mentionable && r.id !== guild.id).size;
    const managed     = roles.filter(r => r.managed).size;

    // ── Emojis ───────────────────────────────────────────────────────────────
    const staticEmojis = emojis.filter(e => !e.animated).size;
    const animEmojis   = emojis.filter(e => e.animated).size;
    const totalEmojis  = emojis.size;

    // ── Stickers ─────────────────────────────────────────────────────────────
    const totalStickers = stickers?.size ?? 0;

    // ── Boost ─────────────────────────────────────────────────────────────────
    const boostLevel = guild.premiumTier;
    const boostCount = guild.premiumSubscriptionCount || 0;
    const boostGoals = { 0: 2, 1: 7, 2: 14, 3: 14 };
    const nextGoal   = boostGoals[boostLevel] ?? 14;
    const boostBar   = buildBar(boostCount, nextGoal);

    // ── Presence (requires GUILD_PRESENCES intent) ────────────────────────────
    const online  = members.filter(m => m.presence?.status === 'online').size;
    const idle    = members.filter(m => m.presence?.status === 'idle').size;
    const dnd     = members.filter(m => m.presence?.status === 'dnd').size;
    const presenceAvailable = (online + idle + dnd) > 0;
    const offlineCount = presenceAvailable ? Math.max(0, totalMembers - online - idle - dnd) : null;

    const separator = '─'.repeat(32);

    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({
        name: `📊  Server Stats — ${guild.name}`,
        iconURL: guild.iconURL({ dynamic: true }) ?? undefined,
      })
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setDescription(`\`${separator}\``)

      // ── Member stats ────────────────────────────────────────────────────────
      .addFields({
        name: '👥 Members',
        value: [
          `\`${buildBar(humans, totalMembers)}\` **${humans}** humans  (${Math.round(humans / totalMembers * 100)}%)`,
          `\`${buildBar(bots,   totalMembers)}\` **${bots}** bots  (${Math.round(bots / totalMembers * 100)}%)`,
          `**Total:** ${totalMembers}`,
        ].join('\n'),
        inline: false,
      })

      // ── Presence (only shown if intent is active) ───────────────────────────
      .addFields({
        name: '🟢 Presence',
        value: presenceAvailable
          ? [
              `🟢 Online: **${online}**`,
              `🟡 Idle: **${idle}**`,
              `🔴 DND: **${dnd}**`,
              `⚫ Offline: **${offlineCount}**`,
            ].join('  ·  ')
          : '*Presence data unavailable (intent not enabled)*',
        inline: false,
      })

      // ── Channel stats ───────────────────────────────────────────────────────
      .addFields({
        name: `📺 Channels  (${totalCh} total)`,
        value: [
          `#️⃣ Text: **${textCh}**`,
          `🔊 Voice: **${voiceCh}**`,
          `📢 Announce: **${annCh}**`,
          `📁 Categories: **${catCh}**`,
          `💬 Forums: **${forumCh}**`,
          `🎭 Stages: **${stageCh}**`,
        ].join('  ·  '),
        inline: false,
      })

      // ── Role stats ──────────────────────────────────────────────────────────
      .addFields(
        { name: '🏷️ Total Roles',   value: `${totalRoles}`,   inline: true },
        { name: '📌 Hoisted',        value: `${hoisted}`,      inline: true },
        { name: '🔔 Mentionable',    value: `${mentionable}`,  inline: true },
        { name: '🤖 Bot Managed',    value: `${managed}`,      inline: true },
      )

      // ── Emoji / Sticker stats ───────────────────────────────────────────────
      .addFields(
        { name: '😀 Static Emojis',   value: `${staticEmojis}`,  inline: true },
        { name: '✨ Animated Emojis', value: `${animEmojis}`,    inline: true },
        { name: '🎭 Stickers',        value: `${totalStickers}`, inline: true },
      )

      // ── Boost stats ─────────────────────────────────────────────────────────
      .addFields({
        name: `🚀 Server Boost — Level ${boostLevel}`,
        value: [
          `\`${boostBar}\`  **${boostCount}** / ${nextGoal} boosts`,
          boostLevel < 3 ? `*${nextGoal - boostCount} more boost${nextGoal - boostCount !== 1 ? 's' : ''} to reach Level ${boostLevel + 1}*` : '✅ Max level reached!',
        ].join('\n'),
        inline: false,
      })

      .setFooter({
        text: `Requested by ${interaction.user.username}  •  Since ${guild.createdAt.toDateString()}`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
