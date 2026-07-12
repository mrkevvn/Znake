'use strict';

const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff, canModerate } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');

module.exports = {
  name: "softban",
  category: "moderation",
  default_member_permissions: "BanMembers",
  data: new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Ban then immediately unban a user to purge their recent messages.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The member to softban')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for the softban')
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt.setName('days')
        .setDescription('Days of messages to delete (1-7, default 1)')
        .setMinValue(1)
        .setMaxValue(7)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const days = interaction.options.getInteger('days') ?? 1;

    if (!target) {
      return interaction.reply({ embeds: [embeds.error('User Not Found', 'That member is not in this server.')], flags: MessageFlags.Ephemeral });
    }
    if (target.id === interaction.user.id) {
      return interaction.reply({ embeds: [embeds.error('Invalid Target', 'You cannot softban yourself.')], flags: MessageFlags.Ephemeral });
    }
    if (target.id === interaction.guild.members.me.id) {
      return interaction.reply({ embeds: [embeds.error('Invalid Target', 'I cannot softban myself.')], flags: MessageFlags.Ephemeral });
    }
    if (!canModerate(interaction.member, target)) {
      return interaction.reply({ embeds: [embeds.error('Role Hierarchy', 'Your role is not high enough to softban this member.')], flags: MessageFlags.Ephemeral });
    }
    if (!target.bannable) {
      return interaction.reply({ embeds: [embeds.error('Cannot Softban', 'I do not have permission to ban this member.')], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      await target.user.send({
        embeds: [embeds.warning(
          `Softbanned from ${interaction.guild.name}`,
          `You have been softbanned (your recent messages were removed).\n**Reason:** ${reason}\n\nYou may rejoin the server.`
        )],
      });
    } catch { /* DMs disabled */ }

    try {
      await target.ban({ deleteMessageSeconds: days * 86400, reason: `[Softban] ${interaction.user.username}: ${reason}` });
      await interaction.guild.bans.remove(target.id, 'Softban — automatic unban');
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('Softban Failed', `Could not complete the softban: ${err.message}`)] });
    }

    await interaction.editReply({
      embeds: [embeds.moderation(`Member Softbanned (${days}d messages deleted)`, target.user, interaction.user, reason)],
    });

    await logModerationAction(
      interaction.client,
      interaction.guild,
      'BAN',
      target.user,
      interaction.user,
      `[Softban] ${reason}`
    );
  },
};
