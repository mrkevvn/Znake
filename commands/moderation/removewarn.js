// /removewarn - Removes a specific warning by ID
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');

module.exports = {
  name: "removewarn",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('removewarn')
    .setDescription('Remove a warning from a member by its ID')
    .addUserOption(opt =>
      opt.setName('user').setDescription('The member to remove a warning from').setRequired(true))
    .addStringOption(opt =>
      opt.setName('id').setDescription('The warning ID to remove (shown in /warnings)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    const warnId = interaction.options.getString('id').toUpperCase().trim();
    const displayName = targetUser.globalName || targetUser.username;

    const warnings = db.read('warnings');
    const guildWarnings = warnings[interaction.guild.id] || {};
    const userWarnings = guildWarnings[targetUser.id] || [];

    if (userWarnings.length === 0) {
      return interaction.reply({
        embeds: [embeds.error('No Warnings', `**${displayName}** has no warnings on record.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const index = userWarnings.findIndex(w => w.id === warnId);
    if (index === -1) {
      return interaction.reply({
        embeds: [embeds.error('Not Found', `Warning ID \`${warnId}\` was not found for **${displayName}**.\nUse \`/warnings\` to see their current warning IDs.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const removed = userWarnings.splice(index, 1)[0];

    if (!warnings[interaction.guild.id]) warnings[interaction.guild.id] = {};
    warnings[interaction.guild.id][targetUser.id] = userWarnings;
    db.write('warnings', warnings);

    await interaction.reply({
      embeds: [embeds.success('Warning Removed', [
        `Removed warning \`${removed.id}\` from **${displayName}**.`,
        `**Reason was:** ${removed.reason}`,
        `**Remaining warnings:** ${userWarnings.length}`,
      ].join('\n'))],
    });
  },
};
