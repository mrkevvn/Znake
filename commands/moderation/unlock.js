'use strict';

const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: "unlock",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a channel by allowing @everyone to send messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to unlock (default: current channel)')
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

    try {
      // Get @everyone role from the guild
      const everyoneRole = targetChannel.guild.roles.everyone;

      if (!everyoneRole) {
        return interaction.reply({
          content: 'Could not find @everyone role.',
          flags: 64,
        });
      }

      // Update permission overwrites for @everyone to unlock sending messages
      await targetChannel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: true,
      });

      return interaction.reply({
        content: 'Channel has been unlocked 🔓',
        flags: 64,
      });
    } catch (error) {
      console.error('Error unlocking channel:', error);
      const content = 'Failed to unlock the channel. Please try again.';
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  },
};
