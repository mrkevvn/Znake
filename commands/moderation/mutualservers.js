'use strict';

const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isOwner } = require('../../utils/isOwner');
const { isStaff } = require('../../utils/permissions');
const config = require('../../config.json');

module.exports = {
  name: "mutualservers",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('mutualservers')
    .setDescription('Show which of the bot\'s servers a user is also a member of.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The member to look up')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('User ID (works for users not in this server)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 10,

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

    let user = interaction.options.getUser('user');
    const rawId = interaction.options.getString('userid')?.trim();

    if (!user && !rawId) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ No Target')
            .setDescription('Please provide a user or a user ID.')
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!user) {
      try {
        user = await interaction.client.users.fetch(rawId);
      } catch {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.errorColor)
              .setTitle('❌ User Not Found')
              .setDescription(`Could not find a Discord user with ID \`${rawId}\`.`)
              .setTimestamp(),
          ],
        });
      }
    }

    const tag = user.globalName || user.username;
    const mutualGuilds = [];

    for (const guild of interaction.client.guilds.cache.values()) {
      try {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (member) {
          const isCurrentGuild = guild.id === interaction.guild.id;
          const topRole = member.roles.highest.name === '@everyone' ? 'No roles' : member.roles.highest.name;
          mutualGuilds.push({
            name: guild.name,
            id: guild.id,
            memberCount: guild.memberCount,
            topRole,
            joinedAt: member.joinedTimestamp,
            current: isCurrentGuild,
          });
        }
      } catch { /* no access */ }
    }

    if (mutualGuilds.length === 0) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.infoColor)
            .setTitle(`🌐 Mutual Servers — ${tag}`)
            .setDescription('This user is not a member of any server the bot is in.')
            .setTimestamp(),
        ],
      });
    }

    mutualGuilds.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));

    const lines = mutualGuilds.map(g =>
      `${g.current ? '📍 ' : ''}**${g.name}** (\`${g.id}\`)\n` +
      `> Members: ${g.memberCount.toLocaleString()} • Top role: ${g.topRole}\n` +
      `> Joined: ${g.joinedAt ? `<t:${Math.floor(g.joinedAt / 1000)}:R>` : 'Unknown'}`
    );

    const embed = new EmbedBuilder()
      .setColor(config.infoColor)
      .setTitle(`🌐 Mutual Servers — ${tag}`)
      .setDescription(lines.join('\n\n'))
      .addFields(
        { name: 'User', value: `<@${user.id}> (\`${user.id}\`)`, inline: true },
        { name: 'Mutual Servers', value: `${mutualGuilds.length}`, inline: true }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: '📍 = current server' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
