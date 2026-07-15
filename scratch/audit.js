const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, '../commands');
const categories = fs.readdirSync(commandsPath);

const foundNames = new Map();
const errors = [];

for (const category of categories) {
  const categoryPath = path.join(commandsPath, category);
  if (!fs.statSync(categoryPath).isDirectory()) continue;

  const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const fullPath = path.join(categoryPath, file);
    try {
      const command = require(fullPath);
      if (!command.data) {
        errors.push({ file: `${category}/${file}`, reason: 'Missing "data" property' });
        continue;
      }
      if (!command.execute) {
        errors.push({ file: `${category}/${file}`, reason: 'Missing "execute" property' });
        continue;
      }
      const name = command.data.name;
      if (!name) {
        errors.push({ file: `${category}/${file}`, reason: 'Command data has no name' });
        continue;
      }
      if (foundNames.has(name)) {
        errors.push({ file: `${category}/${file}`, reason: `Duplicate command name "${name}" (first loaded in ${foundNames.get(name)})` });
      } else {
        foundNames.set(name, `${category}/${file}`);
      }
    } catch (err) {
      errors.push({ file: `${category}/${file}`, reason: `Failed to load: ${err.message}`, stack: err.stack });
    }
  }
}

console.log('--- AUDIT RESULTS ---');
console.log(`Successfully checked ${foundNames.size} unique commands.`);
if (errors.length > 0) {
  console.log(`Found ${errors.length} error(s):`);
  console.log(JSON.stringify(errors, null, 2));
} else {
  console.log('No command file errors found!');
}
