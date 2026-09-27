#!/usr/bin/env node
// Backup source: save lwservers.com's public warzone 927 snapshot for build-capture-lwservers.cjs.
// Usage (from repo root): node .claude/skills/rscl-roster-refresh/scripts/collect-lwservers.mjs --out .data/lwservers-refresh-<date>
// Three GETs of static files the lwservers site itself serves; no enrich, no API. Never changes the tracker.
// lwservers keys players by game UID, the same ID the tracker stores, so no name matching is needed.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const SOURCE = 'https://lwservers.com/data/snapshots/805-932/players/927.json';
const BASE = 'https://lwservers.com/data';
const ALLIANCE_ID = 'fca3217524a04960a147436cda692b69';
const MAX_SNAPSHOT_AGE = 48 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex < 0 || !args[outIndex + 1] || args[outIndex + 1].startsWith('--')) throw new Error('Provide --out <ignored-staging-directory>.');
const dir = path.resolve(args[outIndex + 1]);

async function get(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'RSCL-roster-refresh/1.0' }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Non-JSON response for ' + url + '; possible challenge.');
  return response.json();
}

const manifest = await get(BASE + '/snapshots/805-932/manifest.json');
const players = await get(SOURCE);
const membership = await get(BASE + '/global/warzone-members.json');

if (manifest.segment !== '805-932' || !Date.parse(manifest.generatedAt)) throw new Error('Unexpected manifest.');
const age = Date.now() - Date.parse(manifest.generatedAt);
if (age > MAX_SNAPSHOT_AGE) throw new Error(`lwservers snapshot is ${Math.round(age / 3.6e6)}h old; the backup is stale too.`);
if (!Array.isArray(players) || !players.length) throw new Error('Unexpected players payload.');
for (const p of players) {
  if (typeof p.uid !== 'string' || !/^\d+$/.test(p.uid) || p.warzone !== 927) throw new Error('Unexpected player row ' + JSON.stringify(p).slice(0, 120));
}
if (new Set(players.map(p => p.uid)).size !== players.length) throw new Error('Duplicated UIDs in source.');

const retrievedAt = new Date().toISOString();
const listed = players.filter(p => p.allianceId === ALLIANCE_ID);
const confirmedWithinDay = listed.filter(p => Date.parse(retrievedAt) - (p.lastConfirmedAt?.seconds ?? 0) * 1000 <= 24 * 60 * 60 * 1000);
const capture = {
  source: SOURCE,
  capturedOn: retrievedAt.slice(0, 10),
  retrievedAt,
  snapshotGeneratedAt: manifest.generatedAt,
  // lwservers' weekly in-game roster sweep: a member count only, no names.
  allianceMemberCount: membership.alliances?.[ALLIANCE_ID] ?? null,
  allianceMemberCountDate: membership.snapDate ?? null,
  players,
};
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'capture.json.tmp'), JSON.stringify(capture, null, 2) + '\n');
await rename(path.join(dir, 'capture.json.tmp'), path.join(dir, 'capture.json'));
console.log(JSON.stringify({
  snapshotGeneratedAt: manifest.generatedAt, warzonePlayers: players.length, rsclListed: listed.length,
  rsclConfirmedWithin24h: confirmedWithinDay.length, allianceMemberCount: capture.allianceMemberCount,
}));
