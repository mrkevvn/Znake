'use strict';

const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "suggestionselector",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('suggestionselector')
    .setDescription('Set or view the channel where user suggestions are posted.')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to receive suggestions (leave blank to view current setting)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),
  cooldown: 5,

  async execute(interaction) {
    // Defer immediately before any checks
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Staff Only')
            .setDescription('Only staff members can configure the suggestion channel.')
            .setTimestamp(),
        ],
      });
    }

    const { guild, user } = interaction;
    const guildConfig   = db.getGuild('config', guild.id);
    const channelOption = interaction.options.getChannel('channel');

    // ── View current setting ──────────────────────────────────────────────────
    if (!channelOption) {
      const current = guildConfig.suggestionChannelId
        ? `<#${guildConfig.suggestionChannelId}>`
        : '❌ Not configured';

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor || '#5865F2')
            .setTitle('💡 Suggestion Channel')
            .addFields(
              { name: '📺 Current Channel', value: current,                                                     inline: false },
              { name: '💡 How to change',   value: 'Use `/suggestionselector channel:#channel-name` to update.', inline: false },
            )
            .setFooter({ text: 'Suggestion System' })
            .setTimestamp(),
        ],
      });
    }

    // ── Set new channel ───────────────────────────────────────────────────────
    let fullChannel;
    try {
      fullChannel = await guild.channels.fetch(channelOption.id);
    } catch {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Channel Not Found')
            .setDescription('Could not fetch that channel. Make sure I have access to it.')
            .setTimestamp(),
        ],
      });
    }

    const botMember = await guild.members.fetchMe();
    const perms     = fullChannel.permissionsFor(botMember);
    if (!perms?.has('SendMessages') || !perms?.has('EmbedLinks')) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Missing Permissions')
            .setDescription(`I need **Send Messages** and **Embed Links** permissions in ${fullChannel} to post suggestions there.`)
            .setTimestamp(),
        ],
      });
    }

    const previous = guildConfig.suggestionChannelId;
    guildConfig.suggestionChannelId = fullChannel.id;
    db.setGuild('config', guild.id, guildConfig);

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.successColor)
          .setTitle('✅ Suggestion Channel Set')
          .addFields(
            { name: '📺 New Channel', value: `<#${fullChannel.id}>`,                inline: true },
            { name: '📋 Previous',    value: previous ? `<#${previous}>` : 'None',  inline: true },
            { name: '👤 Changed By',  value: `${user}`,                             inline: true },
          )
          .setDescription('All future `/suggest` submissions will be posted in the new channel.')
          .setFooter({ text: 'Suggestion System' })
          .setTimestamp(),
      ],
    });
  },
};
