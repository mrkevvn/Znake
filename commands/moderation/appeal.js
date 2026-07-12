// /appeal — Submit a punishment appeal; creates a tracked appeal case and optionally links to ban case
const { MessageFlags, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const db = require('../../utils/database');
const logger = require('../../utils/logger');
const {
  generateCaseId,
  addTimeline,
  logAction,
  buildCaseEmbed,
  getCaseById,
} = require('../../utils/caseManager');

const PUNISHMENT_TYPES = ['Ban', 'Timeout', 'Kick', 'Warning', 'Mute', 'Other'];

async function createAppealCaseChannel(guild, caseId) {
  const staffRoles = db.read('staff_roles')[guild.id] || [];
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
    },
  ];

  for (const roleId of staffRoles) {
    if (!guild.roles.cache.has(roleId)) continue;
    overwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channelName = `appeal-${caseId.replace(/^CASE-/, '')}`;
  const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'appeals');
  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
  };

  if (category) {
    channelOptions.parent = category.id;
  } else {
    const botMember = guild.members.me;
    if (botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      try {
        const createdCategory = await guild.channels.create({ name: 'Appeals', type: ChannelType.GuildCategory });
        channelOptions.parent = createdCategory.id;
      } catch (err) {
        // Continue creating channel in the root if category creation fails.
      }
    }
  }

  return guild.channels.create(channelOptions);
}

