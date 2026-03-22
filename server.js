const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const AUCTION_FILE = path.join(__dirname, '..', 'ipl-auction-manager', 'data', 'auction-state.json');
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');

const TEAMS = ['Ragu', 'RK', 'Darshan', 'Prabhu', 'Dots', 'JD', 'Rijo', 'Prakash'];

// ========== Load auction rosters ==========
function loadRosters() {
  const state = JSON.parse(fs.readFileSync(AUCTION_FILE, 'utf8'));
  // Build player map from soldLog
  const playerMap = {}; // playerId -> { team, price }
  for (const entry of state.soldLog) {
    playerMap[entry.playerId] = { team: entry.team, price: entry.price };
  }
  return { soldLog: state.soldLog, playerMap };
}

// We also need player details from the auction xlsx - but let's read from the auction API
// Instead, store a players.json on first load
const PLAYERS_CACHE = path.join(__dirname, 'data', 'players-cache.json');

function getPlayers() {
  if (fs.existsSync(PLAYERS_CACHE)) {
    return JSON.parse(fs.readFileSync(PLAYERS_CACHE, 'utf8'));
  }
  return [];
}

// ========== Match data ==========
function getMatchFiles() {
  if (!fs.existsSync(MATCHES_DIR)) return [];
  return fs.readdirSync(MATCHES_DIR)
    .filter(f => f.endsWith('.json') || f.endsWith('.csv'))
    .sort();
}

function parseCSVMatch(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');

  // Parse header comments for title and date
  let title = '', date = '', abandoned = false;
  const players = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      // First comment line: "# CSK vs MI - Match 1"
      if (!title && /^#\s+\w+\s+vs\s+\w+/.test(trimmed)) {
        title = trimmed.replace(/^#\s*/, '');
      }
      // Second comment line: "# 2026-03-22"
      if (!date && /^#\s+\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        date = trimmed.replace(/^#\s*/, '').trim();
      }
      // Check for abandoned
      if (/abandoned/i.test(trimmed)) {
        abandoned = true;
      }
      continue;
    }

    // Data row: id, name, ipl_team, fantasy_team, playing, mom, runs, 4s, 6s, wkts, dots, maidens, lbw_b_hw, catches, ro_direct, ro_indirect, stumpings
    const cols = trimmed.split(',').map(c => c.trim());
    if (cols.length < 17) continue;

    const id = parseInt(cols[0]);
    if (isNaN(id)) continue;

    const playing = parseInt(cols[4]) === 1;
    const mom = parseInt(cols[5]) === 1;
    const runs = parseInt(cols[6]) || 0;
    const fours = parseInt(cols[7]) || 0;
    const sixes = parseInt(cols[8]) || 0;
    const wickets = parseInt(cols[9]) || 0;
    const dots = parseInt(cols[10]) || 0;
    const maidens = parseInt(cols[11]) || 0;
    const lbwBowledHw = parseInt(cols[12]) || 0;
    const catches = parseInt(cols[13]) || 0;
    const runoutDirect = parseInt(cols[14]) || 0;
    const runoutIndirect = parseInt(cols[15]) || 0;
    const stumpings = parseInt(cols[16]) || 0;

    // Only include players who played or have any stats
    const hasStats = playing || mom || runs || fours || sixes || wickets || dots || maidens || lbwBowledHw || catches || runoutDirect || runoutIndirect || stumpings;
    if (!hasStats) continue;

    players[id] = {
      playing, mom,
      batting: { runs, fours, sixes },
      bowling: { wickets, dots, maidens, lbwBowledHw },
      fielding: { catches, runoutDirect, runoutIndirect, stumpings }
    };
  }

  // Extract match id from filename
  const basename = path.basename(filepath, '.csv');
  const matchId = basename.replace('match-', '');

  return { id: matchId, title: title || basename, date, abandoned, players };
}

