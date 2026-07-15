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
    if (!suggestion.votes.upVoters) suggestion.votes.upVoters = [];
    if (!suggestion.votes.downVoters) suggestion.votes.downVoters = [];

    if (emoji === '👍') {
      suggestion.votes.upVoters = suggestion.votes.upVoters.filter(id => id !== user.id);
      suggestion.votes.up = suggestion.votes.upVoters.length;
    }
    if (emoji === '👎') {
      suggestion.votes.downVoters = suggestion.votes.downVoters.filter(id => id !== user.id);
      suggestion.votes.down = suggestion.votes.downVoters.length;
    }

    suggestions[guildId][suggestion.id] = suggestion;
    db.write('suggestions', suggestions);
  },
};
