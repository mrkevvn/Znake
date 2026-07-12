// /embed - Create, edit, send, preview, list, delete, and DM custom embeds
const { MessageFlags, SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isAdmin } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

function isValidHex(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function buildEmbed(saved, config) {
  const embed = new EmbedBuilder()
    .setColor(saved.color || config.embedColor)
    .setTitle(saved.title)
    .setDescription(saved.description)
    .setTimestamp();
  if (saved.footer) embed.setFooter({ text: saved.footer });
  if (saved.image) embed.setImage(saved.image);
  return embed;
}

module.exports = {
  name: "embed",
  category: "moderation",
  default_member_permissions: "Administrator",
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create, edit, send and manage custom embeds')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create and save a custom embed')
      .addStringOption(opt => opt.setName('name').setDescription('Name to save this embed as').setRequired(true))
      .addStringOption(opt => opt.setName('title').setDescription('Embed title').setRequired(true))
      .addStringOption(opt => opt.setName('description').setDescription('Embed description').setRequired(true))
      .addStringOption(opt => opt.setName('color').setDescription('Hex color e.g. #5865F2'))
      .addStringOption(opt => opt.setName('footer').setDescription('Footer text'))
      .addStringOption(opt => opt.setName('image').setDescription('Image URL')))
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit a saved embed')
      .addStringOption(opt => opt.setName('name').setDescription('Name of the saved embed').setRequired(true))
      .addStringOption(opt => opt.setName('title').setDescription('New title'))
      .addStringOption(opt => opt.setName('description').setDescription('New description'))
      .addStringOption(opt => opt.setName('color').setDescription('New hex color'))
      .addStringOption(opt => opt.setName('footer').setDescription('New footer text'))
      .addStringOption(opt => opt.setName('image').setDescription('New image URL')))
    .addSubcommand(sub => sub
      .setName('send')
      .setDescription('Send a saved embed to a channel')
      .addStringOption(opt => opt.setName('name').setDescription('Name of the saved embed').setRequired(true))
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to (defaults to current)')))
    .addSubcommand(sub => sub
      .setName('dm')
      .setDescription('Send a saved embed to a user via DM')
      .addStringOption(opt => opt.setName('name').setDescription('Name of the saved embed').setRequired(true))
      .addStringOption(opt => opt.setName('userid').setDescription('Discord User ID to DM').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('preview')
      .setDescription('Preview a saved embed (only you can see it)')
      .addStringOption(opt => opt.setName('name').setDescription('Name of the saved embed').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all saved embeds for this server'))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a saved embed')
      .addStringOption(opt => opt.setName('name').setDescription('Name of the embed to delete').setRequired(true))),
  cooldown: 5,

  async execute(interaction, client) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        embeds: [embeds.noPermission('Administrator')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand(false);
    if (!sub) {
      return interaction.reply({
        embeds: [embeds.error('No Subcommand', 'Use: `create`, `edit`, `send`, `dm`, `preview`, `list`, or `delete`.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const embedStore = db.read('embed_store');
    if (!embedStore[interaction.guild.id]) embedStore[interaction.guild.id] = {};
    const guildStore = embedStore[interaction.guild.id];

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const name = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const colorInput = interaction.options.getString('color');
      const footer = interaction.options.getString('footer') || null;
      const image = interaction.options.getString('image') || null;

      if (colorInput && !isValidHex(colorInput)) {
        return interaction.reply({
          embeds: [embeds.error('Invalid Color', 'Color must be a valid hex code, e.g. `#5865F2`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      guildStore[name] = {
        title,
        description,
        color: colorInput || config.embedColor,
        footer,
        image,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
      };
      db.write('embed_store', embedStore);

      return interaction.reply({
        embeds: [embeds.success('Embed Saved', `Embed \`${name}\` saved.\nUse \`/embed send ${name}\` to post it or \`/embed dm ${name}\` to DM it.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── EDIT ────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const name = interaction.options.getString('name').toLowerCase();
      if (!guildStore[name]) {
        return interaction.reply({
          embeds: [embeds.error('Not Found', `No embed named \`${name}\`. Use \`/embed list\` to see all saved embeds.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const saved = guildStore[name];
      const newColor = interaction.options.getString('color');

      if (newColor && !isValidHex(newColor)) {
        return interaction.reply({
          embeds: [embeds.error('Invalid Color', 'Color must be a valid hex code, e.g. `#5865F2`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const newTitle = interaction.options.getString('title');
      const newDesc = interaction.options.getString('description');
      const newFooter = interaction.options.getString('footer');
      const newImage = interaction.options.getString('image');

      if (newTitle) saved.title = newTitle;
      if (newDesc) saved.description = newDesc;
      if (newColor) saved.color = newColor;
      if (newFooter) saved.footer = newFooter;
      if (newImage) saved.image = newImage;
      saved.editedBy = interaction.user.id;
      saved.editedAt = Date.now();

      guildStore[name] = saved;
      db.write('embed_store', embedStore);

      return interaction.reply({
        embeds: [embeds.success('Embed Updated', `Embed \`${name}\` has been updated.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── PREVIEW ─────────────────────────────────────────────────────────────
    if (sub === 'preview') {
      const name = interaction.options.getString('name').toLowerCase();
      const saved = guildStore[name];
      if (!saved) {
        return interaction.reply({
          embeds: [embeds.error('Not Found', `No embed named \`${name}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({ embeds: [buildEmbed(saved, config)], flags: MessageFlags.Ephemeral });
    }

    // ── SEND ────────────────────────────────────────────────────────────────
    if (sub === 'send') {
      const name = interaction.options.getString('name').toLowerCase();
      const saved = guildStore[name];
      if (!saved) {
        return interaction.reply({
          embeds: [embeds.error('Not Found', `No embed named \`${name}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Fetch full channel — getChannel() returns a partial without .send()
      let targetChannel;
      const channelOption = interaction.options.getChannel('channel');
      if (channelOption) {
        try {
          targetChannel = await interaction.guild.channels.fetch(channelOption.id);
        } catch {
          return interaction.editReply({
            embeds: [embeds.error('Channel Not Found', 'Could not resolve that channel.')],
          });
        }
      } else {
        targetChannel = interaction.channel;
      }

      const textTypes = [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
      ];
      if (!textTypes.includes(targetChannel.type)) {
        return interaction.editReply({
          embeds: [embeds.error('Wrong Channel Type', 'Embeds can only be sent to text channels or threads.')],
        });
      }

      try {
        await targetChannel.send({ embeds: [buildEmbed(saved, config)] });
      } catch (err) {
        return interaction.editReply({
          embeds: [embeds.error('Send Failed', `Could not send to ${targetChannel}: \`${err.message}\``)],
        });
      }

      return interaction.editReply({
        embeds: [embeds.success('Embed Sent', `Embed \`${name}\` was sent to ${targetChannel}.`)],
      });
    }

    // ── DM ──────────────────────────────────────────────────────────────────
    if (sub === 'dm') {
      const name = interaction.options.getString('name').toLowerCase();
      const userId = interaction.options.getString('userid').trim();
      const saved = guildStore[name];

      if (!saved) {
        return interaction.reply({
          embeds: [embeds.error('Not Found', `No embed named \`${name}\`. Use \`/embed list\` to see saved embeds.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Fetch the user
      let targetUser;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        return interaction.editReply({
          embeds: [embeds.error('User Not Found', `No Discord user found with ID \`${userId}\`.\nMake sure you copied the full numeric ID correctly.`)],
        });
      }

      const displayName = targetUser.globalName || targetUser.username;

      // Build the embed with a server footer so the recipient knows who sent it
      const dmEmbed = buildEmbed(saved, config);
      dmEmbed.setFooter({ text: `Sent from ${interaction.guild.name}` });

      let delivered = false;
      try {
        await targetUser.send({ embeds: [dmEmbed] });
        delivered = true;
      } catch {
        // DMs disabled or bot not sharing a server with the user
      }

      return interaction.editReply({
        embeds: [
          delivered
            ? embeds.success('Embed DM Sent', `Embed \`${name}\` was delivered to **${displayName}** (${targetUser.id}).`)
            : embeds.warning('Could Not Deliver DM', [
                `Could not DM **${displayName}** (${targetUser.id}).`,
                '',
                '**Possible reasons:**',
                '• They have DMs from server members turned off',
                '• They have blocked the bot',
                '• They do not share a server with the bot',
              ].join('\n')),
        ],
      });
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const keys = Object.keys(guildStore);
      if (keys.length === 0) {
        return interaction.reply({
          embeds: [embeds.info('No Embeds', 'No embeds saved yet. Use `/embed create` to make one.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const list = keys.map(k => `\`${k}\` — *${guildStore[k].title}*`).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(config.embedColor)
          .setTitle('📋 Saved Embeds')
          .setDescription(list)
          .setFooter({ text: `${keys.length} embed${keys.length === 1 ? '' : 's'} saved` })
          .setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const name = interaction.options.getString('name').toLowerCase();
      if (!guildStore[name]) {
        return interaction.reply({
          embeds: [embeds.error('Not Found', `No embed named \`${name}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      delete guildStore[name];
      db.write('embed_store', embedStore);

      return interaction.reply({
        embeds: [embeds.success('Embed Deleted', `Embed \`${name}\` has been deleted.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
