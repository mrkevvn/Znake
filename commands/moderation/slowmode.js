// /slowmode - Sets the slowmode for a channel
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');

module.exports = {
  name: "slowmode",
  category: "moderation",
  default_member_permissions: "ManageChannels",
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set or disable slowmode in a channel')
    .addIntegerOption(opt =>
      opt.setName('seconds')
        .setDescription('Slowmode delay in seconds — use 0 to disable (max 21600 = 6 hours)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600))
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('Channel to apply slowmode to (defaults to current channel)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const seconds = interaction.options.getInteger('seconds');

    // Resolve the channel — fetch it fully if a different one was specified
    let channel;
    const channelOption = interaction.options.getChannel('channel');

    if (channelOption) {
      // Fetch the full channel object so all methods are available
      try {
        channel = await interaction.guild.channels.fetch(channelOption.id);
      } catch {
        return interaction.reply({
          embeds: [embeds.error('Channel Not Found', 'Could not find that channel in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      channel = interaction.channel;
    }

    // Only text-based channels support slowmode
    const supported = [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ];

    if (!supported.includes(channel.type)) {
      return interaction.reply({
        embeds: [embeds.error('Unsupported Channel', 'Slowmode can only be set on text channels and threads.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Apply slowmode
    try {
      await channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.username}`);
    } catch (err) {
      return interaction.reply({
        embeds: [embeds.error('Failed', `Could not set slowmode: ${err.message}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const description = seconds === 0
      ? `Slowmode has been **disabled** in ${channel}.`
      : `Slowmode set to **${seconds} second${seconds === 1 ? '' : 's'}** in ${channel}.`;

    await interaction.reply({ embeds: [embeds.success('Slowmode Updated', description)] });
  },
};
