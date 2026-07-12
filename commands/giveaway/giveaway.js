'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { isStaff } = require('../../utils/permissions');
const config = require('../../config.json');

function loadDatabaseSafe(name) {
  const dataPath = path.join(__dirname, '../../data', `${name}.json`);
  try {
    if (!fs.existsSync(dataPath)) {
      fs.writeFileSync(dataPath, '{}', 'utf8');
      return {};
    }
    const raw = fs.readFileSync(dataPath, 'utf8');
    if (!raw || !raw.trim()) {
      fs.writeFileSync(dataPath, '{}', 'utf8');
      return {};
    }
    return JSON.parse(raw);
  } catch {
    try {
      fs.writeFileSync(dataPath, '{}', 'utf8');
    } catch {}
    return {};
  }
}

function saveDatabase(name, data) {
  const dataPath = path.join(__dirname, '../../data', `${name}.json`);
  const tmpPath = dataPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, dataPath);
    return true;
  } catch {
    return false;
  }
}

function parseDuration(str) {
  const regex = /(\d+)\s*(d|h|m|s)/gi;
  let ms = 0;
  let match;
  const units = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
  while ((match = regex.exec(str)) !== null) {
    ms += parseInt(match[1]) * (units[match[2].toLowerCase()] || 0);
  }
  return ms > 0 ? ms : null;
}

function generateGiveawayTitle(prize) {
  const titles = [
    'Mega Giveaway',
    'Special Event Giveaway',
    'Community Giveaway',
    'Exclusive Giveaway',
    'Epic Giveaway',
    'Premium Giveaway',
    'Ultimate Giveaway',
    'Limited Giveaway',
    'Grand Giveaway',
    'VIP Giveaway',
  ];
  const idx = crypto.createHash('sha256').update(prize || '').digest()[0] % titles.length;
  const prefixes = ['🎉', '🎁', '🔥', '⭐', '🎊', '💎', '🌟', '🎯', '👑', '✨'];
  return `${prefixes[idx % prefixes.length]} ${titles[idx]}`;
}

