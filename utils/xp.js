// XP / Leveling utility
// XP needed to advance FROM level n  →  n+1  (MEE6-style formula)
function xpForLevel(n) {
  return 5 * n * n + 50 * n + 100;
}

// Total cumulative XP required to REACH level n (from level 0)
function totalXpForLevel(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += xpForLevel(i);
  return total;
}

// Given total accumulated XP → { level, currentXp, xpForNext, progressPercent }
function getLevelData(totalXp) {
  let level = 0;
  let spent = 0;
  while (true) {
    const needed = xpForLevel(level);
    if (spent + needed > totalXp) break;
    spent += needed;
    level++;
  }
  const currentXp  = totalXp - spent;
  const xpForNext  = xpForLevel(level);
  const progressPercent = Math.min(100, Math.floor((currentXp / xpForNext) * 100));
  return { level, currentXp, xpForNext, progressPercent };
}

// ─────────────────────────────────────────────────────────────────────────────
// XP tuning (keep low to prevent farming)
// ─────────────────────────────────────────────────────────────────────────────

// Random XP gain per eligible message
const XP_MIN = 5;
const XP_MAX = 15;
function randomXp() {
  return Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
}

// Cooldown between XP grants per user (ms)
// Range requirement: 60–120 seconds. Default to 90s.
const XP_COOLDOWN_MS = 90_000;

// Anti-repeat tracking window (ms)
// If a user sends near-identical messages in this window, skip XP.
const XP_REPEAT_WINDOW_MS = 15_000;

// Similarity threshold for message-repeat detection.
// 0.85 means: roughly 85% overlap after normalization.
const XP_REPEAT_SIMILARITY = 0.85;

// Visual progress bar  ██████████░░░░░░░░░░
function progressBar(current, total, length = 18) {
  const filled = Math.round((current / total) * length);
  const empty  = length - filled;
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
}


// Tier label + colour for a given level
function levelTier(level) {
  if (level >= 50) return { label: '💎 Diamond',  color: '#B9F2FF' };
  if (level >= 30) return { label: '🏅 Platinum', color: '#E5E4E2' };
  if (level >= 20) return { label: '🥇 Gold',     color: '#FFD700' };
  if (level >= 10) return { label: '🥈 Silver',   color: '#C0C0C0' };
  if (level >= 5)  return { label: '🥉 Bronze',   color: '#CD7F32' };
  return                  { label: '🌱 Starter',  color: '#57F287' };
}

module.exports = {
  xpForLevel,
  totalXpForLevel,
  getLevelData,
  randomXp,
  XP_COOLDOWN_MS,
  progressBar,
  levelTier,
  XP_MIN,
  XP_MAX,
  XP_REPEAT_WINDOW_MS,
  XP_REPEAT_SIMILARITY,
};
