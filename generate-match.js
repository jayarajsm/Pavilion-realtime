#!/usr/bin/env node
/**
 * Generate a match template CSV file.
 *
 * Usage:
 *   node generate-match.js <team1> <team2> <matchNumber>
 *
 * Example:
 *   node generate-match.js CSK MI 1
 *   → creates data/matches/match-1.csv
 *
 * Teams: CSK, DC, GT, KKR, LSG, MI, PBKS, RCB, RR, SRH
 *
 * After generating, open the file and fill in the stats.
 * Set playing to 1 for players in the Playing 12.
 * Save and refresh the website.
 */

const fs = require('fs');
const path = require('path');

const PLAYERS_FILE = path.join(__dirname, 'data', 'players-cache.json');
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');

const args = process.argv.slice(2);

if (args.length < 3) {
  console.log(`
Usage: node generate-match.js <team1> <team2> <matchNumber>

Example:
  node generate-match.js CSK MI 1
  node generate-match.js RCB KKR 15

Teams: CSK, DC, GT, KKR, LSG, MI, PBKS, RCB, RR, SRH
`);
  process.exit(1);
}

const team1 = args[0].toUpperCase();
const team2 = args[1].toUpperCase();
const matchNum = args[2];

if (!fs.existsSync(PLAYERS_FILE)) {
  console.error('Error: data/players-cache.json not found. Sync players first.');
  process.exit(1);
}

const allPlayers = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
const validTeams = [...new Set(allPlayers.map(p => p.iplTeam))].sort();

if (!validTeams.includes(team1)) {
  console.error(`Invalid team: ${team1}. Valid: ${validTeams.join(', ')}`);
  process.exit(1);
}
if (!validTeams.includes(team2)) {
  console.error(`Invalid team: ${team2}. Valid: ${validTeams.join(', ')}`);
  process.exit(1);
}

if (!fs.existsSync(MATCHES_DIR)) {
  fs.mkdirSync(MATCHES_DIR, { recursive: true });
}

const filename = `match-${matchNum}.csv`;
const filepath = path.join(MATCHES_DIR, filename);

if (fs.existsSync(filepath)) {
  console.error(`File already exists: ${filepath}`);
  process.exit(1);
}

const today = new Date().toISOString().split('T')[0];
const t1Players = allPlayers.filter(p => p.iplTeam === team1);
const t2Players = allPlayers.filter(p => p.iplTeam === team2);

let csv = '';
csv += `# ${team1} vs ${team2} - Match ${matchNum}\n`;
csv += `# ${today}\n`;
csv += `#\n`;
csv += `# playing: 1 = in Playing 12, 0 = not playing\n`;
csv += `# mom: 1 = Man of the Match\n`;
csv += `# Fill stats from Cricbuzz scorecard. Leave 0 for no contribution.\n`;
csv += `#\n`;
csv += `# id, name, ipl_team, fantasy_team, playing, mom, runs, 4s, 6s, wkts, dots, maidens, lbw_b_hw, catches, ro_direct, ro_indirect, stumpings\n`;
csv += `\n`;

csv += `# --- ${team1} ---\n`;
for (const p of t1Players) {
  csv += `${p.id}, ${p.name}, ${p.iplTeam}, ${p.fantasyTeam}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0\n`;
}

csv += `\n# --- ${team2} ---\n`;
for (const p of t2Players) {
  csv += `${p.id}, ${p.name}, ${p.iplTeam}, ${p.fantasyTeam}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0\n`;
}

fs.writeFileSync(filepath, csv);

console.log(`
Created: ${filepath}

${team1} (${t1Players.length} players):
${t1Players.map(p => `  ${p.name} → ${p.fantasyTeam}`).join('\n')}

${team2} (${t2Players.length} players):
${t2Players.map(p => `  ${p.name} → ${p.fantasyTeam}`).join('\n')}

Open the file, fill in stats, save, and refresh the site.
`);
