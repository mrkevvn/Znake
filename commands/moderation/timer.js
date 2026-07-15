// /timer - Starts a countdown timer with a custom label
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { isStaff } = require('../../utils/permissions');
const config = require('../../config.json');

// In-memory map to keep track of active timers (for cleanup/management if needed)
const activeTimers = new Map();

/**
 * Parses duration string (e.g. 10s, 5m, 2h, 1d) into milliseconds
 * @param {string} str 
 * @returns {number|null} milliseconds or null if invalid
 */
function parseDuration(str) {
  if (!str) return null;
  const match = str.trim().match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 0);
}

/**
 * Formats milliseconds into human-readable text
 * @param {number} ms 
 * @returns {string}
 */
function formatHumanDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

module.exports = {
  name: "timer",
  category: "moderation",
  default_member_permissions: "ModerateMembers",
  data: new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Set a visual countdown timer with an custom label/reason')
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('Duration of the timer (e.g., 30s, 10m, 2h, 1d)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('label')
        .setDescription('Label or reason for this timer')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  cooldown: 3,

  async execute(interaction) {
    // Staff permission check (standard across Znake moderation commands)
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ 
        embeds: [embeds.staffOnly()], 
        flags: MessageFlags.Ephemeral 
      });
    }

    const durationStr = interaction.options.getString('duration');
    const label = interaction.options.getString('label') || 'No label provided';

    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.reply({
        embeds: [
          embeds.error(
            'Invalid Duration Format',
            'Please specify a valid duration string.\n\n**Format Examples:**\n• `30s` (30 seconds)\n• `10m` (10 minutes)\n• `2h` (2 hours)\n• `1d` (1 day)'
          )
        ],
        flags: MessageFlags.Ephemeral
      });
    }

    // Upper limit check (max 30 days to keep timers reasonable)
    const MAX_DURATION = 30 * 24 * 60 * 60 * 1000;
    if (durationMs > MAX_DURATION) {
      return interaction.reply({
        embeds: [embeds.error('Duration Too Long', 'Timers cannot exceed 30 days.')],
        flags: MessageFlags.Ephemeral
      });
    }

    const startTime = Date.now();
    const endTime = startTime + durationMs;
    const endTimeSeconds = Math.floor(endTime / 1000);

    const embedColor = config.embedColor || '#5865F2';

    // 1. Build the modern, professional dashboard-style embed
    const timerEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('⏰ **ACTIVE SESSION TIMER**')
      .setDescription('A countdown timer has been successfully initiated.')
      .setThumbnail('https://cdn-icons-png.flaticon.com/512/3565/3565418.png') // Clean high-quality clock icon
      .addFields(
        { name: '⏰ Timer', value: `\`${formatHumanDuration(durationMs)}\``, inline: true },
        { name: '📌 Label / Task', value: `*${label}*`, inline: true },
        { name: '📊 Status', value: `🟢 Active (Ends <t:${endTimeSeconds}:R>)`, inline: false },
        { name: '📅 Exact Target Time', value: `<t:${endTimeSeconds}:F>`, inline: false }
      )
      .setFooter({
        text: `Timer ends • ${new Date(endTime).toLocaleString()}`,
        iconURL: interaction.client.user.displayAvatarURL()
      });

    // Send the active timer embed
    const response = await interaction.reply({
      embeds: [timerEmbed],
      withResponse: true
    });

    const replyMessage = response.resource.message;

    const timerKey = `${interaction.channel.id}-${replyMessage.id}`;

    // 2. Set up the expiration handler
    const timeoutId = setTimeout(async () => {
      activeTimers.delete(timerKey);

      // Create the final completed embed
      const completedEmbed = new EmbedBuilder()
        .setColor(config.successColor || '#57F287')
        .setTitle('✅ **TIMER COMPLETED**')
        .setDescription('This countdown session has ended.')
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/179/179386.png') // Checkmark icon
        .addFields(
          { name: '⏰ Timer', value: `\`${formatHumanDuration(durationMs)}\``, inline: true },
          { name: '📌 Label / Task', value: `*${label}*`, inline: true },
          { name: '📊 Status', value: `🔴 Ended (<t:${endTimeSeconds}:R>)`, inline: false },
          { name: '📅 Exact Target Time', value: `<t:${endTimeSeconds}:F>`, inline: false }
        )
        .setFooter({
          text: `Timer ended • ${new Date(endTime).toLocaleString()}`,
          iconURL: interaction.client.user.displayAvatarURL()
        });

      // Update the original message to show completion
      try {
        await interaction.editReply({
          embeds: [completedEmbed]
        });
      } catch (err) {
        // Message could be deleted or interaction expired
      }

      // Notify the user in the channel
      try {
        await interaction.followUp({
          content: `🔔 ${interaction.user}, your timer for **${label}** has ended!`,
          allowedMentions: { users: [interaction.user.id] }
        });
      } catch (err) {
        // Handle cases where the channel is no longer accessible
      }
    }, durationMs);

    activeTimers.set(timerKey, timeoutId);
  }
};
