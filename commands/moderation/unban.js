// /unban - Unbans a user by ID or Case ID and updates case
const { MessageFlags, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const db = require('../../utils/database');
const config = require('../../config.json');
const logger = require('../../utils/logger');
const { isStaff, botHasPermission } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modLog');
const { getCaseById, addTimeline, logAction, updateReportEmbed } = require('../../utils/caseManager');


module.exports = {
  name: "unban",
  category: "moderation",
  default_member_permissions: "BanMembers",
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server by ID or Case ID')
    .addStringOption(opt => opt.setName('id').setDescription('The user ID or Case ID to unban').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the unban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  cooldown: 5,

  async execute(interaction) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    const input = interaction.options.getString('id').trim();
    const reason = interaction.options.getString('reason') || 'No reason provided';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let userId = input;
    let linkedCaseId = null;

    // Check if input is a case ID
    if (input.toUpperCase().startsWith('CASE-')) {
      const caseData = getCaseById(input);
      if (!caseData) {
        return interaction.editReply({ embeds: [embeds.error('Case Not Found', `No case found for \`${input}\`.`)] });
      }
      if (caseData.reportedUserId) {
        userId = caseData.reportedUserId;
        linkedCaseId = caseData.caseId;
      } else {
        return interaction.editReply({ embeds: [embeds.error('Invalid Case', 'This case does not have an associated user.')] });
      }
    }

      try {
        // Attempt to fetch the single ban for this user first (more efficient)
        let ban = null;
        try {
          ban = await interaction.guild.bans.fetch(userId);
        } catch (fetchErr) {
          // If fetch by ID fails, try fetching all bans and checking membership
          logger.warn && logger.warn(`[Unban] fetch(userId) failed for ${userId}: ${fetchErr?.message ?? fetchErr}`);
          const allBans = await interaction.guild.bans.fetch().catch(err => {
            throw new Error(`Could not fetch ban list: ${err?.message || err}`);
          });
          ban = allBans.get(userId) || null;
        }

        if (!ban) {
          return interaction.editReply({ embeds: [embeds.error('Not Banned', 'This user is not currently banned.')] });
        }

        // Perform the unban
        await interaction.guild.bans.remove(userId, `${interaction.user.username}: ${reason}`);


      const bannedName = (ban.user && (ban.user.globalName || ban.user.username)) || userId;

      // Update linked case if it exists
      if (linkedCaseId) {
        const cases = db.read('cases');
        const caseData = cases[linkedCaseId];
        if (caseData) {
          caseData.status = 'Resolved';
          caseData.resolvedAt = Date.now();
          caseData.moderatorId = interaction.user.id;
          caseData.resolution = `Unbanned by ${interaction.user.username}: ${reason}`;
          addTimeline(caseData, `Unbanned by ${interaction.user.username}`, interaction.user.id);
          cases[linkedCaseId] = caseData;
          db.write('cases', cases);
          logAction('RESOLVED', linkedCaseId, interaction.user.id, `Unban: ${reason}`, interaction.guild.id);
          await updateReportEmbed(caseData, interaction.guild, interaction.client).catch(err => logger.error && logger.error(`[Unban] updateReportEmbed failed: ${err?.message || err}`, err?.stack || err));
        }
      }

      // Create unban case record
      const newCaseId = linkedCaseId;
      const replyEmbed = new EmbedBuilder()
        .setColor(config.successColor)
        .setTitle('✅ Member Unbanned')
        .setDescription(`**${bannedName}** (\`${userId}\`) has been unbanned.`)
        .addFields(
          { name: '⚔️ Moderator', value: `${interaction.user}`, inline: true },
          { name: '📝 Reason', value: reason, inline: false }
        );

      if (newCaseId) {
        replyEmbed.addFields({ name: '🔖 Case ID', value: `\`${newCaseId}\``, inline: true });
      }

      replyEmbed.setTimestamp();

      await interaction.editReply({ embeds: [replyEmbed] });
      await logModerationAction(interaction.client, interaction.guild, 'UNBAN', ban.user, interaction.user, reason).catch(err => logger.error && logger.error(`[Unban] logModerationAction failed: ${err?.message || err}`, err?.stack || err));

      // Post-unban: generate invite + DM the user (must never affect unban/logging)
      let inviteUrl = null;
      try {
        const guild = interaction.guild;
        const botMember = guild.members.me;
        const canCreateInvites = botMember?.permissions?.has(PermissionFlagsBits.CreateInstantInvite);

        if (canCreateInvites) {
          const existing = await guild.invites.fetch().catch(() => null);
          if (existing) {
            const first = existing.find(i => i && i.url);
            inviteUrl = first?.url || null;
          }

          if (!inviteUrl) {
            // Create invite from a text channel where possible
            const channel = guild.channels.cache
              .filter(ch => ch && ch.isTextBased?.() && ch.permissionsFor?.(botMember)?.has(PermissionFlagsBits.CreateInstantInvite))
              .sort((a, b) => (b.rawPosition ?? 0) - (a.rawPosition ?? 0))
              .first();

            if (channel) {
              const created = await channel.createInvite({ maxAge: 0, unique: false, reason: 'Unban invite' }).catch(() => null);
              inviteUrl = created?.url || null;
            }
          }
        }
      } catch (e) {
        logger.warn && logger.warn(`[Unban] Invite generation failed: ${e?.message || e}`);
      }

      try {
        const user = await interaction.client.users.fetch(userId).catch(() => ban.user);

        const dmEmbed = new EmbedBuilder()
          .setColor(config.successColor)
          .setTitle(`✅ You have been unbanned from ${interaction.guild.name}`)
          .setDescription('You have been unbanned. Please review and follow the server rules.')
          .addFields(
            { name: '🏛️ Server', value: interaction.guild.name, inline: true },
            inviteUrl ? { name: '🔗 Invite', value: `[Click here to rejoin](${inviteUrl})`, inline: false } : { name: '🔗 Invite', value: 'Invite unavailable (no permission to create)', inline: false },
            linkedCaseId ? { name: '🔖 Unban Case ID', value: `\`${linkedCaseId}\``, inline: true } : { name: '🔖 Unban Case ID', value: 'N/A', inline: true },
            { name: '📝 Reason', value: reason, inline: false }
          )
          .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
      } catch (dmErr) {
        logger.warn && logger.warn(`[Unban] Could not DM user ${userId}: ${dmErr?.message || dmErr}`);
        interaction.followUp({ content: '⚠️ Unban succeeded, but I could not DM the user.', flags: MessageFlags.Ephemeral }).catch(err => logger.error && logger.error(`[Unban] followUp DM failed: ${err?.message || err}`, err?.stack || err));
        logAction('UNBAN_DM_FAILED', linkedCaseId || 'N/A', interaction.user.id, `Could not DM user (${userId}).`, interaction.guild.id);
      }
    } catch (err) {
      const msg = err?.message || '';
      const code = err?.code;

      // Discord API: 10026 = Unknown Ban
      if (code === 10026 || msg.includes('Unknown Ban')) {
        return interaction.editReply({ embeds: [embeds.error('Not Banned', 'This user is not currently banned. (Unknown Ban)')] });
      }

      if (msg.includes('Unknown User')) {
        return interaction.editReply({ embeds: [embeds.error('Not Banned', `No ban found for user ID \`${userId}\`.`)] });
      }

      logger.error && logger.error(`[Unban] Unban failed for ${userId}: ${msg}`, err?.stack || err);
      return interaction.editReply({ embeds: [embeds.error('Unban Failed', `Could not unban this user: ${msg || 'Unknown error'}`)] });
    }

  },
};



