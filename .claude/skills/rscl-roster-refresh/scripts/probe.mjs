#!/usr/bin/env node
// Decide whether a refresh is worth running, with one request and no Claude session.
// Usage (from repo root): node .claude/skills/rscl-roster-refresh/scripts/probe.mjs
// Prints counts only (Actions logs are public) and, under Actions, writes changed=true|false
// to $GITHUB_OUTPUT. Exit 1 means the probe itself failed; treat that as "do not run".
//
// The alliance list is a daily snapshot (its last_seen_at moves roughly once a day) and our
// own enrich requests never update it, so it is compared against the snapshot the last export
// was built from, not against that export's enriched values alone.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';

const ALLIANCE_ID = 'fca3217524a04960a147436cda692b69';
const PROFESSIONS = { 101: 'Engineer', 102: 'War Leader' };

const exportFile = readdirSync('lib/data').filter(f => /^rscl-roster-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
if (!exportFile) throw new Error('No roster export in lib/data to compare against.');
const prior = JSON.parse(readFileSync('lib/data/' + exportFile, 'utf8'));

const response = await fetch('https://lastrank.fun/v1/alliances/' + ALLIANCE_ID, {
  headers: { Accept: 'application/json', 'User-Agent': 'RSCL-roster-refresh/1.0' },
  signal: AbortSignal.timeout(45_000),
});
if (!response.ok) throw new Error('Alliance list HTTP ' + response.status);
if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Non-JSON response; possible challenge.');
const alliance = await response.json();
if (alliance.alliance_id !== ALLIANCE_ID || alliance.abbr !== 'RSCL' || alliance.server_id !== 927 || !Array.isArray(alliance.members)) throw new Error('Unexpected alliance response.');

const snapshotMoved = Date.parse(alliance.last_seen_at) > Date.parse(prior.sourceRosterUpdatedAt);

// Players the last run saw in the list: mapped rows with a source membership plus the
// UID-less players it skipped. Members kept only because they were absent are not listed.
const previouslyListed = new Set([
  ...prior.members.filter(m => m.sourceMembership).map(m => m.lastRankPublicId),
  ...prior.unresolvedIdentities.map(u => u.publicId),
]);
const listed = new Set(alliance.members.map(row => String(row.public_id)));
const joined = [...listed].filter(id => !previouslyListed.has(id)).length;
const left = [...previouslyListed].filter(id => !listed.has(id)).length;

// Retained rows hold older tracker values by design, so only fresh rows can show drift.
const fresh = new Map(prior.members.filter(m => m.freshness.status === 'fresh').map(m => [m.lastRankPublicId, m]));
const changed = { name: 0, rank: 0, profession: 0, power: 0, heroPower: 0 };
let rowsChanged = 0;
for (const row of alliance.members) {
  const m = fresh.get(String(row.public_id));
  if (!m) continue;
  const diff = {
    name: row.name !== m.name,
    rank: 'R' + row.alliance_rank !== m.rank,
    profession: (PROFESSIONS[row.career_type] ?? null) !== m.profile.profession,
    power: row.power !== m.profile.power,
    heroPower: row.hero_power !== m.profile.heroPower,
  };
  for (const key of Object.keys(diff)) if (diff[key]) changed[key]++;
  if (Object.values(diff).some(Boolean)) rowsChanged++;
}

const run = snapshotMoved && (joined + left + rowsChanged > 0);
const reason = !snapshotMoved ? 'no new LastRank snapshot since the last export' : run ? 'new snapshot with changes' : 'new snapshot but nothing changed';
console.log(JSON.stringify({
  run, reason, lastExport: exportFile, lastExportSnapshot: prior.sourceRosterUpdatedAt, snapshot: alliance.last_seen_at,
  listed: listed.size, joined, left, rowsChanged, changed, retainedInLastExport: prior.retainedProfileCount,
}));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${run}\n`);
