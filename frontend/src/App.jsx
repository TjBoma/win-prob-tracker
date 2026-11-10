import { useEffect, useState } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL;
const REFRESH_MS = 30000; // matches the backend's 30s cache

function todayLocal() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
}

// Scheduled games come as a UTC timestamp, e.g. "2026-10-20T23:00:00Z".
// Convert to the viewer's local time ("4:00 PM"). Anything else ("3rd Qtr", "Final") passes through.
function formatStatus(status, state) {
  if (state === 'scheduled') {
    const tipoff = new Date(status);
    if (!isNaN(tipoff)) {
      return tipoff.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }
  return status;
}

function GameCard({ game }) {
  const { home, away, status, state, clock } = game;
  const isLive = state === 'in_progress';
  const isFinal = state === 'final';
  const started = state !== 'scheduled';

  const homePct = Math.round(game.homeWinProb * 100);
  const awayPct = 100 - homePct;
  const label = formatStatus(status, state);

  return (
    <div className="card">
      <div className={`status ${isLive ? 'live' : ''}`}>
        {isLive ? `${label} · ${clock}` : label}
      </div>

      <div className={`row ${isFinal && away.score > home.score ? 'winner' : ''}`}>
        <span>{away.team} <small className="rec">{away.record}</small></span>
        <span>{started ? away.score : ''}</span>
      </div>
      <div className={`row ${isFinal && home.score > away.score ? 'winner' : ''}`}>
        <span>{home.team} <small className="rec">{home.record}</small></span>
        <span>{started ? home.score : ''}</span>
      </div>

      <div className="wp">
        <div className="wp-bar">
          <div className="wp-away" style={{ width: `${awayPct}%` }} />
          <div className="wp-home" style={{ width: `${homePct}%` }} />
        </div>
        <div className="wp-labels">
          <span>{away.team} {awayPct}%</span>
          <span>{home.team} {homePct}%</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [date, setDate] = useState(todayLocal());
  const [seasonType, setSeasonType] = useState('preseason');
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const params = new URLSearchParams({ date, type: seasonType });
        const res = await fetch(`${API_URL}/api/games?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);

        if (!cancelled) {
          setGames(data.games);
          setError(null);
          setLastUpdated(new Date());
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();
    const id = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [date, seasonType]);

  return (
    <main className="app">
      <header>
        <h1>Win Probability Tracker</h1>
        <div className="controls">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select value={seasonType} onChange={(e) => setSeasonType(e.target.value)}>
            <option value="preseason">Preseason</option>
            <option value="regular">Regular season</option>
            <option value="playoffs">Playoffs</option>
          </select>
        </div>
        {lastUpdated && (
          <p className="updated">
            Updated {lastUpdated.toLocaleTimeString()} · refreshes every 30s
          </p>
        )}
      </header>

      {loading && <p>Loading games...</p>}
      {error && <p className="error">Couldn't load games: {error}</p>}
      {!loading && !error && games.length === 0 && <p>No games on this date.</p>}

      <section className="grid">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </section>
    </main>
  );
}