'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

module.exports = {
  name: "emojiinfo",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('emojiinfo')
    .setDescription('View detailed information about a custom server emoji.')
    .addStringOption(opt =>
      opt.setName('emoji')
        .setDescription('Paste the emoji, its name, or its ID')
        .setRequired(true)
    ),
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const input = interaction.options.getString('emoji').trim();

    // Support pasted emoji format <:name:id> or <a:name:id>, or plain name/ID
    const match = input.match(/<a?:(\w+):(\d+)>/);
    let emoji = null;

    try {
      if (match) {
        emoji = interaction.guild.emojis.cache.get(match[2]);
      } else {
        emoji = interaction.guild.emojis.cache.find(
          e => e.name?.toLowerCase() === input.toLowerCase() || e.id === input
        );
      }
    } catch {
      emoji = null;
    }

    if (!emoji) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Emoji Not Found')
            .setDescription(
              `No custom emoji matching \`${input}\` was found in this server.\n\n` +
              '**Tips:**\n' +
              '• Paste the emoji directly into the field\n' +
              '• Use the exact emoji name (case-insensitive)\n' +
              '• Paste the emoji\'s ID'
            )
            .setFooter({ text: 'Only custom server emojis are supported — not built-in Unicode emojis.' })
            .setTimestamp(),
        ],
      });
    }

    const imageUrl = emoji.imageURL({ size: 512, extension: emoji.animated ? 'gif' : 'png' });
    const separator = '─'.repeat(32);

    const usageFormats = [
      `\`<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>\``,
    ];

    const embed = new EmbedBuilder()
      .setColor(config.embedColor || '#5865F2')
      .setAuthor({ name: `${emoji.animated ? '✨ Animated' : '😀 Static'}  Emoji Info` })
      .setTitle(`:${emoji.name}:`)
      .setThumbnail(imageUrl)
      .setDescription(`\`${separator}\``)
      .addFields(
        { name: '🆔 Emoji ID',    value: `\`${emoji.id}\``,            inline: true },
        { name: '📛 Name',        value: `\`${emoji.name}\``,           inline: true },
        { name: '✨ Animated',    value: emoji.animated ? '✅ Yes' : '❌ No', inline: true },
        { name: '📅 Created',     value: discordTimestamp(emoji.createdAt, 'R'), inline: true },
        { name: '🔒 Restricted',  value: emoji.roles?.cache?.size > 0 ? `${emoji.roles.cache.size} role(s)` : '❌ No restrictions', inline: true },
        { name: '🤖 Managed',     value: emoji.managed ? '✅ (integration)' : '❌ No', inline: true },
        { name: '💬 Usage Format', value: usageFormats.join('\n'), inline: false },
        { name: '🔗 Image URL',   value: `[Open full image](${imageUrl})`, inline: false },
      )
      .setImage(imageUrl)
      .setFooter({
        text: `Requested by ${interaction.user.username}  •  ${interaction.guild.name}`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
