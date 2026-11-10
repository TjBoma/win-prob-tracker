require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { homeWinProbability, pregameEdge } = require('./winProbability');
const ratings = require('./teamRatings');

const app = express();
app.use(cors());

const BDL_BASE = 'https://api.balldontlie.io/v1';
const API_KEY = process.env.BALLDONTLIE_API_KEY;

// --- Simple in-memory cache (free tier = 5 requests/min) ---
const cache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

async function bdlGet(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return cached.data; // serve from cache, no API call
  }

  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: { Authorization: API_KEY },
  });
  if (!res.ok) {
    throw new Error(`balldontlie returned ${res.status}`);
  }

  const data = await res.json();
  cache.set(path, { data, time: Date.now() });
  return data;
}

// --- Routes ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend is running' });
});

// GET /api/games?date=YYYY-MM-DD&type=preseason
app.get('/api/games', async (req, res) => {
  const date = req.query.date || new Date().toLocaleDateString('en-CA');
  const type = req.query.type; // optional: preseason, regular, playoffs

  let path = `/games?dates[]=${date}&per_page=100`;
  if (type) path += `&season_type=${type}`;

  try {
    const data = await bdlGet(path);

    const games = data.data.map((g) => {
      const homeId = g.home_team.id;
      const awayId = g.visitor_team.id;

      const game = {
        id: g.id,
        status: g.status,
        state: g.status_state,
        period: g.period,
        clock: g.time,
        home: {
          team: g.home_team.abbreviation,
          score: g.home_team_score,
          record: ratings.getRecord(homeId),
        },
        away: {
          team: g.visitor_team.abbreviation,
          score: g.visitor_team_score,
          record: ratings.getRecord(awayId),
        },
      };

      const edge = pregameEdge(ratings.getWinPct(homeId), ratings.getWinPct(awayId));
      game.homeWinProb = homeWinProbability(game, edge);
      return game;
    });

    res.json({ date, count: games.length, games });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

ratings.start();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});