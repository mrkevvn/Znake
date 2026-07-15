// /timeout - Times out (mutes) a member
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff, canModerate } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const { parseDuration, formatDuration } = require('../../utils/formatters');

module.exports = {
  name: "timeout",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) a member')
    .addUserOption(opt => opt.setName('user').setDescription('The member to timeout').setRequired(true))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 10m, 1h, 1d (max 28 days)').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the timeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const ms = parseDuration(durationStr);

    if (!target) return interaction.reply({ embeds: [embeds.error('User Not Found', 'That member is not in this server.')], flags: MessageFlags.Ephemeral });
    if (!ms || ms < 1000) return interaction.reply({ embeds: [embeds.error('Invalid Duration', 'Use a format like `10m`, `1h`, or `1d`.')], flags: MessageFlags.Ephemeral });
    if (ms > 28 * 24 * 60 * 60 * 1000) return interaction.reply({ embeds: [embeds.error('Too Long', 'Maximum timeout duration is 28 days.')], flags: MessageFlags.Ephemeral });
    if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [embeds.error('Role Hierarchy', 'Your role is not high enough to timeout this member.')], flags: MessageFlags.Ephemeral });
    if (!target.moderatable) return interaction.reply({ embeds: [embeds.error('Cannot Timeout', 'I cannot moderate this member.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();

    try {
      await target.timeout(ms, `${interaction.user.username}: ${reason}`);
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('Timeout Failed', `Could not timeout this member: ${err.message}`)] });
    }

    await interaction.editReply({ embeds: [embeds.moderation('Member Timed Out', target.user, interaction.user, reason, { duration: formatDuration(ms) })] });
    await logModerationAction(interaction.client, interaction.guild, 'TIMEOUT', target.user, interaction.user, reason, { duration: formatDuration(ms) });
  },
};
