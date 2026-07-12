'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isStaff, canModerate } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "stripperms",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('stripperms')
    .setDescription('Remove all roles from a user instantly.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The member to strip roles from')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason for stripping roles')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id) && !isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need a staff role to use this command.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ User Not Found').setDescription('That member is not in this server.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (target.id === interaction.user.id) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Invalid Target').setDescription('You cannot strip your own roles.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!canModerate(interaction.member, target)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ Role Hierarchy').setDescription('Your role is not high enough to strip this member\'s roles.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Collect removable roles (exclude @everyone and roles above the bot)
    const botHighest = interaction.guild.members.me.roles.highest.position;
    const removable = target.roles.cache.filter(r =>
      r.id !== interaction.guild.id && r.position < botHighest
    );

    if (removable.size === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('⚠️ No Roles to Remove')
            .setDescription('This member has no roles the bot can remove.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    // Snapshot role names before removal for the embed
    const roleNames = removable.map(r => `\`${r.name}\``).join(', ');

    try {
      await target.roles.remove(removable, `[Strip Perms] ${interaction.user.username}: ${reason}`);
    } catch (err) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Failed')
            .setDescription(`Could not remove roles: ${err.message}`)
            .setTimestamp(),
        ],
      });
    }

    // Save the stripped roles so they can be restored later
    const stripped = db.read('stripped_roles');
    if (!stripped[interaction.guild.id]) stripped[interaction.guild.id] = {};
    stripped[interaction.guild.id][target.id] = {
      roles: removable.map(r => r.id),
      strippedBy: interaction.user.id,
      strippedByTag: interaction.user.globalName || interaction.user.username,
      strippedAt: Date.now(),
      reason,
    };
    db.write('stripped_roles', stripped);

    const tag = target.user.globalName || target.user.username;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.errorColor)
          .setTitle('🔐 Roles Stripped')
          .addFields(
            { name: 'User', value: `${tag} (<@${target.id}>)`, inline: true },
            { name: 'Roles Removed', value: `${removable.size}`, inline: true },
            { name: 'Reason', value: reason, inline: false },
            { name: 'Removed Roles', value: roleNames.length <= 1024 ? roleNames : roleNames.substring(0, 1020) + '…', inline: false },
            { name: 'Stripped by', value: `${interaction.user}`, inline: true }
          )
          .setFooter({ text: 'Use /restoreroles to give their roles back.' })
          .setTimestamp(),
      ],
    });

    await logModerationAction(interaction.client, interaction.guild, 'NICKNAME', target.user, interaction.user, `[Strip Perms] Removed ${removable.size} role(s). ${reason}`);
  },
};
