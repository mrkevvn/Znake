// /config - View, reset, and reload bot configuration for this guild
const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');
const config = require('../../config.json');
const { isOwner } = require('../../utils/isOwner');

module.exports = {
  name: "config",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Manage bot configuration for this server')
    .addSubcommand(sub => sub.setName('view').setDescription('View current bot configuration'))
    .addSubcommand(sub => sub.setName('reset').setDescription('Reset all bot configuration for this server'))
    // Backward compatible: keep /config reload
    .addSubcommand(sub =>
      sub
        .setName('reload')
        .setDescription('Full reload (commands/events/slash overwrite) without restarting the bot')
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Ignored (kept for backward compatibility)')
            .setRequired(false)
            .addChoices(
              { name: 'config.json (bot config)', value: 'config' },
              { name: 'database cache layer', value: 'database' },
              { name: 'all (config + database)', value: 'all' },
            )
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  cooldown: 10,

  async execute(interaction) {
    const userId = interaction.user?.id;
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

    if (!isAdmin && !isOwner(userId)) {
      return interaction.reply({ embeds: [embeds.noPermission('Administrator / Bot Owner')], flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'view') {
      const staffDb = db.read('staff_roles');
      const logChannels = db.getGuild('log_channels', guild.id);
      const welcome = db.getGuild('welcome', guild.id);
      const security = db.getGuild('security', guild.id);
      const autorole = db.getGuild('autorole', guild.id);

      const staffRoles = (staffDb[guild.id] || [])
        .map(id => {
          const role = guild.roles.cache.get(id);
          return role ? role.toString() : `~~${id}~~`;
        }).join(', ') || 'None';

      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`⚙️ Bot Config — ${guild.name}`)
        .addFields(
          { name: '👮 Staff Roles', value: staffRoles, inline: false },
          { name: '📋 Mod Log', value: logChannels.moderation ? `<#${logChannels.moderation}>` : 'Not set', inline: true },
          { name: '🎫 Ticket Log', value: logChannels.tickets ? `<#${logChannels.tickets}>` : 'Not set', inline: true },
          { name: '📥 Join/Leave Log', value: logChannels.joinLeave ? `<#${logChannels.joinLeave}>` : 'Not set', inline: true },
          { name: '👋 Welcome', value: welcome.enabled ? `<#${welcome.channelId}>` : 'Disabled', inline: true },
          { name: '🚪 Goodbye', value: welcome.goodbyeEnabled ? `<#${welcome.goodbyeChannelId}>` : 'Disabled', inline: true },
          { name: '🏷️ Autorole', value: autorole.roleId ? `<@&${autorole.roleId}>` : 'Disabled', inline: true },
          { name: '🛡️ Anti-Spam', value: security.antiSpam ? '✅ On' : '❌ Off', inline: true },
          { name: '🔗 Anti-Link', value: security.antiLink ? '✅ On' : '❌ Off', inline: true },
          { name: '📨 Anti-Invite', value: security.antiInvite ? '✅ On' : '❌ Off', inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'reset') {
      const guildId = guild.id;
      const databases = ['staff_roles', 'log_channels', 'welcome', 'autorole', 'security'];
      for (const name of databases) {
        const data = db.read(name);
        delete data[guildId];
        db.write(name, data);
      }
      return interaction.reply({ embeds: [embeds.success('Config Reset', 'All bot configuration for this server has been reset to defaults.')] });
    }

    if (sub === 'reload') {
      const { reloadAll, buildEmbedFromResult } = require('../../utils/reloadManager');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const result = await reloadAll(interaction.client, { guildId: guild?.id }).catch((err) => {
        return {
          status: 'FAILED',
          errors: [String(err?.stack || err?.message || err)].slice(0, 5000),
          okCounts: { commands: 0, events: 0 },
          failedCounts: { commands: -1, events: -1 },
          durationMs: 0,
        };
      });

      return interaction.editReply({ embeds: [buildEmbedFromResult(interaction.client, result)] });
    }
  },
};

