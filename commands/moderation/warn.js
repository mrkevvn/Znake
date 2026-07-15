// /warn - Issues a warning to a member
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const { logModerationAction } = require('../../utils/modLog');
const { generateId } = require('../../utils/formatters');

module.exports = {
  name: "warn",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a member')
    .addUserOption(opt => opt.setName('user').setDescription('The member to warn').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason');

    if (!target) return interaction.reply({ embeds: [embeds.error('User Not Found', 'That member is not in this server.')], flags: MessageFlags.Ephemeral });
    if (target.user.bot) return interaction.reply({ embeds: [embeds.error('Invalid Target', 'You cannot warn a bot.')], flags: MessageFlags.Ephemeral });

    const warnings = db.read('warnings');
    if (!warnings[interaction.guild.id]) warnings[interaction.guild.id] = {};
    if (!warnings[interaction.guild.id][target.id]) warnings[interaction.guild.id][target.id] = [];

    const warnId = generateId(6);
    const warning = {
      id: warnId,
      reason,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.globalName || interaction.user.username,
      timestamp: Date.now(),
    };

    warnings[interaction.guild.id][target.id].push(warning);
    db.write('warnings', warnings);

    const totalWarnings = warnings[interaction.guild.id][target.id].length;

    try {
      await target.user.send({ embeds: [embeds.warning(`Warning in ${interaction.guild.name}`, `**Reason:** ${reason}\n**Warning ID:** \`${warnId}\`\n**Total Warnings:** ${totalWarnings}`)] });
    } catch { /* DMs disabled */ }

    await interaction.reply({ embeds: [embeds.moderation('Member Warned', target.user, interaction.user, reason, { warnId })] });
    await logModerationAction(interaction.client, interaction.guild, 'WARN', target.user, interaction.user, reason, { warnId, totalWarnings });
  },
};
