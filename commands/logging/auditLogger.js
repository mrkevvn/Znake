// Audit Logger — formatting utility for audit-grade logs
const { EmbedBuilder } = require('discord.js');
const db = require('../../utils/database');
const { generateCaseId } = require('../../utils/caseManager');
const config = require('../../config.json');

const COLOR_MAP = {
  BAN: '#E04040',
  KICK: '#E6A23C',
  WARN: '#FEE75C',
  TIMEOUT: '#EB459E',
  MUTE: '#EB459E',
  UNMUTE: '#2ECC71',
  LOCK: '#4682B4',
  UNLOCK: '#57F287',
  SLOWMODE: '#1E90FF',
  CLEAR: '#8E44AD',
  NICKNAME: '#008080',
  'ROLE UPDATE': '#A569BD',
  EMBED_DM: '#5865F2'
};

function truncate(str, max = 1024) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 3) + '...' : str;
}

function displayName(user) {
  if (!user) return 'Unknown';
  return user.globalName || user.username || user.tag || 'Unknown';
}

/**
 * Formats a value change as Before -> After
 */
function formatChange(before, after) {
  if (before === undefined || before === null) before = 'None';
  if (after === undefined || after === null) after = 'None';
  return `\`${before}\` ➔ \`${after}\``;
}

/**
 * Builds an audit log embed and ensures case tracking
 */
function buildAuditEmbed(client, guild, action, target, moderator, reason, extra = {}) {
  const cleanAction = action.toUpperCase();
  const color = COLOR_MAP[cleanAction] || config.embedColor || '#5865F2';

  // Ensure case ID is retrieved or created
  let caseId = extra.caseId || extra.warnId;
  if (!caseId && ['BAN', 'KICK', 'WARN', 'TIMEOUT', 'MUTE', 'UNMUTE', 'EMBED_DM'].includes(cleanAction)) {
    caseId = generateCaseId();
    // Save to database
    try {
      const cases = db.read('cases') || {};
      cases[caseId] = {
        caseId,
        type: cleanAction.toLowerCase(),
        guildId: guild.id,
        reporterId: moderator ? moderator.id : client.user.id,
        reportedUserId: target ? target.id : null,
        moderatorId: moderator ? moderator.id : client.user.id,
        status: 'Resolved',
        reason: reason || 'No reason provided',
        createdAt: Date.now(),
        resolvedAt: Date.now(),
        timeline: [{ event: `${cleanAction} Logged`, timestamp: Date.now() }]
      };
      db.write('cases', cases);
    } catch (err) {
      console.error(`Error saving auto-generated case: ${err.message}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`AUDIT LOG • ${cleanAction}`)
    .setTimestamp();

  // Add Target User (clearly labeled)
  if (target) {
    const targetTag = target.user ? target.user.tag : (target.tag || target.name || target.id);
    const targetId = target.id || 'N/A';
    embed.addFields({ name: '👤 Target User', value: `**${targetTag}** (\`${targetId}\`)`, inline: true });
  }

  // Add Moderator (clearly labeled)
  if (moderator) {
    embed.addFields({ name: '👮 Moderator', value: `**${displayName(moderator)}** (\`${moderator.id}\`)`, inline: true });
  }

  // Add Case ID if available
  if (caseId) {
    embed.addFields({ name: '🔖 Case ID', value: `\`${caseId}\``, inline: true });
  }

  // Add Reason
  embed.addFields({ name: '📝 Reason', value: truncate(reason || 'No reason provided'), inline: false });

  // Add Before -> After or extra fields if present
  if (extra.before !== undefined || extra.after !== undefined) {
    embed.addFields({ name: '🔄 Changes', value: formatChange(extra.before, extra.after), inline: false });
  }

  if (extra.duration) {
    embed.addFields({ name: '⏱️ Duration', value: extra.duration, inline: true });
  }

  if (extra.delivered !== undefined) {
    embed.addFields({ name: '📬 Delivered', value: extra.delivered ? '✅ Yes' : '❌ No', inline: true });
  }

  // Add footer containing bot + server identity
  embed.setFooter({
    text: `${client.user.username} • ${guild.name} (${guild.id})`,
    iconURL: client.user.displayAvatarURL()
  });

  return embed;
}

module.exports = {
  name: "auditLogger",
  category: "moderation",
  default_member_permissions: "ManageGuild", buildAuditEmbed, COLOR_MAP };
