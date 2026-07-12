// /embeddm - Sends a custom embed DM to a user by ID
const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isAdmin } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const config = require('../../config.json');

module.exports = {
  name: "embeddm",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('embeddm')
    .setDescription('Send a custom embed as a DM to any user by their ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt
      .setName('userid')
      .setDescription('The target user\'s Discord ID')
      .setRequired(true))
    .addStringOption(opt => opt
      .setName('title')
      .setDescription('Embed title')
      .setRequired(true))
    .addStringOption(opt => opt
      .setName('description')
      .setDescription('Embed description')
      .setRequired(true))
    .addStringOption(opt => opt
      .setName('color')
      .setDescription('Hex color code e.g. #5865F2 (optional)')),
  cooldown: 10,

  async execute(interaction, client) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        embeds: [embeds.noPermission('Administrator')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.options.getString('userid').trim();
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const colorInput = interaction.options.getString('color');

    if (colorInput && !/^#[0-9A-Fa-f]{6}$/.test(colorInput)) {
      return interaction.reply({
        embeds: [embeds.error('Invalid Color', 'Color must be a valid hex code, e.g. `#5865F2`.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch the user globally — works for any Discord user ID
    let targetUser;
    try {
      targetUser = await client.users.fetch(userId);
    } catch {
      return interaction.editReply({
        embeds: [embeds.error('User Not Found', `No Discord user found with ID \`${userId}\`.\nMake sure you copied the full numeric ID correctly.`)],
      });
    }

    const displayName = targetUser.globalName || targetUser.username;

    const dmEmbed = new EmbedBuilder()
      .setColor(colorInput || config.embedColor)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: `Sent from ${interaction.guild.name}` })
      .setTimestamp();

    let delivered = false;
    try {
      await targetUser.send({ embeds: [dmEmbed] });
      delivered = true;
    } catch {
      // User has DMs off, blocked the bot, or doesn't share a server with it
    }

    await logModerationAction(
      client,
      interaction.guild,
      'EMBED_DM',
      targetUser,
      interaction.user,
      `[EMBED] ${title}: ${description}`,
      { delivered }
    );

    return interaction.editReply({
      embeds: [
        delivered
          ? embeds.success('Embed DM Delivered', `Embed sent to **${displayName}** (\`${targetUser.id}\`).`)
          : embeds.warning('Could Not Deliver DM', [
              `Could not DM **${displayName}** (\`${targetUser.id}\`).`,
              '',
              '**Possible reasons:**',
              '• They have DMs from server members turned off',
              '• They have blocked the bot',
              '• They do not share a server with the bot',
            ].join('\n')),
      ],
    });
  },
};
