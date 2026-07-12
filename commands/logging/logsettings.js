// /logsettings - View and modify log settings
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');

module.exports = {
  name: "logsettings",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('logsettings')
    .setDescription('Configure log settings')
    .addSubcommand(sub => sub.setName('disable')
      .setDescription('Disable a log channel')
      .addStringOption(opt =>
        opt.setName('type').setDescription('Log type to disable').setRequired(true)
          .addChoices(
            { name: 'Moderation', value: 'moderation' },
            { name: 'Join / Leave', value: 'joinLeave' },
            { name: 'Staff DMs', value: 'staffDm' },
            { name: 'Errors', value: 'errors' }
          )))
    .addSubcommand(sub => sub.setName('clear')
      .setDescription('Clear all log channel settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 5,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const logChannels = db.getGuild('log_channels', interaction.guild.id);

    if (sub === 'disable') {
      const type = interaction.options.getString('type');
      delete logChannels[type];
      db.setGuild('log_channels', interaction.guild.id, logChannels);
      return interaction.reply({ embeds: [embeds.success('Log Disabled', `The \`${type}\` log channel has been disabled.`)] });
    }

    if (sub === 'clear') {
      db.setGuild('log_channels', interaction.guild.id, {});
      return interaction.reply({ embeds: [embeds.success('Logs Cleared', 'All log channel configurations have been reset.')] });
    }
  },
};
