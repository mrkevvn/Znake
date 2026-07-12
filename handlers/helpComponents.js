'use strict';

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const config = require('../config.json');
const { CATEGORIES, getGroupedCommands } = require('../utils/helpMapper');

/**
 * Builds the selection menu dynamically based on categories.
 * 
 * @param {Object} grouped Object containing commands grouped by category
 * @param {string} [placeholder] Select menu placeholder text
 * @returns {ActionRowBuilder} ActionRow containing the select menu
 */
function buildSelectMenu(grouped, placeholder) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help_cat_sel')
    .setPlaceholder(placeholder || 'Browse a category…');

  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const cmdCount = grouped[key]?.length || 0;
    // We display the command count in the option description for a premium feel
    menu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(meta.label)
        .setValue(key)
        .setDescription(`${cmdCount} command${cmdCount !== 1 ? 's' : ''} available`)
        .setEmoji(meta.emoji)
    );
  }

  return new ActionRowBuilder().addComponents(menu);
}

/**
 * Renders the help overview dashboard.
 * 
 * @param {Client} client Discord Client
 * @returns {Object} Message payload object with embeds and components
 */
function buildOverview(client) {
  const grouped = getGroupedCommands(client);
  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor || '#5865F2')
    .setAuthor({ 
      name: `${client.user.username}  ·  Command Directory`, 
      iconURL: client.user.displayAvatarURL() 
    })
    .setDescription(
      `**${total} commands** loaded across **${Object.keys(CATEGORIES).length} categories**.\n` +
      `Use the dropdown menu below to explore specific command groups.\n\u200b`
    )
    .setThumbnail(client.user.displayAvatarURL());

  // Perfect 3x2 grid of categories
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const count = grouped[key]?.length || 0;
    embed.addFields({
      name: `${meta.emoji}  ${meta.label}`,
      value: `\`${count} cmd${count !== 1 ? 's' : ''}\`\n*${meta.desc}*`,
      inline: true,
    });
  }

  embed
    .setFooter({ text: `${client.guilds.cache.size} server${client.guilds.cache.size !== 1 ? 's' : ''}  ·  Select a category below` })
    .setTimestamp();

  return { 
    embeds: [embed], 
    components: [buildSelectMenu(grouped, 'Browse a category…')] 
  };
}

/**
 * Renders the detail page for a category.
 * 
 * @param {Client} client Discord Client
 * @param {string} catKey Category key to build
 * @returns {Object|null} Message payload object, or null if category is invalid
 */
function buildCategory(client, catKey) {
  const meta = CATEGORIES[catKey];
  if (!meta) return null;

  const grouped = getGroupedCommands(client);
  const cmds = grouped[catKey] || [];

  const lines = cmds.map(c => `• \`/${c.name}\` ─ ${c.description}`);

  const embed = new EmbedBuilder()
    .setColor(config.embedColor || '#5865F2')
    .setAuthor({ name: `${client.user.username}  ·  Category Details`, iconURL: client.user.displayAvatarURL() })
    .setTitle(`${meta.emoji}  ${meta.label} Commands`)
    .setDescription(lines.join('\n') || '*No commands loaded in this category.*')
    .setFooter({ text: `${cmds.length} command${cmds.length !== 1 ? 's' : ''}  ·  Use the menu below to switch categories` })
    .setTimestamp();

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('help_back_btn')
      .setLabel('← Overview')
      .setStyle(ButtonStyle.Secondary)
  );

  return { 
    embeds: [embed], 
    components: [backRow, buildSelectMenu(grouped, 'Switch category…')] 
  };
}

/**
 * Handles select menu interaction for category selection.
 */
async function handleHelpSelect(interaction, client) {
  const catKey = interaction.values[0];
  const payload = buildCategory(client, catKey);
  if (!payload) {
    return interaction.reply({ content: 'Unknown category.', flags: MessageFlags.Ephemeral });
  }
  return interaction.update(payload);
}

/**
 * Handles back button click to return to the overview page.
 */
async function handleHelpBack(interaction, client) {
  return interaction.update(buildOverview(client));
}

module.exports = { 
  buildOverview, 
  buildCategory, 
  handleHelpSelect, 
  handleHelpBack 
};
