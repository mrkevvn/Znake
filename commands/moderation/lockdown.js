'use strict';

const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');

function getLockTargetOverwriteForChannel(channel) {
  if (!channel) return null;

  // Lock the relevant permission(s) by denying @everyone.
  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  ) {
    return { SendMessages: false };
  }

  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    return { Connect: false, Speak: false };
  }

  if (channel.type === ChannelType.GuildCategory) {
    return { SendMessages: false, Connect: false };
  }

  return null;
}

async function applyEveryoneOverwrite(channel, guild, overwrite, retryOnce = true) {
  const everyone = guild.roles.everyone;

  const attempt = async () => {
    if (!channel?.permissionOverwrites?.edit) {
      throw new Error('Missing permissionOverwrites.edit');
    }

    await channel.permissionOverwrites.edit(everyone, overwrite, { reason: 'Server Lockdown' });
  };

  try {
    await attempt();
  } catch (err) {
    if (!retryOnce) throw err;
    await attempt();
  }
}

module.exports = {
  name: "lockdown",
  category: "moderation",
  default_member_permissions: "ManageChannels",
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock all channels in the server (emergency/permanent)')
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the lockdown'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  cooldown: 30,

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [embeds.error('Guild Only', 'This command can only be used in a server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const guild = interaction.guild;

    // Visibility enforcement: block normal users.
    if (!isStaff(interaction.member, guild.id) && !interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    if (!interaction.member.permissions?.has(PermissionFlagsBits.Administrator) && !interaction.member.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ embeds: [embeds.noPermission('Manage Channels')], flags: MessageFlags.Ephemeral });
    }

    const reason = interaction.options.getString('reason') || 'Emergency lockdown';
    await interaction.deferReply();

    const allChannels = [...guild.channels.cache.values()].filter(Boolean);
    const totalProcessed = allChannels.length;

    let success = 0;
    let failed = 0;
    const failedList = [];

    for (const ch of allChannels) {
      const overwrite = getLockTargetOverwriteForChannel(ch);
      if (!overwrite) continue;

      try {
        await applyEveryoneOverwrite(ch, guild, overwrite, true);
        success++;
      } catch (err) {
        failed++;
        failedList.push({ channelId: ch.id, channelName: ch.name || String(ch.id), reason: err?.message || 'Unknown error' });
        // Do not crash; continue.
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#c0392b')
      .setTitle('🔒 Server-wide Lockdown Complete')
      .addFields(
        { name: '🔒 Status', value: 'Locked', inline: true },
        { name: '📊 Total channels processed', value: String(totalProcessed), inline: true },
        { name: '✅ Successful locks', value: String(success), inline: true },
        { name: '❌ Failed channels', value: String(failed), inline: true },
        { name: 'Reason', value: reason, inline: false },
      )
      .setFooter({ text: `Locked by ${interaction.user.tag} • ${guild.name}` })
      .setTimestamp();

    if (failedList.length) {
      embed.addFields({
        name: 'Failed channels (top 10)',
        value:
          failedList
            .slice(0, 10)
            .map(f => `• ${f.channelName} (${f.channelId})`)
            .join('\n') + (failedList.length > 10 ? `\n+${failedList.length - 10} more` : ''),
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};

