'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isStaff } = require('../../utils/permissions');
const { generateId } = require('../../utils/formatters');
const db = require('../../utils/database');
const config = require('../../config.json');

module.exports = {
  name: "note",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Manage private staff notes on a user.')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a private note to a user.')
        .addUserOption(opt => opt.setName('user').setDescription('The user to note').setRequired(true))
        .addStringOption(opt => opt.setName('content').setDescription('The note content').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('View all notes on a user.')
        .addUserOption(opt => opt.setName('user').setDescription('The user to view notes for').setRequired(false))
        .addStringOption(opt => opt.setName('userid').setDescription('User ID (if not in server)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a specific note by ID.')
        .addStringOption(opt => opt.setName('noteid').setDescription('The note ID to remove').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear all notes on a user.')
        .addUserOption(opt => opt.setName('user').setDescription('The user to clear notes for').setRequired(false))
        .addStringOption(opt => opt.setName('userid').setDescription('User ID (if not in server)').setRequired(false))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 3,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id) && !isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('🚫 Missing Permissions')
            .setDescription('You need a staff role to manage user notes.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const notes = db.read('notes');
    if (!notes[guildId]) notes[guildId] = {};

    // ── ADD ───────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const target = interaction.options.getUser('user');
      const content = interaction.options.getString('content');

      if (!notes[guildId][target.id]) notes[guildId][target.id] = [];

      const noteId = generateId(6);
      notes[guildId][target.id].push({
        id: noteId,
        content,
        addedBy: interaction.user.id,
        addedByTag: interaction.user.globalName || interaction.user.username,
        addedAt: Date.now(),
      });
      db.write('notes', notes);

      const tag = target.globalName || target.username;
      const total = notes[guildId][target.id].length;

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle('📝 Note Added')
            .addFields(
              { name: 'User', value: `${tag} (<@${target.id}>)`, inline: true },
              { name: 'Note ID', value: `\`${noteId}\``, inline: true },
              { name: 'Total Notes', value: `${total}`, inline: true },
              { name: 'Content', value: content, inline: false }
            )
            .setFooter({ text: 'This note is only visible to staff.' })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('userid')?.trim();

      if (!user && !rawId) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ No Target')
              .setDescription('Please provide a user or a user ID.')
              .setTimestamp(),
          ],
        });
      }

      if (!user) {
        try { user = await interaction.client.users.fetch(rawId); }
        catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ User Not Found').setDescription(`Could not find user \`${rawId}\`.`).setTimestamp()] }); }
      }

      const userNotes = notes[guildId]?.[user.id] || [];
      const tag = user.globalName || user.username;

      if (userNotes.length === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle(`📝 Notes — ${tag}`)
              .setDescription('No notes on record for this user.')
              .setTimestamp(),
          ],
        });
      }

      const lines = userNotes.map((n, i) =>
        `**${i + 1}.** \`${n.id}\` — ${n.content}\n> By **${n.addedByTag || 'Unknown'}** • <t:${Math.floor(n.addedAt / 1000)}:R>`
      );

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle(`📝 Notes — ${tag}`)
            .setDescription(lines.join('\n\n'))
            .addFields(
              { name: 'User', value: `<@${user.id}> (\`${user.id}\`)`, inline: true },
              { name: 'Total Notes', value: `${userNotes.length}`, inline: true }
            )
            .setFooter({ text: 'Staff-only — not visible to the user.' })
            .setTimestamp(),
        ],
      });
    }

    // ── REMOVE ────────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const noteId = interaction.options.getString('noteid').trim();
      let found = false;

      for (const userId of Object.keys(notes[guildId])) {
        const idx = notes[guildId][userId].findIndex(n => n.id === noteId);
        if (idx !== -1) {
          notes[guildId][userId].splice(idx, 1);
          if (notes[guildId][userId].length === 0) delete notes[guildId][userId];
          db.write('notes', notes);
          found = true;

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(config.successColor)
                .setTitle('🗑️ Note Removed')
                .setDescription(`Note \`${noteId}\` has been deleted.`)
                .addFields({ name: 'Removed by', value: `${interaction.user}`, inline: true })
                .setTimestamp(),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (!found) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ Note Not Found')
              .setDescription(`No note with ID \`${noteId}\` exists in this server.`)
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // ── CLEAR ─────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('userid')?.trim();

      if (!user && !rawId) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ No Target')
              .setDescription('Please provide a user or a user ID.')
              .setTimestamp(),
          ],
        });
      }

      if (!user) {
        try { user = await interaction.client.users.fetch(rawId); }
        catch { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(config.errorColor).setTitle('❌ User Not Found').setDescription(`Could not find user \`${rawId}\`.`).setTimestamp()] }); }
      }

      const count = notes[guildId]?.[user.id]?.length || 0;
      if (count === 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setTitle('📝 No Notes to Clear')
              .setDescription('That user has no notes on record.')
              .setTimestamp(),
          ],
        });
      }

      delete notes[guildId][user.id];
      db.write('notes', notes);

      const tag = user.globalName || user.username;
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.successColor)
            .setTitle('🗑️ Notes Cleared')
            .setDescription(`Removed all **${count}** note${count !== 1 ? 's' : ''} from **${tag}**.`)
            .addFields({ name: 'Cleared by', value: `${interaction.user}`, inline: true })
            .setTimestamp(),
        ],
      });
    }
  },
};
