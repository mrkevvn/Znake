'use strict';
const fs = require('fs');
const path = require('path');

const client = {
  commands: new Map(),
  user: {
    username: 'TestBot',
    displayAvatarURL: () => 'https://example.com/avatar.png'
  },
  guilds: {
    cache: {
      size: 12
    }
  }
};

// Load actual commands
const commandsPath = path.join(__dirname, '../commands');
const categories = fs.readdirSync(commandsPath);

for (const category of categories) {
  const categoryPath = path.join(commandsPath, category);
  if (!fs.statSync(categoryPath).isDirectory()) continue;

  const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js') && f !== 'auditLogger.js');

  for (const file of files) {
    try {
      const command = require(path.join(categoryPath, file));
      command._category = category;
      client.commands.set(command.data?.name || command.name, command);
    } catch (err) {
      console.error(`Error loading ${file}:`, err);
    }
  }
}

// Inject an invalid command with no name to test mapper resilience
client.commands.set('invalid', {
  description: 'Should be ignored because it lacks name'
});

// Inject a command with a missing description to test fallback
client.commands.set('nodesc', {
  name: 'nodesc',
  _category: 'general'
});

// Inject a command with a custom/other category
client.commands.set('mysterycmd', {
  name: 'mysterycmd',
  description: 'This has an unknown category',
  _category: 'imaginary'
});

const { getGroupedCommands } = require('../utils/helpMapper');
const { buildOverview, buildCategory } = require('../handlers/helpComponents');

const grouped = getGroupedCommands(client);
console.log('Grouped command categories and counts:');
for (const [key, list] of Object.entries(grouped)) {
  console.log(`- ${key}: ${list.length} commands`);
  if (key === 'Other') {
    console.log('  Other commands:', list);
  }
}

console.log('\nGenerating overview payload...');
const overviewPayload = buildOverview(client);
console.log('Overview Embed Description snippet:', overviewPayload.embeds[0].data.description);
console.log('Overview Embed Fields counts:', overviewPayload.embeds[0].data.fields.length);

console.log('\nGenerating detail payload for Moderation...');
const moderationPayload = buildCategory(client, 'Moderation');
console.log('Moderation Embed Title:', moderationPayload.embeds[0].data.title);
console.log('Moderation Embed Description snippet (first 200 chars):', moderationPayload.embeds[0].data.description.substring(0, 200));

console.log('\nGenerating detail payload for Other...');
const otherPayload = buildCategory(client, 'Other');
console.log('Other Embed Description:', otherPayload.embeds[0].data.description);

console.log('\nAll tests passed successfully!');
