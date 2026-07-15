// /untimeout - Removes a timeout from a member
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');

module.exports = {
  name: "untimeout",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a timeout from a member')
    .addUserOption(opt => opt.setName('user').setDescription('The member to un-timeout').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing the timeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) return interaction.reply({ embeds: [embeds.error('User Not Found', 'That member is not in this server.')], flags: MessageFlags.Ephemeral });
    if (!target.isCommunicationDisabled()) return interaction.reply({ embeds: [embeds.warning('Not Timed Out', 'This member is not currently timed out.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();

    try {
      await target.timeout(null, `${interaction.user.username}: ${reason}`);
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error('Failed', `Could not remove timeout: ${err.message}`)] });
    }

    const targetName = target.user.globalName || target.user.username;
    await interaction.editReply({ embeds: [embeds.success('Timeout Removed', `**${targetName}** can now communicate again.\n**Reason:** ${reason}`)] });
    await logModerationAction(interaction.client, interaction.guild, 'UNTIMEOUT', target.user, interaction.user, reason);
  },
};
