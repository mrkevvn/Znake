'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../../config.json');
const { isOwner } = require('../../utils/permissions');

// ─────────────────────────────
// Utilities
// ─────────────────────────────

function safe(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  return val;
}

function normalizeToArray(values) {
  if (!values) return [];
  if (Array.isArray(values)) return values;
  try {
    if (typeof values.values === 'function') return Array.from(values.values());
  } catch {
    // ignore
  }
  return [];
}

function formatTimestamp(date) {
  if (!date) return '';
  const dt = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dt.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');
  const year = dt.getUTCFullYear();
  const month = dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = pad(dt.getUTCDate());
  const hours = pad(dt.getUTCHours());
  const mins = pad(dt.getUTCMinutes());
  const secs = pad(dt.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${mins}:${secs} UTC`;
}

function replaceMentionsWithDisplay(text, userMap) {
  const input = text === null || text === undefined ? '' : String(text);
  if (!input) return '';
  return input.replace(/<@!?([0-9]{15,20})>/g, (_match, id) => {
    const u = userMap.get(id);
    return u?.displayName || u?.username || 'Unknown User';
  });
}

// ─────────────────────────────
// Data Collection
// ─────────────────────────────

async function fetchAllMessages(channel, {
  limitPerRequest = 100,
  maxMessages = 250000,
  onProgress,
} = {}) {
  const messages = [];
  let lastId = null;
  let fetched = 0;

  while (true) {
    if (fetched >= maxMessages) break;

    const opts = {
      limit: limitPerRequest,
      ...(lastId ? { before: lastId } : {}),
    };

    let batch;
    try {
      batch = await channel.messages.fetch(opts);
    } catch (err) {
      break;
    }

    if (!batch || batch.size === 0) break;

    for (const msg of batch.values()) messages.push(msg);

    fetched += batch.size;
    lastId = batch.last()?.id;

    if (typeof onProgress === 'function') {
      try {
        onProgress(fetched);
      } catch {
        // ignore
      }
    }
  }

  // Sort chronologically
  messages.sort((a, b) => (a?.createdTimestamp || 0) - (b?.createdTimestamp || 0));
  return messages;
}

function collectUserIds(messages) {
  const ids = new Set();

  for (const m of messages) {
    if (m?.author?.id) ids.add(m.author.id);

    try {
      const mentionedUsers = m?.mentions?.users;
      if (mentionedUsers && typeof mentionedUsers.keys === 'function') {
        for (const id of mentionedUsers.keys()) ids.add(id);
      }
    } catch {
      // ignore
    }

    try {
      const replied = m?.mentions?.repliedUser;
      if (replied?.id) ids.add(replied.id);
    } catch {
      // ignore
    }
  }

  return ids;
}

async function buildUserMap(client, userIds, { chunkSize = 25 } = {}) {
  const userMap = new Map();
  const ids = Array.from(userIds);
  const fallback = { id: '', username: 'Unknown', displayName: 'Unknown User' };

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map((id) => client.users.fetch(id).catch(() => null)),
    );

    for (let j = 0; j < chunk.length; j++) {
      const id = chunk[j];
      const res = results[j];
      const u = res?.status === 'fulfilled' ? res.value : null;

      if (u) {
        userMap.set(id, {
          id: safe(u.id),
          username: safe(u.username),
          displayName: safe(u.displayName || u.username, 'Unknown User'),
        });
      } else {
        userMap.set(id, { ...fallback, id: safe(id) });
      }
    }
  }

  return userMap;
}

function messageToDataset(message, { userMap } = {}) {
  const msg = message || {};

  const author = msg.author
    ? {
        id: safe(msg.author.id),
        name: safe(msg.author.username),
        displayName: safe(msg.author.displayName || msg.author.username, 'Unknown User'),
      }
    : {
        id: '',
        name: 'Unknown',
        displayName: 'Unknown User',
      };

  const displayUserFromMap = userMap?.get(author.id);
  const authorDisplay = displayUserFromMap?.displayName || author.displayName || 'Unknown User';

  const content = safe(msg.content);
  const contentResolved = userMap ? replaceMentionsWithDisplay(content, userMap) : content;

  const attachments = normalizeToArray(msg.attachments?.values?.() || msg.attachments).map((a) => ({
    url: safe(a?.url),
    name: safe(a?.name),
    contentType: safe(a?.contentType),
    size: safe(a?.size),
  }));

  const embeds = normalizeToArray(msg.embeds).map((e) => ({
    type: safe(e?.type, 'rich'),
    title: safe(e?.title),
    description: safe(e?.description),
    url: safe(e?.url),
    color: safe(e?.color),
    footer: {
      text: safe(e?.footer?.text),
      iconURL: safe(e?.footer?.iconURL),
    },
    image: {
      url: safe(e?.image?.url),
    },
    thumbnail: {
      url: safe(e?.thumbnail?.url),
    },
    fields: normalizeToArray(e?.fields).map((f) => ({
      name: safe(f?.name),
      value: safe(f?.value),
      inline: !!f?.inline,
    })),
  }));

  const reactions = normalizeToArray(msg.reactions?.cache?.values?.() || []).map((r) => ({
    emoji: {
      id: r?.emoji?.id ? safe(r.emoji.id) : null,
      name: safe(r?.emoji?.name),
    },
    count: safe(r?.count, 0),
    me: !!r?.me,
  }));

  const reply = (() => {
    const ref = msg.reference;
    if (!ref || !ref.messageId) return null;

    let repliedAuthor = null;
    try {
      const replied = msg.mentions?.repliedUser;
      if (replied?.id) {
        const resolved = userMap?.get(replied.id);
        repliedAuthor = {
          id: safe(replied.id),
          name: safe(replied.username),
          displayName: resolved?.displayName || resolved?.username || safe(replied.displayName || replied.username, 'Unknown User'),
        };
      }
    } catch {
      // ignore
    }

    return {
      referencedMessageId: safe(ref.messageId),
      author: repliedAuthor,
    };
  })();

  return {
    timestamp: msg.createdAt ? msg.createdAt.toISOString() : null,
    author: {
      id: author.id,
      name: author.name,
      displayName: authorDisplay,
    },
    content: contentResolved,
    attachments,
    embeds,
    reactions,
    reply,
  };
}

// ─────────────────────────────
// Output Formatters
// ─────────────────────────────

function messagesToTxt(messages, channel) {
  const header = `Transcript for #${safe(channel?.name)} (${messages.length} messages)`;
  const exportedAt = `Exported: ${new Date().toISOString()}`;
  const lines = [header, exportedAt, ''];

  for (const m of messages) {
    const ts = m.timestamp ? formatTimestamp(m.timestamp) : '';
    const author = safe(m.author?.displayName, 'Unknown User');
    
    lines.push(`[${ts}] ${author}:`);

    const content = safe(m.content, '(no text)');
    lines.push(content);

    const attachmentUrls = (m.attachments || []).map((a) => safe(a?.url)).filter(Boolean);
    if (attachmentUrls.length > 0) {
      lines.push(`Attachments: ${attachmentUrls.join(', ')}`);
    }

    const reactionsText = (m.reactions || []).map((r) => {
      const name = r?.emoji?.name || 'emoji';
      const count = safe(r?.count, 0);
      return `${name} x${count}`;
    }).join(', ');

    if (reactionsText) {
      lines.push(`Reactions: ${reactionsText}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function messagesToJson(messages, channel, guild) {
  return {
    meta: {
      exportedAt: new Date().toISOString(),
      guild: {
        id: safe(guild?.id),
        name: safe(guild?.name),
      },
      channel: {
        id: safe(channel?.id),
        name: safe(channel?.name),
      },
      messageCount: messages.length,
    },
    messages: messages.map((m) => ({
      timestamp: m.timestamp,
      author: {
        id: m.author?.id || '',
        name: m.author?.name || '',
        displayName: m.author?.displayName || 'Unknown User',
      },
      content: m.content || '',
      attachments: m.attachments || [],
      embeds: m.embeds || [],
      reactions: m.reactions || [],
      reply: m.reply ? {
        referencedMessageId: m.reply.referencedMessageId || null,
        author: m.reply.author ? {
          id: m.reply.author.id || '',
          name: m.reply.author.name || '',
          displayName: m.reply.author.displayName || 'Unknown User',
        } : null,
      } : null,
    })),
  };
}

// ─────────────────────────────
// Command
// ─────────────────────────────

module.exports = {
  name: "transcript",
  category: "dev",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('Export a Discord channel transcript (TXT or JSON)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild ? PermissionFlagsBits.ManageGuild : null)
    .addStringOption((opt) =>
      opt
        .setName('format')
        .setDescription('Export format (default: txt)')
        .addChoices(
          { name: 'TXT (default)', value: 'txt' },
          { name: 'JSON', value: 'json' },
        )
        .setRequired(false),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('max_messages')
        .setDescription('Maximum messages to export (default: 250000)')
        .setRequired(false),
    ),

  async execute(interaction) {
    // Optional owner-only gate
    try {
      const ownerOnly = config?.transcript?.ownerOnly;
      if (ownerOnly && !isOwner(interaction.user)) {
        return interaction.reply({ content: 'Not allowed.', flags: 64 });
      }
    } catch {
      // If gating fails, do not block
    }

    const format = interaction.options.getString('format') || 'txt';
    const maxMessages = interaction.options.getInteger('max_messages') || 250000;

    const channel = interaction.channel;
    if (!channel) {
      return interaction.reply({ content: 'No channel context found.', flags: 64 });
    }

    await interaction.reply({ content: 'Fetching messages…', flags: 64 });

    let messages = [];
    try {
      messages = await fetchAllMessages(channel, {
        limitPerRequest: 100,
        maxMessages,
        onProgress: async (count) => {
          if (count % 500 !== 0) return;
          try {
            await interaction.editReply({ content: `Fetching messages… (${count})` });
          } catch {
            // ignore
          }
        },
      });
    } catch (err) {
      return interaction.editReply({ content: 'Failed to fetch messages.' });
    }

    const userIds = collectUserIds(messages);

    let userMap;
    try {
      userMap = await buildUserMap(interaction.client, userIds);
    } catch {
      userMap = new Map();
    }

    const data = messages.map((m) => messageToDataset(m, { userMap }));

    let exportPayload;
    let fileName;

    if (format === 'json') {
      const jsonObj = messagesToJson(data, channel, interaction.guild);
      exportPayload = JSON.stringify(jsonObj, null, 2);
      fileName = `transcript-${channel.name}.json`;
    } else {
      exportPayload = messagesToTxt(data, channel);
      fileName = `transcript-${channel.name}.txt`;
    }

    const { AttachmentBuilder } = require('discord.js');
    const attachment = new AttachmentBuilder(Buffer.from(exportPayload, 'utf8'), fileName);

    const doneText = `Exported: ${fileName} (${data.length} messages)`;
    await interaction.editReply({ content: doneText, files: [attachment] });
  },
};

