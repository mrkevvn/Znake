// /setlevelup - Configure the level-up announcement channel
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../../config.json');
const db = require('../../utils/database');

module.exports = {
  name: "setlevelup",
  category: "moderation",
  default_member_permissions: "ManageGuild",
  data: new SlashCommandBuilder()
    .setName('setlevelup')
    .setDescription('Configure level-up announcement settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('channel')
        .setDescription('Set the channel where level-up messages are sent')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('The channel to send level-up messages in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable level-up announcements')
    )
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View current level-up settings')
    ),
  cooldown: 5,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    const cfg = db.read('level_config');
    if (!cfg[guild.id]) cfg[guild.id] = {};
    const guildCfg = cfg[guild.id];

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      guildCfg.levelUpChannelId = channel.id;
      guildCfg.enabled = true;
      db.write('level_config', cfg);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('✅ Level-Up Channel Set')
            .setDescription(`Level-up announcements will now be sent to ${channel}.`)
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'disable') {
      guildCfg.enabled = false;
      db.write('level_config', cfg);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('🔕 Level-Up Announcements Disabled')
            .setDescription('Members will no longer receive level-up announcements.')
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'view') {
      const channelMention = guildCfg.levelUpChannelId
        ? `<#${guildCfg.levelUpChannelId}>`
        : '*Not set — uses the channel the message was sent in*';

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle('⚙️ Level-Up Settings')
            .addFields(
              { name: 'Status',    value: guildCfg.enabled === false ? '🔴 Disabled' : '🟢 Enabled', inline: true },
              { name: 'Channel',   value: channelMention, inline: true },
            )
            .setTimestamp(),
        ],
      });
    }
  },
};
