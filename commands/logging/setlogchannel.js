// /setlogchannel - Configures a log channel for a specific log type
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

const logTypes = [
  { name: 'Moderation', value: 'moderation' },
  { name: 'Join / Leave', value: 'joinLeave' },
  { name: 'Staff DMs', value: 'staffDm' },
  { name: 'Errors', value: 'errors' },
];

module.exports = {
  name: "setlogchannel",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('Set a log channel for a specific log type')
    .addStringOption(opt =>
      opt.setName('type').setDescription('The log type').setRequired(true)
        .addChoices(...logTypes))
    .addChannelOption(opt => opt.setName('channel').setDescription('The channel to log to').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const type = interaction.options.getString('type');
    const channel = interaction.options.getChannel('channel');

    const logChannels = db.getGuild('log_channels', interaction.guild.id);
    logChannels[type] = channel.id;
    db.setGuild('log_channels', interaction.guild.id, logChannels);

    const typeName = logTypes.find(t => t.value === type)?.name || type;
    await interaction.reply({ embeds: [embeds.success('Log Channel Set', `**${typeName}** logs will now be sent to ${channel}.`)] });
  },
};
