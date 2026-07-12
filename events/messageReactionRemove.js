'use strict';

// Message Reaction Remove - decrements suggestion vote counts when reactions are removed
const db = require('../utils/database');

module.exports = {
  name: 'messageReactionRemove',
  once: false,
  async execute(client, reaction, user) {
    if (user.bot) return;

    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch(); } catch { return; }
    }

    const { message } = reaction;
    if (!message.guild) return;

    const emoji = reaction.emoji.name;
    if (emoji !== '👍' && emoji !== '👎') return;

    const guildId       = message.guild.id;
    const suggestions   = db.read('suggestions');
    const guildSugs     = suggestions[guildId] ?? {};
    const suggestion    = Object.values(guildSugs)
      .find(s => s.messageId === message.id && s.status === 'pending');

    if (!suggestion) return;

    if (!suggestion.votes) suggestion.votes = { up: 0, down: 0 };

    if (emoji === '👍') suggestion.votes.up   = Math.max(0, suggestion.votes.up   - 1);
    if (emoji === '👎') suggestion.votes.down = Math.max(0, suggestion.votes.down - 1);

    suggestions[guildId][suggestion.id] = suggestion;
    db.write('suggestions', suggestions);
  },
};
