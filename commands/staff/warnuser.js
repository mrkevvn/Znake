// /warnuser - Warns a user by ID and DMs them about it
const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const { logModerationAction } = require('../../utils/modLog');
const { generateId } = require('../../utils/formatters');

module.exports = {
  name: "warnuser",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('warnuser')
    .setDescription('Warn a user by ID and send them a DM notification')
    .addStringOption(opt => opt.setName('userid').setDescription('The user\'s Discord ID').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true)),
  cooldown: 10,

  async execute(interaction, client) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.options.getString('userid').trim();
    const reason = interaction.options.getString('reason');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let user;
    try {
      user = await client.users.fetch(userId);
    } catch {
      return interaction.editReply({ embeds: [embeds.error('User Not Found', `Could not find user with ID \`${userId}\`.`)] });
    }

    const displayName = user.globalName || user.username;

    const warnings = db.read('warnings');
    if (!warnings[interaction.guild.id]) warnings[interaction.guild.id] = {};
    if (!warnings[interaction.guild.id][userId]) warnings[interaction.guild.id][userId] = [];

    const warnId = generateId(6);
    warnings[interaction.guild.id][userId].push({
      id: warnId,
      reason,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.globalName || interaction.user.username,
      timestamp: Date.now(),
    });
    db.write('warnings', warnings);

    const total = warnings[interaction.guild.id][userId].length;
    let delivered = false;

    try {
      await user.send({
        embeds: [embeds.warning(`⚠️ Warning from ${interaction.guild.name}`,
          `You have received a warning.\n\n**Reason:** ${reason}\n**Warning ID:** \`${warnId}\`\n**Total Warnings:** ${total}`)]
      });
      delivered = true;
    } catch { /* DMs disabled */ }

    await interaction.editReply({
      embeds: [embeds.success('User Warned',
        `**${displayName}** has been warned.\n**Reason:** ${reason}\n**Warn ID:** \`${warnId}\`\nDM delivered: ${delivered ? '✅' : '❌'}`)],
    });

    await logModerationAction(client, interaction.guild, 'WARN', user, interaction.user, reason, { warnId, totalWarnings: total });
  },
};
