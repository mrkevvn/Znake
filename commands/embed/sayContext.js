// Message Context Menu: Apps -> Say
const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { sayConfig, checkPermissions } = require('../../utils/sayShared');
const embeds = require('../../utils/embeds');

module.exports = {
  name: "Say",
  category: "moderation",
  cooldown: sayConfig.cooldownDuration ?? 3,
  data: new ContextMenuCommandBuilder()
    .setName('Say')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    // ── Permission Handling ────────────────────────────────────────
    if (!checkPermissions(interaction.member)) {
      const errorEmbed = embeds.error(
        'Permission Denied',
        `You do not have the required permissions to run this command. Must be an Administrator or have the allowed role.`
      );
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    // ── Open Reply Modal ───────────────────────────────────────────
    const modal = new ModalBuilder()
      .setCustomId(`say_modal:${interaction.targetMessage.id}`)
      .setTitle('Reply as Bot');

    const messageInput = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('Message content to reply with')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Type the content the bot should reply with...')
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  }
};