function buildGiveawayEmbed(giveaway, guild) {
  const endSec = giveaway.endTime ? Math.floor(giveaway.endTime / 1000) : null;
  const host = giveaway.hostedBy ? `<@${giveaway.hostedBy}>` : 'Unknown';
  const participants = Array.isArray(giveaway.participants) ? giveaway.participants.length : 0;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setAuthor({ name: 'G I V E A W A Y' })
    .setTitle(giveaway.title || 'Giveaway')
    .setDescription([
      `**${giveaway.prize || 'Unknown Prize'}**`,
      '',
      'Press the button below to enter!',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n'))
    .addFields(
      { name: 'Winners', value: `\`${giveaway.winnerCount || 1}\``, inline: true },
      { name: 'Entries', value: `\`${participants}\``, inline: true },
      { name: 'Ends', value: endSec ? `<t:${endSec}:R>` : 'Soon', inline: true },
      { name: 'Hosted By', value: host, inline: true },
    );

  if (giveaway.requirements) {
    const lines = [];
    if (giveaway.requirements.requiredRoleId) lines.push(`Role: <@&${giveaway.requirements.requiredRoleId}>`);
    if (typeof giveaway.requirements.requiredInvites === 'number' && giveaway.requirements.requiredInvites > 0) lines.push(`Invites: \`${giveaway.requirements.requiredInvites}\``);
    if (typeof giveaway.requirements.requiredMessages === 'number' && giveaway.requirements.requiredMessages > 0) lines.push(`Messages: \`${giveaway.requirements.requiredMessages}\``);
    if (lines.length) embed.addFields({ name: 'Requirements', value: lines.join('\n'), inline: false });
  }

  if (giveaway.image) embed.setThumbnail(giveaway.image);

  return embed;
}

function buildJoinButton(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:join:${messageId}`)
      .setLabel('Join Giveaway')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎉'),
  );
}

async function processGiveawaySubmission(interaction, giveawayData) {
  const guildId = interaction.guildId;

  const msg = await interaction.channel.send({
    content: '',
    embeds: [buildGiveawayEmbed(giveawayData, interaction.guild)],
    components: [buildJoinButton('PENDING')],
  });

  giveawayData.messageId = msg.id;

  await msg.edit({
    embeds: [buildGiveawayEmbed(giveawayData, interaction.guild)],
    components: [buildJoinButton(msg.id)],
  });

  const all = loadDatabaseSafe('giveaways');
  if (!all[guildId]) all[guildId] = {};
  all[guildId][msg.id] = giveawayData;
  saveDatabase('giveaways', all);

  return msg;
}

async function handleGiveawayModal(interaction) {
  const guildId = interaction.guildId;

  if (!isStaff(interaction.member, guildId)) {
    return interaction.reply({ content: 'Staff Only', flags: MessageFlags.Ephemeral });
  }

  const prize = interaction.fields.getTextInputValue('prize')?.trim();
  const durationRaw = interaction.fields.getTextInputValue('duration')?.trim();
  const winnersRaw = interaction.fields.getTextInputValue('winners')?.trim();
  const requirementsRaw = interaction.fields.getTextInputValue('requirements')?.trim() || '';

  if (!prize || prize.length > 100) {
    return interaction.reply({ content: 'Prize must be 1-100 characters.', flags: MessageFlags.Ephemeral });
  }

  const durationMs = parseDuration(durationRaw);
  if (!durationMs || durationMs < 10000) {
    return interaction.reply({ content: 'Invalid duration (minimum 10 seconds).', flags: MessageFlags.Ephemeral });
  }

  const winnerCount = Math.max(1, Math.min(20, parseInt(winnersRaw, 10) || 1));

  const requirements = {};
  if (requirementsRaw) {
    const roleMatch = requirementsRaw.match(/role:\s*<?@?&?(\d+)>?/i);
    if (roleMatch) requirements.requiredRoleId = roleMatch[1];
    const invitesMatch = requirementsRaw.match(/invites:\s*(\d+)/i);
    if (invitesMatch) requirements.requiredInvites = parseInt(invitesMatch[1], 10);
    const messagesMatch = requirementsRaw.match(/messages:\s*(\d+)/i);
    if (messagesMatch) requirements.requiredMessages = parseInt(messagesMatch[1], 10);
  }

  const title = generateGiveawayTitle(prize);

  const giveawayData = {
    messageId: null,
    channelId: interaction.channelId,
    title,
    prize,
    durationMs,
    endTime: Date.now() + durationMs,
    winnerCount,
    requirements: Object.keys(requirements).length ? requirements : null,
    image: null,
    participants: [],
    invalidEntries: [],
    disqualifiedUsers: [],
    ended: false,
    winners: [],
    hostedBy: interaction.user.id,
    createdAt: Date.now(),
  };

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await processGiveawaySubmission(interaction, giveawayData);
  } catch {
    return interaction.editReply({ content: 'Failed to send giveaway message.' });
  }

  return interaction.editReply({ content: 'Giveaway successfully created and sent!' });
}

function createGiveawayCommand() {
  return new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create a giveaway');
}

module.exports = {
  name: 'giveaway',
  category: 'moderation',
  default_member_permissions: 'ManageMessages',
  data: createGiveawayCommand(),
  cooldown: 5,

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (!isStaff(interaction.member, guildId)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('Staff Only')
            .setDescription('Only staff members can create giveaways.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('giveaway_create_modal')
      .setTitle('Create Giveaway');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize')
          .setLabel('Prize')
          .setPlaceholder('e.g. Nitro, Steam Gift Card, Discord Role')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration')
          .setPlaceholder('e.g. 1h, 2d, 30m')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('Number of Winners')
          .setPlaceholder('e.g. 1, 2, 5')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('requirements')
          .setLabel('Requirements (optional)')
          .setPlaceholder('e.g. Must be in server, Level 5+, React required')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(200),
      ),
    );

    await interaction.showModal(modal);

    try {
      const submitted = await interaction.awaitModalSubmit({
        time: 600000,
        filter: (i) => i.customId === 'giveaway_create_modal' && i.user.id === interaction.user.id,
      });

      return handleGiveawayModal(submitted);
    } catch {
      return;
    }
  },

  handleGiveawayModal,
};
