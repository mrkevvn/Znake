// /warnings - Lists all warnings for a member
const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const { discordTimestamp } = require('../../utils/formatters');
const config = require('../../config.json');

module.exports = {
  name: "warnings",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View all warnings for a member')
    .addUserOption(opt => opt.setName('user').setDescription('The member to check').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('user') || interaction.options.getUser('user');
    const user = target.user || target;
    const displayName = user.globalName || user.username;

    const warnings = db.read('warnings');
    const userWarnings = (warnings[interaction.guild.id] || {})[user.id] || [];

    if (userWarnings.length === 0) {
      return interaction.reply({ embeds: [embeds.info('No Warnings', `**${displayName}** has no warnings.`)] });
    }

    const embed = new EmbedBuilder()
      .setColor(config.warningColor)
      .setTitle(`⚠️ Warnings for ${displayName}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setDescription(`Total: **${userWarnings.length}** warning(s)`)
      .setTimestamp();

    for (const warn of userWarnings.slice(-10)) {
      embed.addFields({
        name: `ID: \`${warn.id}\` — ${discordTimestamp(warn.timestamp, 'R')}`,
        value: `**Reason:** ${warn.reason}\n**By:** ${warn.moderatorTag}`,
      });
    }

    if (userWarnings.length > 10) {
      embed.setFooter({ text: `Showing last 10 of ${userWarnings.length} warnings` });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
