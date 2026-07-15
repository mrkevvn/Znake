'use strict';

const {
  MessageFlags, SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { isOwner }      = require('../../utils/isOwner');
const { logDevAction } = require('../../utils/devLogger');
const db               = require('../../utils/database');
const config           = require('../../config.json');

function ownerOnlyEmbed(client, userId) {
  return new EmbedBuilder()
    .setColor('#ED4245')
    .setAuthor({ name: '🔒  Developer Console  ·  Access Denied', iconURL: client.user.displayAvatarURL({ size: 64 }) })
    .setTitle('Unauthorized')
    .setDescription('Whitelist management is restricted to **bot owners** only.')
    .addFields(
      { name: '🔑 Required Access', value: 'Bot Owner only', inline: true },
      { name: '🆔 Your User ID',    value: `\`${userId}\``,  inline: true },
    )
    .setFooter({ text: 'Contact the bot owner if you believe this is an error.' })
    .setTimestamp();
}

module.exports = {
  name: "whitelist",
  category: "dev",
  ownerOnly: true,
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('[Dev] Manage the developer command whitelist.')

    .addSubcommand(s =>
      s.setName('add').setDescription('Grant a user access to developer commands.')
        .addStringOption(o => o.setName('userid').setDescription('Discord user ID to whitelist').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('remove').setDescription('Revoke a user\'s developer command access.')
        .addStringOption(o => o.setName('userid').setDescription('Discord user ID to remove').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('check').setDescription('Check whether a specific user is whitelisted.')
        .addStringOption(o => o.setName('userid').setDescription('Discord user ID to check').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('view').setDescription('View all users currently on the developer whitelist.')
    )
    .addSubcommand(s =>
      s.setName('clear').setDescription('⚠️ Wipe the entire developer whitelist.')
    ),

  async execute(interaction) {
    const { client, user } = interaction;

    if (!isOwner(user.id)) {
      await logDevAction({ interaction, command: 'dev whitelist', status: 'FAILED', details: 'Unauthorized access attempt', target: null });
      return interaction.reply({ embeds: [ownerOnlyEmbed(client, user.id)], flags: MessageFlags.Ephemeral });
    }

    const sub  = interaction.options.getSubcommand();
    const data = db.read('whitelist');
    if (!data.users) data.users = [];

    // ── ADD ───────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const userId = interaction.options.getString('userid').trim();

      if (isOwner(userId)) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Add', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('⚠️  Already a Bot Owner')
              .setDescription(`<@${userId}> (\`${userId}\`) is a **bot owner** and already has full developer access.\nWhitelisting is not necessary.`)
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (data.users.includes(userId)) {
        await logDevAction({ interaction, command: 'dev whitelist add', status: 'FAILED', details: 'Already whitelisted', target: userId });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Add', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('⚠️  Already Whitelisted')
              .setDescription(`<@${userId}> (\`${userId}\`) already has developer access.`)
              .setFooter({ text: 'Use /whitelist remove to revoke their access.' })
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Fetch tag for display
      let tag = `\`${userId}\``;
      try { const u = await client.users.fetch(userId); tag = `**${u.globalName ?? u.username}**`; } catch { /* unknown user */ }

      data.users.push(userId);
      db.write('whitelist', data);
      await logDevAction({ interaction, command: 'dev whitelist add', status: 'SUCCESS', details: `${userId} added to whitelist`, target: userId });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#57F287')
            .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Access Granted', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle('✅  Developer Access Granted')
            .addFields(
              { name: '👤 User',         value: `${tag}  (<@${userId}>)`,      inline: false },
              { name: '🆔 User ID',      value: `\`${userId}\``,               inline: true  },
              { name: '🔑 Access Level', value: 'Whitelisted Developer',        inline: true  },
              { name: '👮 Granted By',   value: `${user}  (\`${user.id}\`)`,   inline: true  },
            )
            .setFooter({ text: `Whitelist now has ${data.users.length} user${data.users.length !== 1 ? 's' : ''}  ·  Use /whitelist remove to revoke access.` })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── REMOVE ────────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const userId = interaction.options.getString('userid').trim();

      if (!data.users.includes(userId)) {
        await logDevAction({ interaction, command: 'dev whitelist remove', status: 'FAILED', details: 'Not whitelisted', target: userId });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Remove', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('⚠️  Not Whitelisted')
              .setDescription(`<@${userId}> (\`${userId}\`) is not on the developer whitelist.`)
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      let tag = `\`${userId}\``;
      try { const u = await client.users.fetch(userId); tag = `**${u.globalName ?? u.username}**`; } catch { /* unknown user */ }

      data.users = data.users.filter(id => id !== userId);
      db.write('whitelist', data);
      await logDevAction({ interaction, command: 'dev whitelist remove', status: 'SUCCESS', details: `${userId} removed from whitelist`, target: userId });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#ED4245')
            .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Access Revoked', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle('❌  Developer Access Revoked')
            .addFields(
              { name: '👤 User',         value: `${tag}  (<@${userId}>)`,     inline: false },
              { name: '🆔 User ID',      value: `\`${userId}\``,              inline: true  },
              { name: '🔑 Access',       value: 'Removed',                    inline: true  },
              { name: '👮 Revoked By',   value: `${user}  (\`${user.id}\`)`,  inline: true  },
            )
            .setFooter({ text: 'This user can no longer use developer commands.' })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── CHECK ─────────────────────────────────────────────────────────────────
    if (sub === 'check') {
      const userId = interaction.options.getString('userid').trim();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let tag    = null;
      let avatar = null;
      try {
        const u = await client.users.fetch(userId);
        tag    = u.globalName ?? u.username;
        avatar = u.displayAvatarURL({ size: 64 });
      } catch { /* unknown user */ }

      const whitelisted = data.users.includes(userId);
      const owner       = isOwner(userId);
      const hasAccess   = whitelisted || owner;

      const accessLabel = owner
        ? '👑 Bot Owner (full access)'
        : whitelisted
          ? '✅ Whitelisted Developer'
          : '❌ No Developer Access';

      await logDevAction({ interaction, command: 'dev whitelist check', status: 'SUCCESS', details: `Checked ${userId} — ${hasAccess ? 'has access' : 'no access'}`, target: userId });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(hasAccess ? '#57F287' : '#4F545C')
            .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Check', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle(`${hasAccess ? '🔓' : '🔒'}  ${tag ?? 'Unknown User'}`)
            .setThumbnail(avatar)
            .addFields(
              { name: '👤 User',        value: tag ? `**${tag}**  (<@${userId}>)` : `<@${userId}>`, inline: false },
              { name: '🆔 User ID',     value: `\`${userId}\``,                                     inline: true  },
              { name: '🔑 Access',      value: accessLabel,                                          inline: true  },
            )
            .setFooter({ text: 'Developer Whitelist System' })
            .setTimestamp(),
        ],
      });
    }

    // ── VIEW ──────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const owners = (config.owners ?? []);

      if (data.users.length === 0 && owners.length === 0) {
        await logDevAction({ interaction, command: 'dev whitelist view', status: 'SUCCESS', details: 'Viewed — empty', target: null });
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — View', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('📋  Developer Whitelist')
              .setDescription('No users are currently whitelisted.\nBot owner IDs are configured in `config.json`.')
              .setFooter({ text: 'Use /whitelist add to grant developer access.' })
              .setTimestamp(),
          ],
        });
      }

      // Build owner rows
      const ownerLines = [];
      for (const ownerId of owners) {
        try {
          const u = await client.users.fetch(ownerId);
          ownerLines.push(`👑 **${u.globalName ?? u.username}**  ·  \`${ownerId}\``);
        } catch {
          ownerLines.push(`👑 *Unknown*  ·  \`${ownerId}\``);
        }
      }

      // Build whitelist rows
      const wlLines = [];
      for (const [i, userId] of data.users.entries()) {
        try {
          const u = await client.users.fetch(userId);
          wlLines.push(`\`${i + 1}.\`  **${u.globalName ?? u.username}**  ·  \`${userId}\`  (<@${userId}>)`);
        } catch {
          wlLines.push(`\`${i + 1}.\`  *Unknown User*  ·  \`${userId}\``);
        }
      }

      await logDevAction({ interaction, command: 'dev whitelist view', status: 'SUCCESS', details: `Viewed — ${data.users.length} whitelisted`, target: null });

      const embed = new EmbedBuilder()
        .setColor(config.infoColor)
        .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — View All', iconURL: client.user.displayAvatarURL({ size: 64 }) })
        .setTitle('📋  Developer Access List')
        .setFooter({ text: 'Use /whitelist add or /whitelist remove to manage access.' })
        .setTimestamp();

      if (ownerLines.length > 0) {
        embed.addFields({ name: '👑 Bot Owners  (config.json)', value: ownerLines.join('\n'), inline: false });
      }

      if (wlLines.length > 0) {
        embed.addFields({ name: `🔑 Whitelisted Developers  (${data.users.length})`, value: wlLines.join('\n'), inline: false });
      } else {
        embed.addFields({ name: '🔑 Whitelisted Developers', value: '*None — use `/whitelist add` to grant access.*', inline: false });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── CLEAR ─────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const count = data.users.length;

      if (count === 0) {
        await logDevAction({ interaction, command: 'dev whitelist clear', status: 'FAILED', details: 'Already empty', target: null });
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Clear', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('📋  Whitelist Already Empty')
              .setDescription('There are no whitelisted users to remove.')
              .setTimestamp(),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Confirmation buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('wl_clear_confirm')
          .setLabel(`Confirm — remove all ${count} user${count !== 1 ? 's' : ''}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('wl_clear_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#FEE75C')
            .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Clear', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle('⚠️  Confirm Whitelist Clear')
            .setDescription(
              `You are about to remove **${count} user${count !== 1 ? 's' : ''}** from the developer whitelist.\n\n` +
              `This action **cannot be undone**. Bot owners are unaffected.`
            )
            .setFooter({ text: 'This prompt expires in 30 seconds.' })
            .setTimestamp(),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });

      let btn;
      try {
        btn = await interaction.channel.awaitMessageComponent({
          filter: i => i.user.id === user.id && ['wl_clear_confirm', 'wl_clear_cancel'].includes(i.customId),
          time:   30_000,
        });
      } catch {
        await logDevAction({ interaction, command: 'dev whitelist clear', status: 'FAILED', details: 'Confirmation timed out', target: null });
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Clear', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('⏱️  Timed Out')
              .setDescription('No response within 30 seconds — whitelist clear cancelled.')
              .setTimestamp(),
          ],
          components: [],
        });
      }

      if (btn.customId === 'wl_clear_cancel') {
        await logDevAction({ interaction, command: 'dev whitelist clear', status: 'FAILED', details: 'Cancelled by user', target: null });
        return btn.update({
          embeds: [
            new EmbedBuilder()
              .setColor(config.infoColor)
              .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Clear', iconURL: client.user.displayAvatarURL({ size: 64 }) })
              .setTitle('🚫  Cancelled')
              .setDescription('Whitelist clear was cancelled. No changes were made.')
              .setTimestamp(),
          ],
          components: [],
        });
      }

      db.write('whitelist', { users: [] });
      await logDevAction({ interaction, command: 'dev whitelist clear', status: 'SUCCESS', details: `Cleared ${count} user${count !== 1 ? 's' : ''}`, target: null });

      return btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor('#ED4245')
            .setAuthor({ name: '🔑  Developer Console  ·  Whitelist — Cleared', iconURL: client.user.displayAvatarURL({ size: 64 }) })
            .setTitle('🗑️  Whitelist Cleared')
            .setDescription(`All **${count} user${count !== 1 ? 's' : ''}** have been removed from the developer whitelist.`)
            .addFields({ name: '👮 Cleared By', value: `${user}  (\`${user.id}\`)`, inline: true })
            .setFooter({ text: 'Use /whitelist add to grant developer access again.' })
            .setTimestamp(),
        ],
        components: [],
      });
    }
  },
};
