'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isBlacklisted, getBlacklistEntry } = require('../../utils/isBlacklisted');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

const AUDIT_ACTIONS = [
  { event: AuditLogEvent.MemberBanAdd,    label: '🔨 Ban' },
  { event: AuditLogEvent.MemberBanRemove, label: '🔓 Unban' },
  { event: AuditLogEvent.MemberKick,      label: '👢 Kick' },
  { event: AuditLogEvent.MemberUpdate,    label: '⏱️ Timeout' },
];

module.exports = {
  name: "history",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View the full moderation history of a user.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The member to look up')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('User ID (use if the user is no longer in the server)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id) && !isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need a staff role to view moderation history.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser('user');
    const rawId = interaction.options.getString('userid')?.trim();

    if (!targetUser && !rawId) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ No Target')
            .setDescription('Please provide a user or a user ID.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let user = targetUser;
    if (!user) {
      try {
        user = await interaction.client.users.fetch(rawId);
      } catch {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ User Not Found')
              .setDescription(`Could not find a Discord user with ID \`${rawId}\`.`)
              .setTimestamp(),
          ],
        });
      }
    }

    const userId = user.id;
    const tag = user.globalName || user.username;

    // ── Warnings ─────────────────────────────────────────────────────────────
    const warningsDb = db.read('warnings');
    const userWarnings = warningsDb?.[interaction.guild.id]?.[userId] || [];

    // ── Blacklist ─────────────────────────────────────────────────────────────
    const blacklisted = isBlacklisted(userId);
    const blacklistEntry = blacklisted ? getBlacklistEntry(userId) : null;

    // ── Audit Log ─────────────────────────────────────────────────────────────
    const auditEntries = [];
    if (interaction.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      for (const { event, label } of AUDIT_ACTIONS) {
        try {
          const logs = await interaction.guild.fetchAuditLogs({ type: event, limit: 10 });
          for (const entry of logs.entries.values()) {
            if (entry.target?.id === userId || entry.targetId === userId) {
              auditEntries.push({ label, reason: entry.reason || 'No reason provided', executor: entry.executor?.username || 'Unknown', ts: entry.createdTimestamp });
            }
          }
        } catch { /* no audit log perms or unavailable */ }
      }
      auditEntries.sort((a, b) => b.ts - a.ts);
    }

    // ── Build Embed ───────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`📋 Moderation History — ${tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .addFields({ name: 'User', value: `<@${userId}> (\`${userId}\`)`, inline: false });

    // Blacklist field
    embed.addFields({
      name: '🔒 Blacklist',
      value: blacklisted
        ? `**Blacklisted** — ${blacklistEntry?.reason || 'No reason'}\nBy **${blacklistEntry?.addedByTag || 'Unknown'}** • <t:${Math.floor((blacklistEntry?.addedAt || 0) / 1000)}:R>`
        : '✅ Not blacklisted',
      inline: false,
    });

    // Warnings field
    if (userWarnings.length === 0) {
      embed.addFields({ name: `⚠️ Warnings (0)`, value: 'No warnings on record.', inline: false });
    } else {
      const warnLines = userWarnings.slice(-10).map((w, i) =>
        `**${i + 1}.** \`${w.id}\` — ${w.reason}\n> By **${w.moderatorTag || 'Unknown'}** • <t:${Math.floor(w.timestamp / 1000)}:R>`
      );
      embed.addFields({
        name: `⚠️ Warnings (${userWarnings.length}${userWarnings.length > 10 ? ', showing last 10' : ''})`,
        value: warnLines.join('\n'),
        inline: false,
      });
    }

    // Audit log actions field
    if (auditEntries.length === 0) {
      embed.addFields({ name: '🔨 Actions (Audit Log)', value: 'No recent audit log actions found.', inline: false });
    } else {
      const actionLines = auditEntries.slice(0, 10).map(e =>
        `${e.label} — ${e.reason}\n> By **${e.executor}** • <t:${Math.floor(e.ts / 1000)}:R>`
      );
      embed.addFields({
        name: `🔨 Actions — Audit Log (${auditEntries.length > 10 ? 'last 10' : auditEntries.length})`,
        value: actionLines.join('\n'),
        inline: false,
      });
    }

    embed
      .addFields({
        name: '📊 Summary',
        value: `Warnings: **${userWarnings.length}** • Audit actions: **${auditEntries.length}** • Blacklisted: **${blacklisted ? 'Yes' : 'No'}**`,
        inline: false,
      })
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.globalName || interaction.user.username}` });

    return interaction.editReply({ embeds: [embed] });
  },
};