function buildCloseAppealRow(caseId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal_close:${caseId}`)
      .setLabel('Close Appeal')
      .setStyle(ButtonStyle.Danger)
  );
}

function formatPermissionName(bit) {
  const labels = {
    [PermissionFlagsBits.ManageChannels]: 'Manage Channels',
    [PermissionFlagsBits.ViewChannel]: 'View Channel',
    [PermissionFlagsBits.SendMessages]: 'Send Messages',
    [PermissionFlagsBits.ManageMessages]: 'Manage Messages',
    [PermissionFlagsBits.EmbedLinks]: 'Embed Links',
  };
  return labels[bit] || bit;
}

function getMissingGuildPermissions(guild) {
  const botMember = guild.members?.me;
  if (!botMember) {
    return [
      'Manage Channels',
      'View Channel',
      'Send Messages',
      'Manage Messages',
    ];
  }

  const required = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageMessages,
  ];

  return required
    .filter(bit => !botMember.permissions.has(bit))
    .map(formatPermissionName);
}

function getMissingChannelPermissions(perms) {
  if (!perms) {
    return ['Send Messages', 'Embed Links'];
  }

  const required = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ];

  return required
    .filter(bit => !perms.has(bit))
    .map(formatPermissionName);
}

module.exports = {
  name: "appeal",
  category: "moderation",
  default_member_permissions: "ViewChannel",
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Appeal a punishment issued against you')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Type of punishment you are appealing')
        .setRequired(true)
        .addChoices(
          ...PUNISHMENT_TYPES.map(t => ({ name: t, value: t }))
        )
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Why should this punishment be removed or reduced?')
        .setMinLength(20)
        .setMaxLength(1000)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('caseid')
        .setDescription('Optional: Link this appeal to an existing case (e.g., your ban case)')
        .setRequired(false)
    ),
  cooldown: 60,

  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const punishmentType = interaction.options.getString('type');
    const reason = interaction.options.getString('reason').trim();
    const linkedCaseIdInput = interaction.options.getString('caseid')?.trim() || null;
    let guild = interaction.guild;
    const user = interaction.user;
    let guildId = guild?.id || null;

    let linkedBanCaseId = null;
    let linkedBanCaseData = null;

    // Check if case ID was provided and valid
    if (linkedCaseIdInput) {
      linkedBanCaseData = getCaseById(linkedCaseIdInput);
      if (!linkedBanCaseData) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(config.errorColor)
            .setTitle('❌ Case Not Found')
            .setDescription(`No case found for \`${linkedCaseIdInput}\`. Double-check the Case ID.`)
            .setTimestamp()],
        });
      }
      linkedBanCaseId = linkedBanCaseData.caseId;
    }

    const caseId = generateCaseId();
    const caseData = {
      caseId,
      type: 'appeal',
      guildId,
      userId: user.id,
      reporterId: user.id,
      reportedUserId: null,
      punishmentType,
      assignedStaffId: null,
      status: 'Open',
      reason,
      evidence: null,
      resolution: null,
      timeline: [],
      createdAt: Date.now(),
      resolvedAt: null,
      reportMessageId: null,
      reportChannelId: null,
      channelId: null,
      isFallbackChannel: false,
      linkedReportId: null,
      appealId: null,
      ticketId: null,
      moderatorId: null,
    };
    addTimeline(caseData, 'Appeal Created', user.id);

    if (linkedBanCaseId) {
      addTimeline(caseData, `Linked to ban case ${linkedBanCaseId}`, user.id);
      caseData.linkedReportId = linkedBanCaseId;
    }

    // If this was invoked in a DM (no guild), try to resolve target guild from linked case or recent ban cases
    if (!guild) {
      // Prefer an explicitly linked ban case
      if (linkedBanCaseData && linkedBanCaseData.guildId) {
        try {
          const resolved = client.guilds.cache.get(linkedBanCaseData.guildId) || await client.guilds.fetch(linkedBanCaseData.guildId).catch(() => null);
          if (resolved) {
            guild = resolved;
            guildId = guild.id;
          }
        } catch (err) {
          // Unable to resolve guild from linked case
        }
      }

      // Fall back: find a recent ban case for this user and use its guild
      if (!guild) {
        try {
          const allCases = db.read('cases');
          const recentBan = Object.values(allCases)
            .filter(c => c && c.type === 'ban' && c.reportedUserId === user.id)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
          if (recentBan && recentBan.guildId) {
            const resolved2 = client.guilds.cache.get(recentBan.guildId) || await client.guilds.fetch(recentBan.guildId).catch(() => null);
            if (resolved2) {
              guild = resolved2;
              guildId = guild.id;
              linkedBanCaseData = linkedBanCaseData || recentBan;
              linkedBanCaseId = linkedBanCaseId || recentBan.caseId;
            }
          }
        } catch (err) {
          // Unable to resolve guild from recent ban cases
        }
      }
    }

    // If we resolved a guild after a DM appeal, update the persisted guildId.
    caseData.guildId = guildId;

    let postedChannel = null;
    let channelError = null;

    if (guild) {
      let caseChannel = null;
      try {
        caseChannel = await createAppealCaseChannel(guild, caseId);
        if (caseChannel) {
          const embed = await buildCaseEmbed(caseData, guild, client);
          const msg = await caseChannel.send({ embeds: [embed], components: [buildCloseAppealRow(caseId)] }).catch(err => {
            logger.warn(`[Appeal] Created appeal case channel but failed to post embed. guildId=${guildId} userId=${user.id} channelId=${caseChannel.id} error=${err?.message ?? 'unknown'}`);
            return null;
          });
          caseData.channelId = caseChannel.id;
          caseData.isFallbackChannel = false;
          caseData.reportMessageId = msg ? msg.id : null;
          postedChannel = caseChannel;
        }
      } catch (err) {
        channelError = err;
        logger.error(`[Appeal] Appeal case channel creation failed. guildId=${guildId} userId=${user.id} caseId=${caseId} error=${err?.message ?? 'unknown'}`, err?.stack || err);
      }
    }

    if (!postedChannel) {
      logger.error(`[Appeal] All channel creation attempts failed. guildId=${guildId} userId=${user.id} channelError=${channelError?.message ?? 'none'}`);
      // Persist the case record so staff can still view it via dashboard or manual inspection
      const cases = db.read('cases');
      cases[caseId] = caseData;
      db.write('cases', cases);

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(config.warningColor)
          .setTitle('📋 Appeal Received')
          .setDescription('Your appeal was received, but I could not automatically create a visible channel in the server. Staff have been notified and will review your appeal.')
          .addFields({ name: '🔖 Case ID', value: `\`${caseId}\``, inline: true })
          .setTimestamp()],
      });

      logAction('CREATED_OFFLINE', caseId, user.id, 'Appeal created without channel', guildId);
      return;
    }

    const cases = db.read('cases');
    cases[caseId] = caseData;

    // Link to ban case if provided
    if (linkedBanCaseData) {
      linkedBanCaseData.appealId = caseId;
      addTimeline(linkedBanCaseData, `Appeal submitted: ${caseId}`, user.id);
      logAction('APPEAL_LINKED', linkedBanCaseId, user.id, `Appeal case: ${caseId}`, guildId);
    }

    db.write('cases', cases);
    logAction('CREATED', caseId, user.id, `Appeal — ${punishmentType}`, guildId);

    const fields = [
      { name: '🔖 Case ID', value: `\`${caseId}\``, inline: true },
      { name: '📌 Punishment Type', value: punishmentType, inline: true },
      { name: '📊 Status', value: '🟡 **Open**', inline: true },
      { name: '📝 Your Reason', value: reason, inline: false },
    ];

    if (linkedBanCaseId) {
      fields.push({ name: '🔗 Linked Case', value: `\`${linkedBanCaseId}\`\nYour appeal is linked to your ban case.`, inline: false });
    }

    if (postedChannel) {
      fields.push({ name: '📢 Submitted To', value: `${postedChannel}`, inline: true });
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.infoColor)
          .setTitle('📋 Appeal Submitted')
          .setDescription('Your appeal has been received. Staff will review it and get back to you.')
          .addFields(...fields)
          .setFooter({ text: 'You will be notified when staff reviews your appeal.' })
          .setTimestamp(),
      ],
    });
  },
};
