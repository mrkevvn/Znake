// /kick - Kicks a member from the server
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff, canModerate } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');

module.exports = {
  name: "kick",
  category: "moderation",
  default_member_permissions: "KickMembers",
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(opt => opt.setName('user').setDescription('The member to kick').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the kick'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) return interaction.reply({ embeds: [embeds.error('User Not Found', 'That member is not in this server.')], flags: MessageFlags.Ephemeral });
    if (target.id === interaction.user.id) return interaction.reply({ embeds: [embeds.error('Invalid Target', 'You cannot kick yourself.')], flags: MessageFlags.Ephemeral });
    if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [embeds.error('Role Hierarchy', 'Your role is not high enough to kick this member.')], flags: MessageFlags.Ephemeral });
    if (!target.kickable) return interaction.reply({ embeds: [embeds.error('Cannot Kick', 'I cannot kick this member.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();

    try {
      await target.user.send({ embeds: [embeds.warning(`Kicked from ${interaction.guild.name}`, `**Reason:** ${reason}`)] });
    } catch { /* DMs disabled */ }

    try {
      await target.kick(`${interaction.user.username}: ${reason}`);
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('Kick Failed', `Could not kick this member: ${err.message}`)] });
    }

    await interaction.editReply({ embeds: [embeds.moderation('Member Kicked', target.user, interaction.user, reason)] });
    await logModerationAction(interaction.client, interaction.guild, 'KICK', target.user, interaction.user, reason);
  },
};
