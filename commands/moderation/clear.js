// /clear - Bulk deletes messages from a channel
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff, botHasPermission } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');

module.exports = {
  name: "clear",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete messages from this channel')
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addUserOption(opt => opt.setName('user').setDescription('Only delete messages from this user'))
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Optional reason (shown in mod log)')
        .setRequired(false)
        .setMaxLength(500),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const amount = interaction.options.getInteger('amount', true);
    const targetUser = interaction.options.getUser('user') || null;
    const reason = interaction.options.getString('reason') || null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Bot permission safety
      if (!botHasPermission(interaction.channel, PermissionFlagsBits.ManageMessages)) {
        return interaction.editReply({ embeds: [embeds.noPermission('Manage Messages')] });
      }

      let messages = await interaction.channel.messages.fetch({ limit: 100 });

      const beforeFilterCount = messages.size;

      // Optional author filter
      if (targetUser) {
        messages = messages.filter(m => m.author.id === targetUser.id);
      }

      // Discord bulkDelete restrictions: only messages newer than 14 days
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      messages = messages.filter(m => m.createdTimestamp > twoWeeksAgo);

      const eligibleCount = messages.size;
      messages = [...messages.values()].slice(0, amount);

      const filteredByUserText = targetUser ? ` (author-only filter applied)` : '';
      if (messages.length === 0) {
        return interaction.editReply({
          embeds: [
            embeds.warning(
              'No eligible messages',
              `Found **0** deletable message(s). Eligibility requires messages to be under 14 days old.${filteredByUserText}`,
            ),
          ],
        });
      }

      const deleted = await interaction.channel.bulkDelete(messages, true);

      const targetName = targetUser ? ` from **${targetUser.globalName || targetUser.username}**` : '';
      await interaction.editReply({
        embeds: [
          embeds.success(
            'Messages Cleared',
            `Deleted **${deleted.size}** message(s)${targetName}. Eligible scanned: **${eligibleCount}** (fetched **${beforeFilterCount}**).`,
          ),
        ],
      });

      // Moderation log
      // If filtering by user, log that user as target; otherwise log the channel itself as target.
      await logModerationAction(
        interaction.client,
        interaction.guild,
        'CLEAR',
        // modLog expects `target.displayAvatarURL` and naming fields; for channel we fall back to id/name below.
        targetUser
          ? targetUser
          : {
              id: interaction.channel.id,
              username: interaction.channel.name || 'channel',
              globalName: interaction.channel.name || 'channel',
              displayAvatarURL: () => null,
            },
        interaction.user,
        reason,
        { deleted: deleted.size },
      );

    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error('Clear Failed', err.message)] });
    }
  },
};

