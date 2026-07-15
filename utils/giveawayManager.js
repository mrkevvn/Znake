'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');
const db = require('./database');

const JOIN_BUTTON_PREFIX = 'giveaway:join:';

function getParticipants(giveaway) {
  // Merge both entries and participants for backward compatibility
  const entries = Array.isArray(giveaway.entries) ? giveaway.entries : [];
  const participants = Array.isArray(giveaway.participants) ? giveaway.participants : [];
  return [...new Set([...entries, ...participants].map(String))];
}

function pickWinnersCrypto(giveaway) {
  const participants = getParticipants(giveaway);
  const maxWinners = Number(giveaway.maxWinners ?? giveaway.winnerCount ?? 1);

  if (participants.length === 0) return [];
  if (maxWinners <= 0) return [];
  if (maxWinners >= participants.length) return [...participants];

  // Select without replacement uniformly.
  const arr = [...participants];
  for (let i = 0; i < maxWinners; i++) {
    const j = i + crypto.randomInt(0, arr.length - i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, maxWinners);
}

// Shared: render the requirements block for embeds.
function formatRequirements(giveaway) {
  const r = giveaway.requirements;
  if (r && typeof r === 'object') {
    const lines = [];
    if (r.requiredRoleId) lines.push(`• Role: <@&${r.requiredRoleId}>`);
    if (typeof r.requiredInvites === 'number' && r.requiredInvites > 0) lines.push(`• Invites: \`${r.requiredInvites}\``);
    if (typeof r.requiredMessages === 'number' && r.requiredMessages > 0) lines.push(`• Messages: \`${r.requiredMessages}\``);
    if (lines.length) return lines.join('\n');
  }
  const legacy = giveaway.requirement ?? (typeof giveaway.requirements === 'string' ? giveaway.requirements : null);
  if (typeof legacy === 'string' && legacy && legacy !== 'None') return legacy;
  return '*No requirements — open to everyone!*';
}

// UI ONLY: Active giveaway embed (professional layout)
function buildActiveEmbed(giveaway, guild, botName) {
  const title = giveaway.title ?? giveaway.prize ?? 'Giveaway';
  const prize = giveaway.prize ?? 'Unknown Prize';
  const endSec = giveaway.endTime ? Math.floor(giveaway.endTime / 1000) : null;
  const winners = Number(giveaway.winnerCount ?? giveaway.maxWinners ?? 1);
  const participantCount = Array.isArray(giveaway.entries) ? giveaway.entries.length : (Array.isArray(giveaway.participants) ? giveaway.participants.length : 0);
  const host = giveaway.hostedBy ? `<@${giveaway.hostedBy}>` : 'Unknown';

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setAuthor({ name: '🎉  G I V E A W A Y' })
    .setTitle(`✨ ${prize} ✨`)
    .setDescription(
      [
        '> Press the **🎉 Join Giveaway** button below to enter!',
        '',
        '🟢 **Status:** `ACTIVE`',
        '━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'),
    )
    .addFields(
      { name: '🎁 Prize', value: `**${prize}**`, inline: true },
      { name: '🏆 Winners', value: `\`${winners}\``, inline: true },
      { name: '👥 Entries', value: `\`${participantCount}\``, inline: true },
      { name: '⏰ Ends', value: endSec ? `<t:${endSec}:R>\n<t:${endSec}:f>` : '`Soon`', inline: true },
      { name: '🙋 Hosted By', value: host, inline: true },
      { name: '​', value: '​', inline: true },
      { name: '📋 Requirements', value: formatRequirements(giveaway), inline: false },
    )
    .setFooter({ text: `Hosted via ${botName ?? 'Bot'} • Good luck to everyone!` })
    .setTimestamp();

  const img = giveaway.image ?? giveaway.imageUrl;
  if (img) embed.setThumbnail(img);

  return embed;
}


// UI ONLY: Ended giveaway embed (professional layout)
function buildEndedEmbed(giveaway, winners, guild, botName) {
  const title = giveaway.title ?? giveaway.prize ?? 'Giveaway';
  const prize = giveaway.prize ?? 'Unknown Prize';
  const hasWinners = Array.isArray(winners) && winners.length > 0;
  const participantCount = Array.isArray(giveaway.entries) ? giveaway.entries.length : (Array.isArray(giveaway.participants) ? giveaway.participants.length : 0);
  const host = giveaway.hostedBy ? `<@${giveaway.hostedBy}>` : 'Unknown';
  const endSec = giveaway.endTime ? Math.floor(giveaway.endTime / 1000) : null;

  const winnerText = hasWinners
    ? winners.map((id) => `👑 <@${id}>`).join('\n')
    : '*No valid entries were recorded.*';

  const embed = new EmbedBuilder()
    .setColor(hasWinners ? '#57F287' : '#ED4245')
    .setAuthor({ name: '🎊  G I V E A W A Y   E N D E D' })
    .setTitle(`🏁 ${prize}`)
    .setDescription(
      [
        hasWinners ? '> Congratulations to the winner(s)! 🎉' : '> This giveaway has ended with no valid entries.',
        '',
        '🔴 **Status:** `ENDED`',
        '━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'),
    )
    .addFields(
      { name: hasWinners ? '🏆 Winner(s)' : '🏆 Result', value: winnerText, inline: false },
      { name: '🎁 Prize', value: `**${prize}**`, inline: true },
      { name: '👥 Entries', value: `\`${participantCount}\``, inline: true },
      { name: '🙋 Hosted By', value: host, inline: true },
    )
    .setFooter({ text: `Ended • ${botName ?? 'Bot'}` })
    .setTimestamp();

  if (endSec) embed.addFields({ name: '⏰ Ended', value: `<t:${endSec}:R>`, inline: true });

  const img = giveaway.image ?? giveaway.imageUrl;
  if (img) embed.setThumbnail(img);

  return embed;
}

function buildJoinButton(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${JOIN_BUTTON_PREFIX}${messageId}`)
      .setLabel('🎉 Join Giveaway')
      .setStyle(ButtonStyle.Primary),
  );
}

async function handleGiveawayEnd(client, guildId, messageId, giveaway) {
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(giveaway.channelId);
  const originalMessage = await channel?.messages.fetch(messageId).catch(() => null);

  if (!channel) return;

  // Phase 0: remove join button quickly
  if (originalMessage) {
    await originalMessage.edit({ components: [] }).catch(() => {});
  }

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const phaseDelay = () => wait(2000 + Math.floor(Math.random() * 1000)); // 2–3s

  // Phase 1
  const statusMsg = originalMessage
    ? await originalMessage
        .edit({
          embeds: [],
          components: [],
          content: '🎉 Selecting winners...',
        })
        .catch(() => null)
    : await channel.send({ content: '🎉 Selecting winners...' }).catch(() => null);

  await phaseDelay();

  // Phase 2
  await (statusMsg?.edit
    ? statusMsg.edit({ content: '🎲 Shuffling entries...' }).catch(() => {})
    : Promise.resolve());

  await phaseDelay();

  // Phase 3
  await (statusMsg?.edit
    ? statusMsg.edit({ content: '⚖️ Finalizing results...' }).catch(() => {})
    : Promise.resolve());

  await phaseDelay();


  const { getParticipantsLegacy, filterCandidates, pickWinnersWithoutReplacement } = require('./giveawayEngine');

  const participants = getParticipantsLegacy(giveaway);
  // Exclude disqualified users + invalid entries.
  const candidates = filterCandidates({ giveaway, participants });

  const maxWinners = Number(giveaway.maxWinners ?? giveaway.winnerCount ?? 1);
  const winners = pickWinnersWithoutReplacement({ participants: candidates, maxWinners });

  // Persist first
  const giveaways = db.read('giveaways');
  if (giveaways[guildId]?.[messageId]) {
    giveaways[guildId][messageId].ended = true;
    giveaways[guildId][messageId].winners = winners;
    db.write('giveaways', giveaways);
  }

  const botName = client.user?.username ?? 'Bot';
  const endedEmbed = buildEndedEmbed(giveaway, winners, guild, botName);

  const winnerRevealContent = winners.length ? `🎉 Winners: ${winners.map((id) => `<@${id}>`).join(' ')}` : undefined;

  // Phase 4: reveal
  if (statusMsg?.edit) {
    await statusMsg
      .edit({ content: winnerRevealContent, embeds: [endedEmbed], components: [] })
      .catch(() => {});
  } else {
    await channel
      .send({ content: winnerRevealContent, embeds: [endedEmbed], components: [] })
      .catch(() => {});
  }
}


module.exports = {
  JOIN_BUTTON_PREFIX,
  buildJoinButton,
  buildActiveEmbed,
  buildEndedEmbed,
  pickWinnersCrypto,
  handleGiveawayEnd,
};

