// Backtest: how good is the win-probability model on real past games?
// Usage (from the backend folder):  node evaluate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { homeWinProbability, pregameEdge } = require('./winProbability');

const BDL_BASE = 'https://api.balldontlie.io/v1';
const DATA_DIR = path.join(__dirname, 'data');
const TEST_SEASON = 2025;          // the 2025-26 season we test on
const PRIOR_SEASON = TEST_SEASON - 1;
const REQUEST_GAP_MS = 15000;

// Same constants as teamRatings.js, so the test matches the live app
const PRIOR_GAMES = 10;
const OFFSEASON_REGRESSION = 0.3;
const LUCK_GAMES = 14;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. Get the games (downloaded once, then saved to disk) ----------

async function loadSeasonGames(season) {
  const file = path.join(DATA_DIR, `games-${season}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));

  console.log(`Downloading ${season} season games (one-time, ~3-4 min)...`);
  const games = [];
  let cursor = null;

  while (true) {
    let url = `${BDL_BASE}/games?seasons[]=${season}&season_type=regular&per_page=100`;
    if (cursor) url += `&cursor=${cursor}`;

    const res = await fetch(url, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
    if (res.status === 429) { await sleep(60000); continue; }
    if (!res.ok) throw new Error(`balldontlie returned ${res.status}`);

    const body = await res.json();
    games.push(...body.data);
    process.stdout.write(`  ${games.length} games\r`);

    cursor = body.meta && body.meta.next_cursor;
    if (!cursor) break;
    await sleep(REQUEST_GAP_MS);
  }
  console.log(`  ${games.length} games downloaded`);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(games));
  return games;
}

const isFinal = (g) => g.status_state === 'final' || g.status === 'Final';

function tallyRecords(games) {
  const rec = {};
  for (const g of games.filter(isFinal)) {
    const homeWon = g.home_team_score > g.visitor_team_score;
    bump(rec, g.home_team.id, homeWon);
    bump(rec, g.visitor_team.id, !homeWon);
  }
  return rec;
}

function bump(rec, id, won) {
  if (!rec[id]) rec[id] = { wins: 0, losses: 0 };
  won ? rec[id].wins++ : rec[id].losses++;
}

// Same blend as teamRatings.getWinPct
function winPct(now = { wins: 0, losses: 0 }, last) {
  let prior = 0.5;
  if (last && last.wins + last.losses > 0) {
    const lastPct = last.wins / (last.wins + last.losses);
    prior = 0.5 + (1 - OFFSEASON_REGRESSION) * (lastPct - 0.5);
  }
  const games = now.wins + now.losses;
  return (now.wins + PRIOR_GAMES * prior + LUCK_GAMES * 0.5) / (games + PRIOR_GAMES + LUCK_GAMES);
}

// ---------- 2. Rebuild each game at tip-off and at the end of Q1, Q2, Q3 ----------

const CHECKPOINTS = [
  { name: 'Pregame', quarters: 0 },
  { name: 'End of Q1', quarters: 1 },
  { name: 'Halftime', quarters: 2 },
  { name: 'End of Q3', quarters: 3 },
];

function snapshot(g, quarters) {
  const sum = (side) => [1, 2, 3].slice(0, quarters).reduce((s, q) => s + g[`${side}_q${q}`], 0);
  if (quarters === 0) {
    return { state: 'scheduled', status: '', period: 0, clock: '', home: { score: 0 }, away: { score: 0 } };
  }
  return {
    state: 'in_progress', status: `Q${quarters}`, period: quarters, clock: '0:00',
    home: { score: sum('home') }, away: { score: sum('visitor') },
  };
}

// ---------- 3. Score the predictions ----------

function newStats() {
  return { n: 0, correct: 0, brier: 0, buckets: {} };
}

function record(stats, prob, homeWon) {
  const outcome = homeWon ? 1 : 0;
  stats.n++;
  stats.brier += (prob - outcome) ** 2;
  if ((prob >= 0.5) === homeWon) stats.correct++;

  // Calibration: group by the favorite's predicted chance (50-60%, 60-70%, ...)
  const favProb = Math.max(prob, 1 - prob);
  const favWon = prob >= 0.5 ? homeWon : !homeWon;
  const bucket = Math.min(Math.floor(favProb * 10), 9) * 10;
  const b = (stats.buckets[bucket] ||= { n: 0, predicted: 0, won: 0 });
  b.n++;
  b.predicted += favProb;
  if (favWon) b.won++;
}

async function main() {
  const priorGames = await loadSeasonGames(PRIOR_SEASON);
  const testGames = await loadSeasonGames(TEST_SEASON);
  const lastSeason = tallyRecords(priorGames);

  const games = testGames
    .filter(isFinal)
    .filter((g) => g.home_q1 != null && g.visitor_q3 != null)
    .filter((g) => g.home_team_score !== g.visitor_team_score)
    .sort((a, b) => (a.datetime || a.date).localeCompare(b.datetime || b.date) || a.id - b.id);

  const model = Object.fromEntries(CHECKPOINTS.map((c) => [c.name, newStats()]));
  const baseline = Object.fromEntries(CHECKPOINTS.map((c) => [c.name, newStats()]));
  const running = {}; // records BEFORE each game, so the model never sees the future

  for (const g of games) {
    const homeId = g.home_team.id;
    const awayId = g.visitor_team.id;
    const homeWon = g.home_team_score > g.visitor_team_score;

    const edge = pregameEdge(winPct(running[homeId], lastSeason[homeId]),
                             winPct(running[awayId], lastSeason[awayId]));

    for (const c of CHECKPOINTS) {
      const snap = snapshot(g, c.quarters);
      record(model[c.name], homeWinProbability(snap, edge), homeWon);
      record(baseline[c.name], homeWinProbability(snap), homeWon); // home court only
    }

    bump(running, homeId, homeWon);
    bump(running, awayId, !homeWon);
  }

  // ---------- 4. Print the report ----------
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`\nBacktest on ${games.length} games from the ${TEST_SEASON}-${(TEST_SEASON + 1) % 100} regular season\n`);
  console.log('Checkpoint    Accuracy   Brier    | Baseline (home court only): Accuracy  Brier');
  for (const c of CHECKPOINTS) {
    const m = model[c.name], b = baseline[c.name];
    console.log(
      `${c.name.padEnd(13)} ${pct(m.correct / m.n).padStart(7)}   ${(m.brier / m.n).toFixed(3)}    |` +
      `                             ${pct(b.correct / b.n).padStart(6)}  ${(b.brier / b.n).toFixed(3)}`
    );
  }
  console.log('\nBrier score: average squared error of the probability. Lower is better; always guessing 50% scores 0.250.');

  console.log('\nCalibration at halftime (do 70% favorites win ~70% of the time?)');
  console.log('Favorite chance   Games   Predicted   Actually won');
  const buckets = model['Halftime'].buckets;
  for (const k of Object.keys(buckets).map(Number).sort((a, b) => a - b)) {
    const b = buckets[k];
    console.log(`${`${k}-${k + 10}%`.padEnd(17)} ${String(b.n).padStart(5)}   ${pct(b.predicted / b.n).padStart(9)}   ${pct(b.won / b.n).padStart(12)}`);
  }
}

main().catch((err) => {
  console.error('Backtest failed:', err.message);
  process.exit(1);
});