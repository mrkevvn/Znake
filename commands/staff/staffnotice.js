// /staffnotice - Sends a staff-only notice to a channel
const { MessageFlags, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const config = require('../../config.json');

module.exports = {
  name: "staffnotice",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('staffnotice')
    .setDescription('Send a staff notice embed')
    .addStringOption(opt => opt.setName('message').setDescription('Notice content').setRequired(true))
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to (defaults to current)'))
    .addStringOption(opt => opt.setName('title').setDescription('Notice title')),
  cooldown: 15,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const message = interaction.options.getString('message');
    const title = interaction.options.getString('title') || '📋 Staff Notice';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch full channel — getChannel() returns a partial without .send()
    let targetChannel;
    const channelOption = interaction.options.getChannel('channel');
    if (channelOption) {
      try {
        targetChannel = await interaction.guild.channels.fetch(channelOption.id);
      } catch {
        return interaction.editReply({ embeds: [embeds.error('Channel Not Found', 'Could not resolve that channel.')] });
      }
    } else {
      targetChannel = interaction.channel;
    }

    const embed = new EmbedBuilder()
      .setColor('#EB459E')
      .setTitle(title)
      .setDescription(message)
      .setFooter({ text: `Staff Notice • ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
      .setTimestamp();

    try {
      await targetChannel.send({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('Send Failed', `Could not send to ${targetChannel}: ${err.message}`)] });
    }

    await interaction.editReply({ embeds: [embeds.success('Notice Sent', `Staff notice sent to ${targetChannel}.`)] });
  },
};
