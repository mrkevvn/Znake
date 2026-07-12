'use strict';

const {
  MessageFlags,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');

const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');

const fs = require('fs');
const path = require('path');

const LOCKDOWNS_FILE_PATH = path.join(__dirname, '../../data/lockdowns.json');

function ensureLockdownsFile() {
  if (!fs.existsSync(LOCKDOWNS_FILE_PATH)) {
    fs.writeFileSync(LOCKDOWNS_FILE_PATH, JSON.stringify({ channels: {} }, null, 2));
  }
}

function readLockdownsFile() {
  ensureLockdownsFile();
  try {
    const raw = fs.readFileSync(LOCKDOWNS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { channels: {} };
  } catch {
    return { channels: {} };
  }
}

function writeLockdownsFile(data) {
  ensureLockdownsFile();
  fs.writeFileSync(LOCKDOWNS_FILE_PATH, JSON.stringify(data, null, 2));
}

function getLockdownKeysForChannel(channel) {
  // We only clear known lockdown-related keys.
  // Even if the bot didn't lock a given permission, resetting with null is safe.
  const keys = new Set();

  if (!channel) return keys;

  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildCategory
  ) {
    keys.add('SendMessages');
  }

  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    keys.add('Connect');
    keys.add('Speak');
  }

  return keys;
}

async function clearEveryoneLockOverrides(channel, guild, retryOnce = true) {
  const keys = getLockdownKeysForChannel(channel);
  if (!keys.size) return { changed: false };

  const reset = {};
  for (const k of keys) reset[k] = null;

  const everyone = guild.roles.everyone;

  const attempt = async () => {
    if (!channel?.permissionOverwrites?.edit) throw new Error('Missing permissionOverwrites.edit');
    await channel.permissionOverwrites.edit(everyone, reset, { reason: 'UNLOCKDOWN restored' });
    return { changed: true };
  };

  try {
    return await attempt();
  } catch (err) {
    if (!retryOnce) throw err;
    return await attempt();
  }
}

function channelLooksLocked(channel) {
  if (!channel?.permissionOverwrites?.cache) return false;

  const everyone = channel.permissionOverwrites.cache.find(ow => ow.id === channel.guild.roles.everyone.id);
  if (!everyone) return false;

  // If everyone overwrite still denies SendMessages/Connect, treat as locked.
  const denied = everyone.deny;

  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildCategory
  ) {
    return !!denied.has(PermissionFlagsBits.SendMessages);
  }

  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    return !!denied.has(PermissionFlagsBits.Connect) || !!denied.has(PermissionFlagsBits.Speak);
  }

  return false;
}

module.exports = {
  name: "unlockdown",
  category: "moderation",
  default_member_permissions: "SendMessages",
  data: new SlashCommandBuilder()
    .setName('unlockdown')
    .setDescription('Lift the server lockdown and restore channel access')
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for lifting the lockdown'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  cooldown: 30,

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        embeds: [embeds.error('Guild Only', 'This command can only be used in a server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const guild = interaction.guild;

    if (!isStaff(interaction.member, guild.id) && !interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.staffOnly()], flags: MessageFlags.Ephemeral });
    }

    if (!interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) {
      // Staff check should already prevent normal users, but keep it strict.
      return interaction.reply({ embeds: [embeds.noPermission('Administrator')], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const reason = interaction.options.getString('reason') || 'Lockdown lifted';

    const allChannels = [...guild.channels.cache.values()].filter(Boolean);
    const totalProcessed = allChannels.length;

    let success = 0;
    let failed = 0;
    const failedList = [];

    // Unlock attempt pass
    for (const ch of allChannels) {
      try {
        if (!ch.permissionOverwrites?.edit) {
          // If it doesn't support overwrites, just skip (not a crash)
          continue;
        }

        await clearEveryoneLockOverrides(ch, guild, true);
        success++;

        // Clear permanence record for permanent lockdown (unlock removes all lockdown-related overwrites)
        // Timed records are handled by timedLockdown expiration; we still clean the permanent marker.
        const data = readLockdownsFile();
        const record = data?.channels?.[ch.id];
        if (record?.active && (record.type === 'permanent' || record.type === 'timed')) {
          delete data.channels[ch.id];
          writeLockdownsFile(data);
        }
      } catch (err) {
        failed++;
        failedList.push({
          channelId: ch.id,
          channelName: ch.name || String(ch.id),
          reason: err?.message || 'Unknown error',
        });
        // continue
      }

      if (success + failed > 0 && (success + failed) % 10 === 0) {
        // progress-friendly structure
        // eslint-disable-next-line no-console
        console.log(`[unlockdown] progress: ${success + failed}/${totalProcessed}`);
      }
    }

    // Verification pass
    let stillLocked = 0;
    const verificationFailedList = [];

    for (const ch of allChannels) {
      try {
        // Only meaningful if we have overwrite cache.
        const locked = channelLooksLocked(ch);
        if (locked) {
          stillLocked++;
          verificationFailedList.push({
            channelId: ch.id,
            channelName: ch.name || String(ch.id),
          });

          // Attempt one more correction if possible
          try {
            await clearEveryoneLockOverrides(ch, guild, false);
          } catch {
            // ignore; record remains failed
          }
        }
      } catch {
        stillLocked++;
        verificationFailedList.push({
          channelId: ch.id,
          channelName: ch.name || String(ch.id),
          reason: 'Verification error',
        });
      }
    }

    const timestamp = new Date();

    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setTitle('🔓 Server Unlockdown Complete')
      .addFields(
        { name: '🔓 Status', value: 'Unlocked', inline: true },
        { name: '♻️ Permissions restored', value: 'Attempted across all channels', inline: true },
        { name: '🛠 Verification pass completed', value: stillLocked ? 'Some channels still locked' : 'All channels verified unlocked', inline: false },
        { name: '📊 Total channels processed', value: String(totalProcessed), inline: true },
        { name: '✅ Successful unlocks', value: String(success), inline: true },
        { name: '❌ Failed channels', value: String(failed), inline: true },
        {
          name: 'Notes',
          value: stillLocked
            ? `Still locked after unlock: ${stillLocked}`
            : 'No remaining lockdown overwrites detected for known lockdown permissions.',
          inline: false,
        },
        {
          name: 'Failed channels (unlock attempt) - top 10',
          value: failedList.length
            ? failedList
                .slice(0, 10)
                .map(f => `• ${f.channelName} (${f.channelId})`)
                .join('\n') + (failedList.length > 10 ? `\n+${failedList.length - 10} more` : '')
            : 'None',
          inline: false,
        },
      )
      .setFooter({ text: `Unlocked by ${interaction.user.tag} • ${guild.name}` })
      .setTimestamp(timestamp);

    return interaction.editReply({ embeds: [embed] });
  },
};

