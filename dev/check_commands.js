'use strict';
const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, '../commands');
const categories = fs.readdirSync(commandsPath);

const allCmds = [];

for (const category of categories) {
  const categoryPath = path.join(commandsPath, category);
  if (!fs.statSync(categoryPath).isDirectory()) continue;

  const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js') && f !== 'auditLogger.js');

  for (const file of files) {
    try {
      const command = require(path.join(categoryPath, file));
      allCmds.push({
        name: command.data?.name || command.name,
        category: category,
        description: command.data?.description || command.description || 'No description',
        filePath: path.join(category, file)
      });
    } catch (err) {
      console.error(`Error loading ${file}:`, err);
    }
  }
}

console.log(JSON.stringify(allCmds, null, 2));
