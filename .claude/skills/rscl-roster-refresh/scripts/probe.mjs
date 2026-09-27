#!/usr/bin/env node
// Decide whether a refresh is worth running, and from which source, without a Claude session.
// Usage (from repo root): node .claude/skills/rscl-roster-refresh/scripts/probe.mjs
// Prints counts only (Actions logs are public) and, under Actions, writes changed=true|false and
// source=lastrank|lwservers to $GITHUB_OUTPUT. Exit 1 means the probe itself failed; treat that as "do not run".
//
// The alliance list is a daily snapshot (its last_seen_at moves roughly once a day) and our
// own enrich requests never update it, so it is compared against the snapshot the last export
// was built from, not against that export's enriched values alone.
//
// Backup: when LastRank's list is more than two days old (or LastRank fails), lwservers.com's
// public warzone 927 snapshot is checked instead; source=lwservers selects the skill's backup pipeline.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';

const ALLIANCE_ID = 'fca3217524a04960a147436cda692b69';
const PROFESSIONS = { 101: 'Engineer', 102: 'War Leader' };
const DAY = 24 * 60 * 60 * 1000, LASTRANK_STALE_AFTER = 2 * DAY;

const exportFile = readdirSync('lib/data').filter(f => /^rscl-roster-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
if (!exportFile) throw new Error('No roster export in lib/data to compare against.');
const prior = JSON.parse(readFileSync('lib/data/' + exportFile, 'utf8'));

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'RSCL-roster-refresh/1.0' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Non-JSON response; possible challenge.');
  return response.json();
}

function output(result) {
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.run}\nsource=${result.source}\n`);
}

// Mirrors build-capture-lwservers.cjs: only rows lwservers confirmed within 24 hours with a dated reading count.
async function probeLwservers(lastRank) {
  const manifest = await getJson('https://lwservers.com/data/snapshots/805-932/manifest.json');
  const players = await getJson('https://lwservers.com/data/snapshots/805-932/players/927.json');
  if (!Array.isArray(players)) throw new Error('Unexpected lwservers payload.');
  const snapshotMoved = Date.parse(manifest.generatedAt) > Date.parse(prior.sourceRosterUpdatedAt);
  const byUid = new Map(prior.members.map(m => [m.uid, m]));
  const reading = v => (typeof v === 'number' && v > 0 ? v : null);
  const changed = { name: 0, power: 0, heroPower: 0, kills: 0 };
  let fresh = 0, rowsChanged = 0;
  for (const p of players.filter(row => row.allianceId === ALLIANCE_ID)) {
    const m = byUid.get(p.uid), confirmed = (p.lastConfirmedAt?.seconds ?? 0) * 1000;
    const d = p.daily && p.daily.date >= new Date(confirmed - DAY).toISOString().slice(0, 10) ? p.daily : null;
    if (!m || Date.now() - confirmed > DAY || !d) continue;
    const values = { power: reading(d.power), heroPower: reading(d.heroPower), kills: reading(d.kills) };
    if (!Object.values(values).some(v => v !== null)) continue;
    fresh++;
    const diff = {
      name: p.name !== m.name,
      power: values.power !== null && values.power !== m.profile.power,
      heroPower: values.heroPower !== null && values.heroPower !== m.profile.heroPower,
      kills: values.kills !== null && values.kills !== m.profile.killsApproximate,
    };
    for (const key of Object.keys(diff)) if (diff[key]) changed[key]++;
    if (Object.values(diff).some(Boolean)) rowsChanged++;
  }
  const run = snapshotMoved && rowsChanged > 0;
  output({
    run, source: 'lwservers', reason: !snapshotMoved ? 'LastRank stale and no lwservers snapshot newer than the last export' : run ? 'LastRank stale; lwservers snapshot with changes' : 'LastRank stale; lwservers snapshot but nothing changed',
    lastRank, lastExport: exportFile, lastExportSnapshot: prior.sourceRosterUpdatedAt, snapshot: manifest.generatedAt, freshRows: fresh, rowsChanged, changed,
  });
}

let alliance;
try {
  alliance = await getJson('https://lastrank.fun/v1/alliances/' + ALLIANCE_ID);
  if (alliance.alliance_id !== ALLIANCE_ID || alliance.abbr !== 'RSCL' || alliance.server_id !== 927 || !Array.isArray(alliance.members)) throw new Error('Unexpected alliance response.');
} catch (error) {
  await probeLwservers({ error: error.message });
  process.exit();
}

const snapshotMoved = Date.parse(alliance.last_seen_at) > Date.parse(prior.sourceRosterUpdatedAt);

// Players the last run saw in the list: mapped rows with a source membership plus the
// UID-less players it skipped. Members kept only because they were absent are not listed.
const previouslyListed = new Set([
  ...prior.members.filter(m => m.sourceMembership).map(m => m.lastRankPublicId),
  ...prior.unresolvedIdentities.map(u => u.publicId).filter(id => !id.startsWith('uid:')),
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
if (!run && Date.now() - Date.parse(alliance.last_seen_at) > LASTRANK_STALE_AFTER) {
  await probeLwservers({ snapshot: alliance.last_seen_at, stale: true });
} else {
  const reason = !snapshotMoved ? 'no new LastRank snapshot since the last export' : run ? 'new snapshot with changes' : 'new snapshot but nothing changed';
  output({
    run, source: 'lastrank', reason, lastExport: exportFile, lastExportSnapshot: prior.sourceRosterUpdatedAt, snapshot: alliance.last_seen_at,
    listed: listed.size, joined, left, rowsChanged, changed, retainedInLastExport: prior.retainedProfileCount,
  });
}
