'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { evaluate } = require('mathjs');

const SESSIONS = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function getSession(userId) {
  let session = SESSIONS.get(userId);
  if (!session) {
    session = { expression: '', channelId: null, message: null, collector: null, timeout: null };
    SESSIONS.set(userId, session);
  }
  return session;
}

function cleanupSession(userId) {
  const session = SESSIONS.get(userId);
  if (!session) return;
  if (session.collector) {
    try { session.collector.stop(); } catch {}
  }
  if (session.timeout) {
    clearTimeout(session.timeout);
  }
  SESSIONS.delete(userId);
}

function resetSessionTimers(session, userId) {
  if (session.timeout) clearTimeout(session.timeout);
  session.timeout = setTimeout(() => expireSession(userId), SESSION_TTL);
}

async function expireSession(userId) {
  const session = SESSIONS.get(userId);
  if (!session) return;
  try {
    if (session.collector && !session.collector.ended) {
      session.collector.stop();
    }
    if (session.message) {
      const expiredEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('⌛ Calculator Expired')
        .setDescription('Session closed due to inactivity. Run `/cal` to start a new one.')
        .setTimestamp();
      await session.message.edit({ embeds: [expiredEmbed], components: [] });
    }
  } catch {}
  SESSIONS.delete(userId);
}

function buildEmbed(expression, result, error, footerText) {
  const embed = new EmbedBuilder()
    .setColor(error ? 0xED4245 : (result !== null && result !== undefined ? 0x57F287 : 0x5865F2))
    .setTitle('🧮 Calculator');

  let desc = '**Input:**\n';
  desc += `\`\`\`${expression || '0'}\`\`\`\n`;

  if (error) {
    desc += `\n⚠️ ${error}`;
  } else if (result !== null && result !== undefined) {
    desc += '\n**Output:**\n';
    desc += `\`\`\`${result}\`\`\``;
  }

  embed.setDescription(desc);

  if (footerText) {
    embed.setFooter({ text: footerText });
  }

  return embed;
}

function buildButtons(disabled = false) {
  const s = disabled ? ButtonStyle.Secondary : ButtonStyle.Secondary;
  const p = disabled ? ButtonStyle.Secondary : ButtonStyle.Primary;
  const d = disabled ? ButtonStyle.Secondary : ButtonStyle.Danger;
  const g = disabled ? ButtonStyle.Secondary : ButtonStyle.Success;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cal_c').setLabel('C').setStyle(d).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_back').setLabel('⌫').setStyle(d).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_pct').setLabel('%').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_div').setLabel('÷').setStyle(p).setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cal_7').setLabel('7').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_8').setLabel('8').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_9').setLabel('9').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_mul').setLabel('×').setStyle(p).setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cal_4').setLabel('4').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_5').setLabel('5').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_6').setLabel('6').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_sub').setLabel('−').setStyle(p).setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cal_1').setLabel('1').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_2').setLabel('2').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_3').setLabel('3').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_add').setLabel('+').setStyle(p).setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cal_neg').setLabel('±').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_0').setLabel('0').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_dot').setLabel('.').setStyle(s).setDisabled(disabled),
      new ButtonBuilder().setCustomId('cal_eq').setLabel('=').setStyle(g).setDisabled(disabled),
    ),
  ];
}

