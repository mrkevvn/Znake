'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isStaff } = require('../../utils/permissions');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "restoreroles",
  category: "moderation",
  default_member_permissions: "ManageRoles",
  data: new SlashCommandBuilder()
    .setName('restoreroles')
    .setDescription('Restore roles previously stripped with /stripperms.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The member to restore roles to')
        .setRequired(true)
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

    if (!target) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ User Not Found').setDescription('That member is not in this server.').setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }

    const stripped = db.read('stripped_roles');
    const entry = stripped[interaction.guild.id]?.[target.id];

    if (!entry) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.warningColor)
            .setTitle('⚠️ No Snapshot Found')
            .setDescription('No stripped role snapshot exists for this member.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    // Only restore roles that still exist and the bot can assign
    const botHighest = interaction.guild.members.me.roles.highest.position;
    const restorable = [];
    const missing = [];

    for (const roleId of entry.roles) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role && role.position < botHighest) {
        restorable.push(role);
      } else {
        missing.push(roleId);
      }
    }

    if (restorable.length > 0) {
      try {
        await target.roles.add(restorable, `[Restore Roles] by ${interaction.user.username}`);
      } catch (err) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Restore Failed')
              .setDescription(`Could not restore roles: ${err.message}`)
              .setTimestamp(),
          ],
        });
      }
    }

    // Clear the snapshot
    delete stripped[interaction.guild.id][target.id];
    db.write('stripped_roles', stripped);

    const tag = target.user.globalName || target.user.username;
    const roleNames = restorable.map(r => `\`${r.name}\``).join(', ') || 'None';

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.successColor)
          .setTitle('🔓 Roles Restored')
          .addFields(
            { name: 'User', value: `${tag} (<@${target.id}>)`, inline: true },
            { name: 'Roles Restored', value: `${restorable.length}`, inline: true },
            { name: 'Roles Skipped', value: `${missing.length} (deleted or too high)`, inline: true },
            { name: 'Restored Roles', value: roleNames.length <= 1024 ? roleNames : roleNames.substring(0, 1020) + '…', inline: false },
            { name: 'Restored by', value: `${interaction.user}`, inline: true },
            { name: 'Originally stripped by', value: entry.strippedByTag || 'Unknown', inline: true }
          )
          .setTimestamp(),
      ],
    });
  },
};
