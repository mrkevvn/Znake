'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const { discordTimestamp } = require('../../utils/formatters');

// Only display permissions that are meaningful — skip trivial ones
const KEY_PERMS = {
  Administrator:             '👑 Administrator',
  ManageGuild:               '⚙️ Manage Server',
  ManageChannels:            '📺 Manage Channels',
  ManageRoles:               '🏷️ Manage Roles',
  ManageMessages:            '🗑️ Manage Messages',
  ManageNicknames:           '✏️ Manage Nicknames',
  ManageWebhooks:            '🪝 Manage Webhooks',
  ManageEmojisAndStickers:   '😀 Manage Emojis',
  ManageEvents:              '📅 Manage Events',
  ManageThreads:             '🧵 Manage Threads',
  KickMembers:               '👢 Kick Members',
  BanMembers:                '🔨 Ban Members',
  ModerateMembers:           '⏱️ Timeout Members',
  MentionEveryone:           '📣 Mention Everyone',
  ViewAuditLog:              '📋 View Audit Log',
  MuteMembers:               '🔇 Mute Members (Voice)',
  DeafenMembers:             '🔕 Deafen Members',
  MoveMembers:               '🚚 Move Members',
  PrioritySpeaker:           '🎤 Priority Speaker',
};

module.exports = {
  name: "roleinfo",
  category: "user",
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('View detailed information about a role.')
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role to inspect')
        .setRequired(true)
    ),
  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const role = interaction.options.getRole('role');

    let memberCount = 0;
    try {
      await interaction.guild.members.fetch();
      memberCount = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
    } catch {
      memberCount = 0;
    }

    // Identify key elevated permissions this role has
    const permArray = role.permissions.toArray();
    const elevatedPerms = permArray
      .filter(p => KEY_PERMS[p])
      .map(p => KEY_PERMS[p]);

    const permsDisplay = elevatedPerms.length > 0
      ? elevatedPerms.join('\n')
      : '✅ No elevated permissions';

    // Role icon (if available)
    const iconUrl = role.iconURL?.() ?? null;

    const hexColor = role.hexColor === '#000000' ? 'Default' : role.hexColor;
    const separator = '─'.repeat(32);

    const embed = new EmbedBuilder()
      .setColor(role.color || config.embedColor || '#5865F2')
      .setAuthor({ name: '🏷️  Role Info' })
      .setTitle(role.name)
      .setDescription(`\`${separator}\``)
      .addFields(
        { name: '🆔 Role ID',       value: `\`${role.id}\``,                           inline: true },
        { name: '🎨 Color',         value: hexColor,                                    inline: true },
        { name: '📅 Created',       value: discordTimestamp(role.createdAt, 'R'),       inline: true },
        { name: '👥 Members',       value: `${memberCount}`,                            inline: true },
        { name: '📌 Position',      value: `${role.position} of ${interaction.guild.roles.cache.size - 1}`, inline: true },
        { name: '🔔 Mentionable',   value: role.mentionable ? '✅ Yes' : '❌ No',       inline: true },
        { name: '📌 Hoisted',       value: role.hoist ? '✅ Yes' : '❌ No',             inline: true },
        { name: '🤖 Bot/Managed',   value: role.managed ? '✅ Yes' : '❌ No',           inline: true },
        { name: '🔵 Mentionable',   value: `<@&${role.id}>`,                            inline: true },
        {
          name: `🔑 Elevated Permissions (${elevatedPerms.length})`,
          value: permsDisplay.slice(0, 1024),
          inline: false,
        },
      )
      .setFooter({
        text: `Requested by ${interaction.user.username}  •  ${permArray.length} total permissions`,
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
      })
      .setTimestamp();

    if (iconUrl) embed.setThumbnail(iconUrl);

    await interaction.editReply({ embeds: [embed] });
  },
};