function handlePress(expression, buttonId, evaluated) {
  if (buttonId === 'cal_c') return { expression: '' };

  if (buttonId === 'cal_back') {
    if (evaluated) return { expression: '' };
    return { expression: expression.slice(0, -1) };
  }

  if (evaluated) {
    expression = '';
  }

  switch (buttonId) {
    case 'cal_0': case 'cal_1': case 'cal_2': case 'cal_3': case 'cal_4':
    case 'cal_5': case 'cal_6': case 'cal_7': case 'cal_8': case 'cal_9':
      return { expression: expression + buttonId.replace('cal_', '') };
    case 'cal_dot': {
      const last = expression.split(/[\+\-\*\/\(\)]/).pop() || '';
      if (last.includes('.')) return { expression };
      return { expression: expression + (last === '' ? '0.' : '.') };
    }
    case 'cal_add': return { expression: expression + '+' };
    case 'cal_sub': return { expression: expression + '-' };
    case 'cal_mul': return { expression: expression + '*' };
    case 'cal_div': return { expression: expression + '/' };
    case 'cal_pct': {
      if (!expression.trim()) return { expression: '0' };
      try {
        const r = evaluate(expression);
        const v = Number(r);
        if (!Number.isFinite(v)) return { expression: expression + '%' };
        return { expression: String(v / 100) };
      } catch {
        return { expression: expression + '%' };
      }
    }
    case 'cal_neg': {
      const m = expression.match(/(-?\d+\.?\d*)$/);
      if (m) {
        const num = m[1];
        const before = expression.slice(0, -num.length);
        return { expression: before + (num.startsWith('-') ? num.slice(1) : `(${num}*-1)`) };
      }
      return { expression: expression + '(-' };
    }
    case 'cal_eq': {
      if (!expression.trim()) return { expression: '0', evaluated: true, result: '0' };
      const cleaned = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
      try {
        const r = evaluate(cleaned);
        if (!Number.isFinite(r)) return { expression: cleaned, error: 'Result is not a finite number.' };
        return { expression: cleaned, evaluated: true, result: String(parseFloat(r.toFixed(10))) };
      } catch {
        return { expression: cleaned, error: 'Invalid expression. Please check your input.' };
      }
    }
    default:
      return { expression };
  }
}

module.exports = {
  name: 'cal',
  category: 'general',
  data: new SlashCommandBuilder()
    .setName('cal')
    .setDescription('Open an interactive calculator'),

  async execute(interaction) {
    const userId = interaction.user.id;
    cleanupSession(userId);

    const session = getSession(userId);
    session.channelId = interaction.channelId;

    await interaction.reply({
      embeds: [buildEmbed('', null, null, `${interaction.user.username} — your calculations stay private until you press =`)],
      components: buildButtons(false),
      flags: MessageFlags.Ephemeral,
    });

    const message = await interaction.fetchReply();
    session.message = message;
    resetSessionTimers(session, userId);

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: SESSION_TTL,
    });

    session.collector = collector;

    collector.on('collect', async (btn) => {
      if (btn.user.id !== userId) {
        return btn.reply({ content: 'This calculator is not yours.', flags: MessageFlags.Ephemeral });
      }

      const id = btn.customId;
      if (!id.startsWith('cal_')) return;

      resetSessionTimers(session, userId);

      const { expression: expr, evaluated, result, error } = handlePress(session.expression, id, session.evaluated);
      session.expression = expr;
      session.evaluated = !!evaluated;

      if (id === 'cal_eq') {
        if (error) {
          return btn.update({
            embeds: [buildEmbed(expr, null, error, `${interaction.user.username} — fix and try again`)],
            components: buildButtons(false),
          });
        }

        if (evaluated && result !== undefined) {
          await btn.update({
            embeds: [buildEmbed(expr, result, null, `${interaction.user.username} — result sent to channel`)],
            components: buildButtons(false),
          });

          try {
            const channel = interaction.client.channels.cache.get(session.channelId);
            if (channel) {
              await channel.send({
                embeds: [new EmbedBuilder()
                  .setColor(0x57F287)
                  .setTitle('🧮 Calculator Result')
                  .setDescription(`${interaction.user} calculated:\n\`\`\`${expr} = ${result}\`\`\``)
                  .setTimestamp()],
              });
            }
          } catch {}
          return;
        }
      }

      await btn.update({
        embeds: [buildEmbed(expr, null, null, `${interaction.user.username} — your calculations stay private until you press =`)],
        components: buildButtons(false),
      });
    });

    collector.on('end', () => {
      if (SESSIONS.has(userId)) {
        expireSession(userId);
      }
    });
  },
};
