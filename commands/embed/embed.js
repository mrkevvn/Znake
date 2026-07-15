// /embed - Create, edit, send, preview, list, delete, and DM custom embeds
const {
  MessageFlags, SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const embeds = require('../../utils/embeds');
const { isAdmin } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

const CREATE_MODAL_ID = 'embed_create_modal';
const EDIT_MODAL_ID = 'embed_edit_modal';

const COLOR_NAMES = {
  red: '#ED4245', green: '#57F287', blue: '#5865F2', blurple: '#5865F2',
  yellow: '#FEE75C', orange: '#F9A825', white: '#FFFFFF', black: '#000000',
  grey: '#99AAB5', gray: '#99AAB5', pink: '#EB459E', teal: '#1ABC9C', gold: '#F1C40F',
};

function isValidHex(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function parseColor(input) {
  if (!input || !input.trim()) return null;
  const raw = input.trim().toLowerCase();
  if (COLOR_NAMES[raw]) return COLOR_NAMES[raw];
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  if (isValidHex(hex)) return hex.toUpperCase();
  return null;
}

function buildEmbed(saved, cfg) {
  const embed = new EmbedBuilder()
    .setColor(saved.color || cfg.embedColor)
    .setTitle(saved.title)
    .setDescription(saved.description)
    .setTimestamp();
  if (saved.footer) embed.setFooter({ text: saved.footer });
  if (saved.image) embed.setImage(saved.image);
  return embed;
}

function buildCreateModal(prefill = {}) {
  return new ModalBuilder()
    .setCustomId(CREATE_MODAL_ID)
    .setTitle('Create Embed')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Name (used to reference this embed)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('my-embed')
          .setRequired(true)
          .setMaxLength(50)
          .setValue(prefill.name || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Title')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Embed title')
          .setRequired(true)
          .setMaxLength(256)
          .setValue(prefill.title || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Embed description content...')
          .setRequired(true)
          .setMaxLength(4000)
          .setValue(prefill.description || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Color (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#5865F2 or blurple')
          .setRequired(false)
          .setMaxLength(20)
          .setValue(prefill.color || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('footer')
          .setLabel('Footer (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Footer text')
          .setRequired(false)
          .setMaxLength(2048)
          .setValue(prefill.footer || ''),
      ),
    );
}

function buildEditModal(name, saved) {
  return new ModalBuilder()
    .setCustomId(`${EDIT_MODAL_ID}:${name}`)
    .setTitle(`Edit Embed: ${name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Title')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(256)
          .setValue(saved.title || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setValue(saved.description || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Color (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#5865F2 or blurple')
          .setRequired(false)
          .setMaxLength(20)
          .setValue(saved.color || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('footer')
          .setLabel('Footer (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(2048)
          .setValue(saved.footer || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('image')
          .setLabel('Image URL (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://example.com/image.png')
          .setRequired(false)
          .setMaxLength(500)
          .setValue(saved.image || ''),
      ),
    );
}

function validateEmbedColor(colorInput) {
  if (!colorInput || !colorInput.trim()) return { color: null, error: null };
  const color = parseColor(colorInput);
  if (!color) return { color: null, error: 'Color must be a valid hex code (e.g. `#5865F2`) or a name (`blurple`, `red`, `green`).' };
  return { color, error: null };
}

module.exports = {
  name: 'embed',
  category: 'moderation',
  default_member_permissions: 'Administrator',
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create, edit, send and manage custom embeds')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create and save a custom embed (opens a form)'))
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit a saved embed (opens a form)')
      .addStringOption(opt => opt.setName('name').setDescription('Name of the saved embed').setRequired(true)))
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
      const modal = buildCreateModal();
      await interaction.showModal(modal);

      let submitted;
      try {
        submitted = await interaction.awaitModalSubmit({
          time: 300_000,
          filter: (i) => i.customId === CREATE_MODAL_ID && i.user.id === interaction.user.id,
        });
      } catch {
        return;
      }

      await submitted.deferReply({ flags: MessageFlags.Ephemeral });

      const name = submitted.fields.getTextInputValue('name')?.trim().toLowerCase().replace(/\s+/g, '-');
      const title = submitted.fields.getTextInputValue('title')?.trim();
      const description = submitted.fields.getTextInputValue('description')?.trim();
      const colorInput = submitted.fields.getTextInputValue('color')?.trim() || null;
      const footer = submitted.fields.getTextInputValue('footer')?.trim() || null;

      if (!name || !title || !description) {
        return submitted.editReply({
          embeds: [embeds.error('Validation Failed', 'Name, title, and description are required.')],
        });
      }

      if (!/^[a-z0-9\-]{1,50}$/.test(name)) {
        return submitted.editReply({
          embeds: [embeds.error('Invalid Name', 'Name must be lowercase alphanumeric with hyphens only (1-50 chars).')],
        });
      }

      const { color, error: colorError } = validateEmbedColor(colorInput);
      if (colorError) {
        return submitted.editReply({ embeds: [embeds.error('Invalid Color', colorError)] });
      }

      guildStore[name] = {
        title,
        description,
        color: color || config.embedColor,
        footer,
        image: null,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
      };
      db.write('embed_store', embedStore);

      return submitted.editReply({
        embeds: [embeds.success('Embed Saved', `Embed \`${name}\` saved.\nUse \`/embed send ${name}\` to post it or \`/embed dm ${name}\` to DM it.`)],
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
      const modal = buildEditModal(name, saved);
      await interaction.showModal(modal);

      let submitted;
      try {
        submitted = await interaction.awaitModalSubmit({
          time: 300_000,
          filter: (i) => i.customId === `${EDIT_MODAL_ID}:${name}` && i.user.id === interaction.user.id,
        });
      } catch {
        return;
      }

      await submitted.deferReply({ flags: MessageFlags.Ephemeral });

      const newTitle = submitted.fields.getTextInputValue('title')?.trim();
      const newDesc = submitted.fields.getTextInputValue('description')?.trim();
      const newColorInput = submitted.fields.getTextInputValue('color')?.trim() || null;
      const newFooter = submitted.fields.getTextInputValue('footer')?.trim() || null;
      const newImage = submitted.fields.getTextInputValue('image')?.trim() || null;

      if (!newTitle || !newDesc) {
        return submitted.editReply({
          embeds: [embeds.error('Validation Failed', 'Title and description are required.')],
        });
      }

      const { color, error: colorError } = validateEmbedColor(newColorInput);
      if (colorError) {
        return submitted.editReply({ embeds: [embeds.error('Invalid Color', colorError)] });
      }

      saved.title = newTitle;
      saved.description = newDesc;
      if (color) saved.color = color;
      saved.footer = newFooter;
      saved.image = newImage;
      saved.editedBy = interaction.user.id;
      saved.editedAt = Date.now();

      guildStore[name] = saved;
      db.write('embed_store', embedStore);

      return submitted.editReply({
        embeds: [embeds.success('Embed Updated', `Embed \`${name}\` has been updated.`)],
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

      let targetUser;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        return interaction.editReply({
          embeds: [embeds.error('User Not Found', `No Discord user found with ID \`${userId}\`.\nMake sure you copied the full numeric ID correctly.`)],
        });
      }

      const displayName = targetUser.globalName || targetUser.username;

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
          .setTitle('Saved Embeds')
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

  async handleModalSubmit(interaction) {
    // Modal submissions are handled inline in execute() via awaitModalSubmit.
    // This export exists only for compatibility if interactionCreate needs it.
    // It should never be called in the current architecture.
  },
};
