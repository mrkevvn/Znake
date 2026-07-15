// Permission utility - checks user/bot permissions and staff roles
const { PermissionFlagsBits } = require('discord.js');
const db = require('./database');

/**
 * Check if a member has a required Discord permission
 * @param {GuildMember} member
 * @param {bigint} permission - PermissionFlagsBits value
 */
function hasPermission(member, permission) {
  return member.permissions.has(permission);
}

/**
 * Check if a member is a bot administrator (has Administrator permission)
 */
function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Check if a member has a configured staff role for the guild
 * @param {GuildMember} member
 * @param {string} guildId
 */
function isStaff(member, guildId) {
  // Admins are always staff
  if (isAdmin(member)) return true;

  const staffDb = db.read('staff_roles');
  const guildStaffRoles = staffDb[guildId];
  if (!guildStaffRoles || guildStaffRoles.length === 0) return false;

  // Exact role ID match
  if (member.roles.cache.some(role => guildStaffRoles.includes(role.id))) return true;

  // Hierarchy check: if member's highest role is at or above the lowest staff role, treat as staff
  const staffRolePositions = guildStaffRoles
    .map(id => member.guild.roles.cache.get(id)?.position)
    .filter(pos => pos !== undefined);

  if (staffRolePositions.length === 0) return false;

  const lowestStaffPos = Math.min(...staffRolePositions);
  return member.roles.cache.some(role => role.position >= lowestStaffPos);
}

/**
 * Check if a bot has a required permission in a channel
 * @param {GuildChannel} channel
 * @param {bigint} permission
 */
function botHasPermission(channel, permission) {
  return channel.permissionsFor(channel.guild.members.me).has(permission);
}

/**
 * Check role hierarchy - returns true if member's top role is above target's top role
 */
function canModerate(moderator, target) {
  if (target.id === target.guild.ownerId) return false;
  return moderator.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

module.exports = { hasPermission, isAdmin, isStaff, botHasPermission, canModerate };