function loadMatch(filename) {
  const filepath = path.join(MATCHES_DIR, filename);
  if (filename.endsWith('.csv')) {
    return parseCSVMatch(filepath);
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function loadAllMatches() {
  return getMatchFiles().map(f => loadMatch(f));
}

// ========== Fantasy Points Calculation ==========
function calcBattingPoints(stats) {
  let pts = 0;
  const runs = stats.runs || 0;
  const fours = stats.fours || 0;
  const sixes = stats.sixes || 0;

  pts += runs;                          // 1 point per run
  pts += fours * 1;                     // 1 additional per four
  pts += sixes * 2;                     // 2 additional per six
  if (runs >= 30) pts += 5;             // milestone bonuses (cumulative)
  if (runs >= 50) pts += 10;
  if (runs >= 100) pts += 10;

  return pts;
}

function calcBowlingPoints(stats) {
  let pts = 0;
  const wickets = stats.wickets || 0;
  const dots = stats.dots || 0;
  const maidens = stats.maidens || 0;
  const lbwBowledHw = stats.lbwBowledHw || 0;

  pts += dots * 1;                      // 1 point per dot
  pts += wickets * 20;                  // 20 per wicket
  if (wickets >= 2) pts += 5;           // milestone bonuses (cumulative)
  if (wickets >= 3) pts += 10;
  if (wickets >= 5) pts += 10;
  pts += maidens * 20;                  // 20 per maiden
  pts += lbwBowledHw * 5;              // 5 per LBW/Bowled/Hit-wicket

  return pts;
}

function calcFieldingPoints(stats) {
  let pts = 0;
  pts += (stats.catches || 0) * 5;      // 5 per catch
  pts += (stats.runoutDirect || 0) * 10; // 10 per direct hit run-out
  pts += (stats.runoutIndirect || 0) * 5;// 5 per indirect run-out
  pts += (stats.stumpings || 0) * 10;    // 10 per stumping
  return pts;
}

function calcPlayerMatchPoints(playerMatch) {
  let total = 0;

  if (playerMatch.playing) total += 5;   // Playing 12 bonus

  if (playerMatch.batting) total += calcBattingPoints(playerMatch.batting);
  if (playerMatch.bowling) total += calcBowlingPoints(playerMatch.bowling);
  if (playerMatch.fielding) total += calcFieldingPoints(playerMatch.fielding);
  if (playerMatch.mom) total += 30;      // Man of the Match

  return total;
}

// ========== API Routes ==========

// Sync players from auction manager
app.post('/api/sync-players', async (req, res) => {
  try {
    const response = await fetch('http://localhost:3000/api/teams');
    const teams = await response.json();

    const players = [];
    for (const [team, data] of Object.entries(teams)) {
      for (const p of data.players) {
        players.push({
          id: p.id,
          name: p.name,
          category: p.category,
          iplTeam: p.iplTeam,
          foreign: p.foreign,
          fantasyTeam: team,
          soldPrice: p.soldPrice
        });
      }
    }

    fs.writeFileSync(PLAYERS_CACHE, JSON.stringify(players, null, 2));
    res.json({ success: true, count: players.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not sync from auction manager. Is it running on port 3000?' });
  }
});

// Get all players with rosters
app.get('/api/players', (req, res) => {
  res.json(getPlayers());
});

// Get team standings
app.get('/api/standings', (req, res) => {
  const players = getPlayers();
  const matches = loadAllMatches();

  // Build points per player
  const playerPoints = {}; // playerId -> { total, matches: [{matchId, points}] }
  for (const p of players) {
    playerPoints[p.id] = { total: 0, matchCount: 0, matches: [] };
  }

  for (const match of matches) {
    if (match.abandoned) continue;
    for (const [playerId, stats] of Object.entries(match.players || {})) {
      const pid = parseInt(playerId);
      const pts = calcPlayerMatchPoints(stats);
      if (!playerPoints[pid]) playerPoints[pid] = { total: 0, matchCount: 0, matches: [] };
      playerPoints[pid].total += pts;
      playerPoints[pid].matchCount++;
      playerPoints[pid].matches.push({ matchId: match.id, matchTitle: match.title, points: pts });
    }
  }

  // Build team standings
  const teamStandings = {};
  for (const team of TEAMS) {
    const teamPlayers = players.filter(p => p.fantasyTeam === team);
    let teamTotal = 0;
    const playerDetails = teamPlayers.map(p => {
      const pp = playerPoints[p.id] || { total: 0, matchCount: 0, matches: [] };
      teamTotal += pp.total;
      return { ...p, points: pp.total, matchCount: pp.matchCount, matchDetails: pp.matches };
    });
    playerDetails.sort((a, b) => b.points - a.points);
    teamStandings[team] = { total: teamTotal, players: playerDetails };
  }

  // Sort teams by total
  const sorted = Object.entries(teamStandings)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([team, data], i) => ({ rank: i + 1, team, ...data }));

  res.json(sorted);
});

// Get all matches
app.get('/api/matches', (req, res) => {
  res.json(loadAllMatches().reverse());
});

// Get single match
app.get('/api/matches/:id', (req, res) => {
  const jsonFile = `match-${req.params.id}.json`;
  const csvFile = `match-${req.params.id}.csv`;
  const jsonPath = path.join(MATCHES_DIR, jsonFile);
  const csvPath = path.join(MATCHES_DIR, csvFile);
  if (fs.existsSync(csvPath)) return res.json(loadMatch(csvFile));
  if (fs.existsSync(jsonPath)) return res.json(loadMatch(jsonFile));
  return res.status(404).json({ error: 'Match not found' });
});

// Create/update match
app.post('/api/matches', (req, res) => {
  const match = req.body;
  if (!match.id || !match.title) return res.status(400).json({ error: 'Match id and title required' });

  const filename = `match-${match.id}.json`;
  fs.writeFileSync(path.join(MATCHES_DIR, filename), JSON.stringify(match, null, 2));
  res.json({ success: true, match });
});

// Delete match
app.delete('/api/matches/:id', (req, res) => {
  const filename = `match-${req.params.id}.json`;
  const filepath = path.join(MATCHES_DIR, filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  res.json({ success: true });
});

// Dashboard summary
app.get('/api/dashboard', (req, res) => {
  const players = getPlayers();
  const matches = loadAllMatches();

  // Build per-player points
  const playerPoints = {};
  for (const p of players) {
    playerPoints[p.id] = { total: 0, matchCount: 0, bestMatch: 0, bestMatchTitle: '' };
  }

  let totalMatches = 0;
  for (const match of matches) {
    if (match.abandoned) continue;
    totalMatches++;
    for (const [playerId, stats] of Object.entries(match.players || {})) {
      const pid = parseInt(playerId);
      const pts = calcPlayerMatchPoints(stats);
      if (!playerPoints[pid]) playerPoints[pid] = { total: 0, matchCount: 0, bestMatch: 0, bestMatchTitle: '' };
      playerPoints[pid].total += pts;
      playerPoints[pid].matchCount++;
      if (pts > playerPoints[pid].bestMatch) {
        playerPoints[pid].bestMatch = pts;
        playerPoints[pid].bestMatchTitle = match.title;
      }
    }
  }

  // Top 10 players
  const topPlayers = players
    .map(p => ({ ...p, ...playerPoints[p.id] }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Best single-match performance
  let bestPerf = { points: 0 };
  for (const match of matches) {
    if (match.abandoned) continue;
    for (const [playerId, stats] of Object.entries(match.players || {})) {
      const pts = calcPlayerMatchPoints(stats);
      if (pts > bestPerf.points) {
        const p = players.find(pl => pl.id === parseInt(playerId));
        bestPerf = { points: pts, playerName: p ? p.name : 'Unknown', fantasyTeam: p ? p.fantasyTeam : '', matchTitle: match.title, stats };
      }
    }
  }

  // Team totals
  const teamTotals = {};
  for (const team of TEAMS) {
    const teamPlayers = players.filter(p => p.fantasyTeam === team);
    teamTotals[team] = teamPlayers.reduce((sum, p) => sum + (playerPoints[p.id] ? playerPoints[p.id].total : 0), 0);
  }
  const sortedTeams = Object.entries(teamTotals).sort((a, b) => b[1] - a[1]).map(([team, total], i) => ({ rank: i + 1, team, total }));

  res.json({ totalMatches, totalPlayers: players.length, topPlayers, bestPerformance: bestPerf, teamRankings: sortedTeams });
});

// Match detail with points breakdown per fantasy team
app.get('/api/matches/:id/detail', (req, res) => {
  const jsonFile = `match-${req.params.id}.json`;
  const csvFile = `match-${req.params.id}.csv`;
  const jsonPath = path.join(MATCHES_DIR, jsonFile);
  const csvPath = path.join(MATCHES_DIR, csvFile);
  let filename;
  if (fs.existsSync(csvPath)) filename = csvFile;
  else if (fs.existsSync(jsonPath)) filename = jsonFile;
  else return res.status(404).json({ error: 'Match not found' });

  const match = loadMatch(filename);
  const players = getPlayers();

  const teamBreakdown = {};
  for (const team of TEAMS) {
    teamBreakdown[team] = { total: 0, players: [] };
  }

  for (const [playerId, stats] of Object.entries(match.players || {})) {
    const pid = parseInt(playerId);
    const p = players.find(pl => pl.id === pid);
    if (!p) continue;
    const pts = match.abandoned ? 0 : calcPlayerMatchPoints(stats);
    const team = p.fantasyTeam;
    if (teamBreakdown[team]) {
      teamBreakdown[team].total += pts;
      teamBreakdown[team].players.push({ ...p, points: pts, stats });
    }
  }

  for (const team of TEAMS) {
    teamBreakdown[team].players.sort((a, b) => b.points - a.points);
  }

  res.json({ match, teamBreakdown });
});

// All players with per-match category-wise breakdown
app.get('/api/players/details', (req, res) => {
  const players = getPlayers();
  const matches = loadAllMatches();

  const result = players.map(p => {
    const matchBreakdowns = [];
    let total = 0;

    for (const match of matches) {
      if (match.abandoned) continue;
      const stats = (match.players || {})[p.id];
      if (!stats) continue;

      const playingPts = stats.playing ? 5 : 0;
      const battingPts = stats.batting ? calcBattingPoints(stats.batting) : 0;
      const bowlingPts = stats.bowling ? calcBowlingPoints(stats.bowling) : 0;
      const fieldingPts = stats.fielding ? calcFieldingPoints(stats.fielding) : 0;
      const momPts = stats.mom ? 30 : 0;
      const matchTotal = playingPts + battingPts + bowlingPts + fieldingPts + momPts;
      total += matchTotal;

      matchBreakdowns.push({
        matchId: match.id,
        matchTitle: match.title,
        matchDate: match.date,
        total: matchTotal,
        playing: playingPts,
        batting: battingPts,
        bowling: bowlingPts,
        fielding: fieldingPts,
        mom: momPts,
        stats
      });
    }

    return {
      ...p,
      total,
      matchCount: matchBreakdowns.length,
      matches: matchBreakdowns
    };
  });

  result.sort((a, b) => b.total - a.total);
  res.json(result);
});

// Points rules reference
app.get('/api/rules', (req, res) => {
  res.json({
    playing12: 5,
    batting: {
      perRun: 1, perFour: 1, perSix: 2,
      bonus30: 5, bonus50: 10, bonus100: 10
    },
    bowling: {
      perDot: 1, perWicket: 20,
      bonus2w: 5, bonus3w: 10, bonus5w: 10,
      perMaiden: 20, perLbwBowledHw: 5
    },
    fielding: {
      perCatch: 5, perRunoutDirect: 10,
      perRunoutIndirect: 5, perStumping: 10
    },
    mom: 30
  });
});

app.listen(PORT, () => {
  console.log(`Fantasy Points Tracker running at http://localhost:${PORT}`);
});
