// LAYER 1: team strength from W/L records (free games endpoint)
const fs = require('fs');
const path = require('path');

const BDL_BASE = 'https://api.balldontlie.io/v1';
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'records.json');

const REQUEST_GAP_MS = 15000;                 // 4 calls/min, leaves room for the live scoreboard
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;  // refresh current season every 6 hours
const PRIOR_GAMES = 10;                       // last season counts as 10 "games" of evidence
const OFFSEASON_REGRESSION = 0.3;             // pull last season 30% toward .500
const LUCK_GAMES = 14;                        // records include luck: always add 14 games of .500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let store = { season: null, updatedAt: null, lastSeason: {}, current: {} };

// NBA seasons start in October. The 2026-27 season is "2026".
function currentSeason(date = new Date()) {
  return date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

// Pages through every regular-season game and tallies wins/losses per team id
async function fetchSeasonRecords(season) {
  const records = {};
  let cursor = null;

  while (true) {
    let url = `${BDL_BASE}/games?seasons[]=${season}&season_type=regular&per_page=100`;
    if (cursor) url += `&cursor=${cursor}`;

    const res = await fetch(url, {
      headers: { Authorization: process.env.BALLDONTLIE_API_KEY },
    });
    if (res.status === 429) {        // rate limited: wait a minute, retry the same page
      await sleep(60000);
      continue;
    }
    if (!res.ok) throw new Error(`balldontlie returned ${res.status}`);

    const body = await res.json();
    for (const g of body.data) {
      const isFinal = g.status_state === 'final' || g.status === 'Final';
      if (!isFinal) continue;

      const homeWon = g.home_team_score > g.visitor_team_score;
      tally(records, g.home_team.id, homeWon);
      tally(records, g.visitor_team.id, !homeWon);
    }

    cursor = body.meta && body.meta.next_cursor;
    if (!cursor) break;
    await sleep(REQUEST_GAP_MS);
  }
  return records;
}

function tally(records, teamId, won) {
  if (!records[teamId]) records[teamId] = { wins: 0, losses: 0 };
  if (won) records[teamId].wins++;
  else records[teamId].losses++;
}

// Blends this season with last season, then regresses toward .500
function getWinPct(teamId) {
  const now = store.current[teamId] || { wins: 0, losses: 0 };
  const last = store.lastSeason[teamId];

  let prior = 0.5;
  if (last && last.wins + last.losses > 0) {
    const lastPct = last.wins / (last.wins + last.losses);
    prior = 0.5 + (1 - OFFSEASON_REGRESSION) * (lastPct - 0.5);
  }

  const games = now.wins + now.losses;
  return (now.wins + PRIOR_GAMES * prior + LUCK_GAMES * 0.5) /
         (games + PRIOR_GAMES + LUCK_GAMES);
}

function getRecord(teamId) {
  const r = store.current[teamId] || { wins: 0, losses: 0 };
  return `${r.wins}-${r.losses}`;
}

function loadFromDisk() {
  try {
    store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    // no saved file yet; fine on first run
  }
}

function saveToDisk() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
}

async function refresh() {
  const season = currentSeason();
  try {
    // Last season never changes, so fetch it once and save it
    if (store.season !== season || Object.keys(store.lastSeason).length === 0) {
      console.log(`[ratings] fetching ${season - 1} season records (one-time, ~4 min)...`);
      store.lastSeason = await fetchSeasonRecords(season - 1);
      store.season = season;
      saveToDisk();
    }
    console.log(`[ratings] refreshing ${season} season records...`);
    store.current = await fetchSeasonRecords(season);
    store.updatedAt = new Date().toISOString();
    saveToDisk();
    console.log('[ratings] done');
  } catch (err) {
    console.error('[ratings] refresh failed:', err.message); // keep serving old data
  }
}

function start() {
  loadFromDisk();
  refresh();                          // runs in the background
  setInterval(refresh, REFRESH_EVERY_MS);
}

module.exports = { start, getWinPct, getRecord };