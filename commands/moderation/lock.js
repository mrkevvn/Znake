'use strict';

const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: "lock",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel by preventing @everyone from sending messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to lock (default: current channel)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    if (!targetChannel) {
      return interaction.reply({
        content: 'Channel not found.',
        flags: 64,
      });
    }

    // Basic bot permission checks to avoid 50013 + stack traces
    const { botHasPermission } = require('../../utils/permissions');

    const botPermOk = botHasPermission(targetChannel, PermissionFlagsBits.ManageRoles);
    if (!botPermOk) {
      return interaction.reply({
        content: 'I don’t have permission to manage roles in that server/channel.',
        flags: 64,
      });
    }

    const everyoneRole = targetChannel.guild?.roles?.everyone;
    if (!everyoneRole) {
      return interaction.reply({
        content: 'Could not find @everyone role.',
        flags: 64,
      });
    }

    // Role hierarchy safety: bot must be above @everyone
    const botMember = interaction.guild?.members?.me;
    if (botMember && botMember.roles?.highest?.comparePositionTo(everyoneRole) <= 0) {
      return interaction.reply({
        content: 'I can’t apply these permissions due to role hierarchy.',
        flags: 64,
      });
    }

    try {
      // Check bot role hierarchy before editing overwrites
      const botRolesHighest = targetChannel.guild.members.me?.roles?.highest;
      if (botRolesHighest && botRolesHighest.comparePositionTo(everyoneRole) <= 0) {
        return interaction.reply({
          content: 'I can’t apply these permissions due to role hierarchy.',
          flags: 64,
        });
      }

      // If already locked, do not attempt another overwrite (prevents double-ack patterns)

      const existingOverwrite = targetChannel.permissionOverwrites.cache.get(everyoneRole.id);
      const alreadyLocked = existingOverwrite?.allow?.has('SendMessages') === false ||
        existingOverwrite?.deny?.has('SendMessages') === true;

      if (alreadyLocked) {
      // Already locked - normal condition.
        return interaction.reply({ content: '⚠️ This channel is already locked.', flags: 64 });

      }

      // Update permission overwrites for @everyone to lock sending messages
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false,
      });

      return interaction.reply({
        content: 'Channel has been locked 🔒',
        flags: 64,
      });
    } catch (error) {
      // Only real failures should surface.
      console.error('[lock] Failed to edit channel overwrites:', error);
      const content = 'I couldn’t lock that channel due to missing permissions or hierarchy issues.';

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  },
};
