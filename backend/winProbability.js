// LAYERS 2 + 3: pregame edge, then live win probability
const REGULATION_SECONDS = 48 * 60;
const QUARTER_SECONDS = 12 * 60;
const HOME_COURT_POINTS = 2.5;
const FULL_GAME_STD_DEV = 13.5;
const LOGISTIC_SCALE = 1.702;

// ---------- Layer 2: pregame edge ----------

// Log5: chance team A beats team B, from their win percentages
function log5(pA, pB) {
  return (pA - pA * pB) / (pA + pB - 2 * pA * pB);
}

// Converts a probability into "points of expected advantage"
function probToPoints(p) {
  const clamped = Math.min(Math.max(p, 0.01), 0.99);
  const z = Math.log(clamped / (1 - clamped)) / LOGISTIC_SCALE;
  return z * FULL_GAME_STD_DEV;
}

// How many points the home team is expected to win by, before tip-off
function pregameEdge(homeWinPct, awayWinPct) {
  return probToPoints(log5(homeWinPct, awayWinPct)) + HOME_COURT_POINTS;
}

// ---------- Layer 3: live probability ----------

// Handles "3:44", "Q2 3:23", "45.3" (under a minute), and "Q4 45.3"
function clockToSeconds(clock) {
  const text = String(clock || '').trim();

  const mmss = text.match(/(\d{1,2}):(\d{2}(?:\.\d+)?)/);
  if (mmss) return Number(mmss[1]) * 60 + parseFloat(mmss[2]);

  const secsOnly = text.match(/(?:^|\s)(\d{1,2}(?:\.\d+)?)$/);
  if (secsOnly) return parseFloat(secsOnly[1]);

  return 0;
}

function secondsRemaining(game) {
  const { state, status, period, clock } = game;
  if (state === 'scheduled' || period === 0) return REGULATION_SECONDS;
  if (status === 'Halftime') return 2 * QUARTER_SECONDS;

  const clockSecs = clockToSeconds(clock);
  if (period > 4) return clockSecs;
  return (4 - period) * QUARTER_SECONDS + clockSecs;
}

function normalCdf(x) {
  return 1 / (1 + Math.exp(-LOGISTIC_SCALE * x));
}

function homeWinProbability(game, edge = HOME_COURT_POINTS) {
  const margin = game.home.score - game.away.score;
  if (game.state === 'final') return margin > 0 ? 1 : 0;

  const remaining = secondsRemaining(game);
  if (remaining <= 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;

  const fraction = remaining / REGULATION_SECONDS;
  const expectedMargin = margin + edge * fraction;   // pregame edge fades over time
  const stdDev = FULL_GAME_STD_DEV * Math.sqrt(fraction);

  const p = normalCdf(expectedMargin / stdDev);

  // Safety net: if anything upstream sends bad data, show 50/50, not 100/0
  return Number.isFinite(p) ? p : 0.5;
}

module.exports = { homeWinProbability, pregameEdge };