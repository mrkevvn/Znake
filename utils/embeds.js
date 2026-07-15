// Embed utility - pre-built embed templates for consistent styling
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

function success(title, description) {
  return new EmbedBuilder()
    .setColor(config.successColor)
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function error(title, description) {
  return new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function warning(title, description) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function info(title, description) {
  return new EmbedBuilder()
    .setColor(config.infoColor)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function moderation(action, target, moderator, reason, extra = {}) {
  const targetName = target.globalName || target.username;
  const modName = moderator.globalName || moderator.username;

  const embed = new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle(`🔨 ${action}`)
    .addFields(
      { name: 'User', value: `${targetName} (${target.id})`, inline: true },
      { name: 'Moderator', value: modName, inline: true },
      { name: 'Reason', value: reason || 'No reason provided', inline: false }
    )
    .setTimestamp();

  if (extra.duration) embed.addFields({ name: 'Duration', value: extra.duration, inline: true });
  if (extra.warnId) embed.addFields({ name: 'Warning ID', value: extra.warnId, inline: true });

  return embed;
}

function cooldown(remaining) {
  return new EmbedBuilder()
    .setColor(config.warningColor)
    .setTitle('⏱️ Cooldown')
    .setDescription(`Please wait **${remaining}** second(s) before using this command again.`)
    .setTimestamp();
}

function noPermission(required) {
  return new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle('🚫 Missing Permissions')
    .setDescription(`You need the **${required}** permission to use this command.`)
    .setTimestamp();
}

function staffOnly() {
  return new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle('🚫 Staff Only')
    .setDescription('This command requires a configured staff role. Contact an administrator.')
    .setTimestamp();
}

module.exports = { success, error, warning, info, moderation, cooldown, noPermission, staffOnly };
