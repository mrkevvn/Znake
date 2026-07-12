// /ban - Bans a member from the server and creates a case
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');
const config = require('../../config.json');
const { isStaff, canModerate } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const { createBanCase, addTimeline, logAction, updateReportEmbed, buildCaseEmbed } = require('../../utils/caseManager');

module.exports = {
  name: "ban",
  category: "moderation",
  default_member_permissions: "BanMembers",
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(opt => opt.setName('user').setDescription('The user to ban').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban'))
    .addIntegerOption(opt => opt.setName('days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const days = interaction.options.getInteger('days') || 0;

    if (!target) return interaction.reply({ embeds: [embeds.error('User Not Found', 'Could not find that member in this server.')], flags: MessageFlags.Ephemeral });
    if (target.id === interaction.user.id) return interaction.reply({ embeds: [embeds.error('Invalid Target', 'You cannot ban yourself.')], flags: MessageFlags.Ephemeral });
    if (target.id === interaction.guild.members.me.id) return interaction.reply({ embeds: [embeds.error('Invalid Target', 'I cannot ban myself.')], flags: MessageFlags.Ephemeral });
    if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [embeds.error('Role Hierarchy', 'Your role is not high enough to ban this member.')], flags: MessageFlags.Ephemeral });
    if (!target.bannable) return interaction.reply({ embeds: [embeds.error('Cannot Ban', 'I do not have permission to ban this member.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();

    // Create ban case
    const { caseId, caseData } = createBanCase(
      target.id,
      target.user.username,
      reason,
      interaction.user.id,
      interaction.guild.id
    );

    // Save case
    const cases = db.read('cases');
    cases[caseId] = caseData;
    db.write('cases', cases);
    logAction('CREATED', caseId, interaction.user.id, `Ban case for ${target.user.username}`, interaction.guild.id);
    logAction('EXECUTED', caseId, interaction.user.id, 'Ban executed', interaction.guild.id);

    // Send DM to banned user with case ID and appeal instructions
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(config.errorColor)
        .setTitle(`🔨 Banned from ${interaction.guild.name}`)
        .setDescription('You have been banned from this server.')
        .addFields(
          { name: '📝 Reason', value: reason, inline: false },
          { name: '🔖 Case ID', value: `\`${caseId}\``, inline: true },
          { name: '📋 Appeal?', value: 'You can appeal this ban using `/appeal` in another server where this bot is active.', inline: false },
          { name: '💡 Next Steps', value: `1. Use \`/appeal Ban\`\n2. Provide your case ID: \`${caseId}\`\n3. Explain why you should be unbanned`, inline: false }
        )
        .setTimestamp();

      await target.user.send({ embeds: [dmEmbed] });
    } catch {
      // User has DMs disabled, that's fine
    }

    // Perform the ban
    try {
      await target.ban({ deleteMessageSeconds: days * 86400, reason: `${interaction.user.username}: ${reason}` });
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('Ban Failed', `Could not ban this member: ${err.message}`)] });
    }

    // Reply to moderator
    const replyFields = [
      { name: '👤 User', value: `${target} (\`${target.id}\`)`, inline: true },
      { name: '⚔️ Moderator', value: `${interaction.user}`, inline: true },
      { name: '📝 Reason', value: reason, inline: false },
      { name: '🔖 Case ID', value: `\`${caseId}\``, inline: true },
    ];

    const replyEmbed = new EmbedBuilder()
      .setColor(config.successColor)
      .setTitle('✅ Member Banned')
      .setDescription(`${target.user.username} has been banned.`)
      .addFields(...replyFields)
      .setTimestamp();

    await interaction.editReply({ embeds: [replyEmbed] });
    await logModerationAction(interaction.client, interaction.guild, 'BAN', target.user, interaction.user, reason);
  },
};
