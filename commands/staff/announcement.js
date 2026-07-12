// /announcement - Sends an announcement embed to a channel (Modal UI)
const {
  MessageFlags,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const embeds = require('../../utils/embeds');
const { isStaff, isAdmin } = require('../../utils/permissions');
const config = require('../../config.json');

function canEveryonePing(member, guildId) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  if (!isStaff(member, guildId)) return false;
  return true;
}

function isTextLikeChannel(channel) {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
  ].includes(channel.type);
}

module.exports = {
  name: "announcement",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Send an announcement embed (opens a modal)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  cooldown: 30,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const defaultChannelId = interaction.channel?.id ?? '';
    const modal = new ModalBuilder()
      .setCustomId(`announcement_modal:${interaction.id}`)
      .setTitle('📣 Create Announcement');

    const canPingEveryone = canEveryonePing(interaction.member, interaction.guild.id);

    const titleInput = new TextInputBuilder()
      .setCustomId('ann_title')
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(120)
      .setValue('📣 Announcement');

    const descInput = new TextInputBuilder()
      .setCustomId('ann_description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000)
      .setValue('');

    const channelInput = new TextInputBuilder()
      .setCustomId('ann_channel')
      .setLabel('Channel to send to (default: current)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100)
      .setValue(defaultChannelId);

    const pingInput = new TextInputBuilder()
      .setCustomId('ann_ping')
      .setLabel(canPingEveryone ? 'Everyone ping? (true/false)' : 'Everyone ping? (disabled)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(10)
      .setValue(canPingEveryone ? 'false' : '');

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(channelInput),
      new ActionRowBuilder().addComponents(pingInput),
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction, client) {
    // Helper helper to respond safely
    const sendResponse = async (options) => {
      try {
        if (interaction.deferred || interaction.replied) {
          return await interaction.editReply(options);
        } else {
          return await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
        }
      } catch (err) {
        console.error('Failed to send interaction response:', err);
      }
    };

    try {
      // Defer reply if not already acknowledged
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      // 1. Validate staff permissions first
      if (!isStaff(interaction.member, interaction.guild.id)) {
        return await sendResponse({ embeds: [embeds.staffOnly()] });
      }

      // 2. Extract fields
      const title = interaction.fields.getTextInputValue('ann_title')?.trim() || '📣 Announcement';
      const description = interaction.fields.getTextInputValue('ann_description')?.trim();
      const channelInput = interaction.fields.getTextInputValue('ann_channel')?.trim();
      const pingInput = interaction.fields.getTextInputValue('ann_ping')?.trim().toLowerCase();

      if (!description) {
        return await sendResponse({ embeds: [embeds.error('Missing Description', 'The announcement description cannot be empty.')] });
      }

      // 3. Resolve channel safely
      const defaultChannelId = interaction.channel?.id ?? '';
      const targetChannelId = channelInput || defaultChannelId;
      const cleanChannelId = targetChannelId.replace(/[<#>]/g, '').trim();

      let targetChannel = null;
      try {
        targetChannel = await interaction.guild.channels.fetch(cleanChannelId);
      } catch (err) {
        targetChannel = interaction.guild.channels.cache.get(cleanChannelId);
      }

      // Validate: channel exists, channel is text-based
      if (!targetChannel || !isTextLikeChannel(targetChannel)) {
        return await sendResponse({
          embeds: [embeds.error('Invalid Channel', 'The specified channel was not found or is not a valid text/announcement channel.')]
        });
      }

      // Validate bot permissions: SendMessages + EmbedLinks
      const botMember = interaction.guild.members.me;
      const permissions = targetChannel.permissionsFor(botMember);
      if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
        return await sendResponse({
          embeds: [embeds.error('Missing Permissions', `The bot lacks permission to send messages or embed links in ${targetChannel}.`)]
        });
      }

      // 4. Build announcement embed dynamically per submission
      const announcementEmbed = new EmbedBuilder()
        .setColor(config.infoColor || '#3498db')
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

      // Support optional @everyone ping only if allowed
      let pingContent = '';
      const canPingEveryone = canEveryonePing(interaction.member, interaction.guild.id);
      if (canPingEveryone && (pingInput === 'true' || pingInput === 'yes')) {
        pingContent = '@everyone';
      }

      const sendOptions = { embeds: [announcementEmbed] };
      if (pingContent) {
        sendOptions.content = pingContent;
        sendOptions.allowedMentions = { parse: ['everyone'] };
      }

      // 5. Send announcement inside try/catch
      await targetChannel.send(sendOptions);

      // 6. Success response
      await sendResponse({
        embeds: [embeds.success('Announcement Sent', `Your announcement has been successfully sent to ${targetChannel}.`)]
      });

    } catch (error) {
      console.error('Error handling announcement modal submit:', error);
      const errEmbed = embeds.error('Announcement Failed', `Failed to send the announcement.\n\`${error.message}\``);
      await sendResponse({ embeds: [errEmbed] });
    }
  }
};
