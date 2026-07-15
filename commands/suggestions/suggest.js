'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/database');
const { generateId } = require('../../utils/formatters');
const { buildSuggestionEmbed } = require('../../utils/suggestionEmbed');
const config = require('../../config.json');

module.exports = {
  name: "suggest",
  category: "moderation",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit a suggestion to the server staff.')
    .addStringOption(opt =>
      opt.setName('suggestion')
        .setDescription('Your suggestion — be clear and descriptive')
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true)
    ),
  cooldown: 60,

  async execute(interaction) {
    // Defer immediately before any async work
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { guild, user } = interaction;
    const text       = interaction.options.getString('suggestion').trim();
    const guildConfig = db.getGuild('config', guild.id);

    // ── Check suggestion channel is configured ────────────────────────────────
    if (!guildConfig.suggestionChannelId) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Suggestion System Not Set Up')
            .setDescription(
              'The staff have not configured a suggestion channel yet.\n\n' +
              'Please ask a staff member to use `/suggestionselector` to set one up.'
            )
            .setFooter({ text: 'Suggestion System' })
            .setTimestamp(),
        ],
      });
    }

    let suggestionChannel;
    try {
      suggestionChannel = await guild.channels.fetch(guildConfig.suggestionChannelId);
    } catch {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Suggestion Channel Unavailable')
            .setDescription('The configured suggestion channel could not be found. Please ask staff to re-configure it with `/suggestionselector`.')
            .setFooter({ text: 'Suggestion System' })
            .setTimestamp(),
        ],
      });
    }

    // ── Build suggestion record ───────────────────────────────────────────────
    const suggestions = db.read('suggestions');
    if (!suggestions[guild.id]) suggestions[guild.id] = {};

    const id         = generateId(6);
    const userAvatar = user.displayAvatarURL({ dynamic: true, size: 128 });

    const suggestionData = {
      id,
      text,
      userId:       user.id,
      userTag:      user.globalName || user.username,
      userAvatar,
      status:       'pending',
      createdAt:    Date.now(),
      reviewedBy:   null,
      reviewedById: null,
      reviewNote:   null,
      reviewedAt:   null,
      messageId:    null,
      channelId:    suggestionChannel.id,
      votes:        { up: 0, down: 0 },
    };

    // ── Post to suggestion channel ────────────────────────────────────────────
    let msg;
    try {
      msg = await suggestionChannel.send({ embeds: [buildSuggestionEmbed(suggestionData)] });
      await msg.react('👍');
      await msg.react('👎');
    } catch (err) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Failed to Post Suggestion')
            .setDescription(`Could not post your suggestion in ${suggestionChannel}: \`${err.message}\`\n\nPlease contact a staff member.`)
            .setFooter({ text: 'Suggestion System' })
            .setTimestamp(),
        ],
      });
    }

    suggestionData.messageId = msg.id;
    suggestions[guild.id][id] = suggestionData;
    db.write('suggestions', suggestions);

    // ── Confirm to user ───────────────────────────────────────────────────────
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.successColor)
          .setTitle('✅ Suggestion Submitted')
          .setDescription(
            `Your suggestion has been posted in ${suggestionChannel}!\n\n` +
            `> ${text.length > 150 ? text.slice(0, 147) + '…' : text}`
          )
          .addFields(
            { name: '🆔 Suggestion ID', value: `\`${id}\``,           inline: true },
            { name: '📺 Posted In',     value: `${suggestionChannel}`, inline: true },
          )
          .setFooter({ text: 'You will be notified when staff review your suggestion.' })
          .setTimestamp(),
      ],
    });
  },
};
