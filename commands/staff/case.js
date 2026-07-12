// /case — Staff case lookup: view, history
const { MessageFlags, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const db = require('../../utils/database');
const { isStaff } = require('../../utils/permissions');
const {
  buildCaseEmbed,
  getStatusBadge,
} = require('../../utils/caseManager');

function noPermEmbed() {
  return new EmbedBuilder()
    .setColor(config.errorColor)
    .setTitle('🚫 Staff Only')
    .setDescription('Only staff members can view cases.')
    .setTimestamp();
}

module.exports = {
  name: "case",
  category: "staff",
  default_member_permissions: "ManageMessages",
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Look up reported cases (Staff only)')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View full details of a case')
        .addStringOption(opt =>
          opt.setName('caseid').setDescription('Case ID (e.g. CASE-AB1234)').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('Show all cases involving a user')
        .addUserOption(opt =>
          opt.setName('user').setDescription('User to look up').setRequired(true)
        )
    ),
  cooldown: 3,

  async execute(interaction, client) {
    if (!isStaff(interaction.member, interaction.guild.id)) {
      return interaction.reply({ embeds: [noPermEmbed()], flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const { guild, user } = interaction;
    const cases = db.read('cases');

    function getCase(rawId) {
      const id = rawId.toUpperCase().startsWith('CASE-') ? rawId.toUpperCase() : `CASE-${rawId.toUpperCase()}`;
      return cases[id] ? { id, data: cases[id] } : null;
    }

    if (sub === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const raw = interaction.options.getString('caseid').trim();
      const found = getCase(raw);
      if (!found) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.errorColor)
            .setTitle('❌ Case Not Found').setDescription(`No case found for \`${raw}\`.`).setTimestamp()],
        });
      }
      const embed = await buildCaseEmbed(found.data, guild, client);
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'history') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const target = interaction.options.getUser('user');

      const userCases = Object.values(cases).filter(c =>
        c.guildId === guild.id &&
        (c.reporterId === target.id || c.reportedUserId === target.id)
      ).sort((a, b) => b.createdAt - a.createdAt);

      if (userCases.length === 0) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(config.infoColor)
            .setTitle(`📂 Case History — ${target.username}`)
            .setDescription('No cases found involving this user.')
            .setTimestamp()],
        });
      }

      const lines = userCases.slice(0, 20).map(c => {
        const { emoji } = getStatusBadge(c.status);
        const role = c.reporterId === target.id ? '📤 Reporter' : '🎯 Reported';
        const type = c.type === 'appeal' ? '📋 Appeal' : c.type === 'ban' ? '🔨 Ban' : '🚨 Report';
        const ts   = `<t:${Math.floor(c.createdAt / 1000)}:d>`;
        return `${emoji} \`${c.caseId}\` ${type} · **${c.status}** · ${role} · ${ts}`;
      });

      const open   = userCases.filter(c => !['Closed','Resolved','Rejected'].includes(c.status)).length;
      const closed = userCases.length - open;

      const embed = new EmbedBuilder()
        .setColor(config.embedColor)
        .setAuthor({ name: `Case History — ${target.username}`, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .setDescription(lines.join('\n'))
        .addFields(
          { name: '📂 Total Cases',  value: `${userCases.length}`, inline: true },
          { name: '🟡 Open',         value: `${open}`,             inline: true },
          { name: '🔴 Closed',       value: `${closed}`,           inline: true },
        )
        .setFooter({ text: userCases.length > 20 ? `Showing 20 of ${userCases.length} cases` : `${userCases.length} case(s) total` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
