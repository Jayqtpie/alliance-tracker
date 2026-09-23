#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE = 'https://lastrank.fun/a/fca3217524a04960a147436cda692b69';
const ALLIANCE_ID = 'fca3217524a04960a147436cda692b69';
const SIX_HOURS = 24 * 60 * 60 * 1000; // user rule: max 1 day old

export function isFresh(profile, now = Date.now()) {
  if (typeof profile?.last_enriched_at !== 'string') return false;
  const measured = Date.parse(profile.last_enriched_at);
  const age = now - measured;
  return Number.isFinite(age) && age >= -60_000 && age <= SIX_HOURS;
}

export function summarize(capture, now = Date.now()) {
  const rows = Object.values(capture.profiles ?? {});
  const members = capture.alliance?.members ?? [];
  const ids = new Set(members.map(row => String(row.public_id)));
  const keyedIdentitiesValid = Object.entries(capture.profiles ?? {}).every(([id, row]) => id === String(row.data?.public_id));
  const fresh = rows.filter(row => isFresh(row.data, now));
  const mismatches = rows.filter(row => row.data?.alliance_id !== ALLIANCE_ID || row.data?.home_server_id !== 927);
  return {
    listed: members.length,
    sourceCount: capture.alliance?.cur_member ?? null,
    uniqueSourceIds: ids.size,
    profilesRead: rows.length,
    fresh: fresh.length,
    refreshRequested: rows.filter(row => row.refreshRequested).length,
    unresolved: rows.filter(row => !isFresh(row.data, now)).map(row => ({
      publicId: row.data?.public_id,
      name: row.data?.name,
      lastEnrichedAt: row.data?.last_enriched_at ?? null,
      status: row.refreshResponse?.enrich_status ?? row.refreshError ?? 'freshness-unverified',
    })),
    membershipMismatches: mismatches.map(row => ({ publicId: row.data?.public_id, name: row.data?.name, alliance: row.data?.alliance_id })),
    completeAndFresh: keyedIdentitiesValid && members.length > 0 && members.length === capture.alliance?.cur_member && ids.size === members.length && rows.length === ids.size && rows.every(row => ids.has(String(row.data?.public_id))) && fresh.length === rows.length && mismatches.length === 0,
  };
}

async function main(args) {
  if (args.includes('--help') || !args.length) {
    console.log('Usage: node capture-lastrank.mjs (--collect | --check) --out <ignored-staging-directory>\nCollect reads all RSCL profiles and refreshes records older than six hours. It resumes capture.json, checkpoints each profile, and never changes the tracker. Check validates saved coverage and freshness without network requests. Use a new dated directory for a new run.');
    return;
  }
  const collect = args.includes('--collect');
  const check = args.includes('--check');
  const outIndex = args.indexOf('--out');
  if (collect === check || outIndex < 0 || !args[outIndex + 1] || args[outIndex + 1].startsWith('--')) throw new Error('Choose --collect or --check and provide --out.');
  const dir = path.resolve(args[outIndex + 1]);
  const file = path.join(dir, 'capture.json');
  let capture;
  try { capture = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' || check) throw error; }
  if (capture && capture.source !== SOURCE) throw new Error('Saved capture belongs to a different source.');
  if (check) {
    const summary = summarize(capture);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.completeAndFresh ? 0 : 2;
    return;
  }
  await mkdir(dir, { recursive: true });
  let lastRequest = 0;
  let consecutiveTimeouts = 0;
  async function request(endpoint, method = 'GET') {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1050 - (Date.now() - lastRequest))));
    lastRequest = Date.now();
    const response = await fetch('https://lastrank.fun' + endpoint, {
      method,
      headers: { Accept: 'application/json', 'User-Agent': 'RSCL-roster-refresh/1.0' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Stopped on HTTP ${response.status} for ${endpoint}; resolve access, throttling or service failure before resuming.`);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Non-JSON response; possible challenge. Capture preserved.');
    return response.json();
  }
  async function checkpoint() {
    capture.exportedAt = new Date().toISOString();
    capture.summary = summarize(capture);
    await writeFile(file + '.tmp', JSON.stringify(capture, null, 2) + '\n');
    await rename(file + '.tmp', file);
  }
  const alliance = await request('/v1/alliances/' + ALLIANCE_ID);
  if (alliance.alliance_id !== ALLIANCE_ID || alliance.abbr !== 'RSCL' || alliance.server_id !== 927 || !Array.isArray(alliance.members)) throw new Error('Unexpected alliance response.');
  if (alliance.members.length !== alliance.cur_member || new Set(alliance.members.map(row => row.public_id)).size !== alliance.members.length) throw new Error('Incomplete or duplicated source roster.');
  if (capture && JSON.stringify(capture.alliance.members.map(x => x.public_id).sort()) !== JSON.stringify(alliance.members.map(x => x.public_id).sort())) throw new Error('Roster membership changed since checkpoint; reconcile before resuming.');
  capture ??= { source: SOURCE, capturedOn: new Date().toISOString().slice(0, 10), startedAt: new Date().toISOString(), alliance, initialProfiles: {}, profiles: {} };
  capture.alliance = alliance;
  await checkpoint();
  for (const member of alliance.members) {
    const id = String(member.public_id);
    if (capture.profiles[id]) continue;
    let data = await request('/v1/players/' + id);
    if (data.public_id !== member.public_id) throw new Error('Player identity mismatch.');
    capture.initialProfiles[id] ??= { retrievedAt: new Date().toISOString(), data };
    await checkpoint();
    let refreshRequested = false, refreshResponse = null, refreshError = null;
    if (capture.pendingRefresh?.publicId === id) {
      refreshRequested = true;
      refreshResponse = capture.pendingRefresh.refreshResponse;
      refreshError = capture.pendingRefresh.refreshError;
    } else if (!isFresh(data)) {
      refreshRequested = true;
      try {
        refreshResponse = await request('/v1/players/' + id + '/enrich', 'POST');
        if (refreshResponse.public_id !== member.public_id) throw new Error('Refresh identity mismatch.');
        consecutiveTimeouts = 0;
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        refreshError = 'timeout; outcome verified by subsequent GET';
        consecutiveTimeouts++;
      }
      // Keep the refresh result even if a subsequent GET fails.
      capture.pendingRefresh = { publicId: id, refreshResponse, refreshError, at: new Date().toISOString() };
      await checkpoint();
      data = await request('/v1/players/' + id);
      if (data.public_id !== member.public_id) throw new Error('Reread identity mismatch.');
    }
    capture.profiles[id] = { retrievedAt: new Date().toISOString(), beforeLastEnrichedAt: capture.initialProfiles[id].data.last_enriched_at ?? null, refreshRequested, refreshResponse, refreshError, freshnessPassed: isFresh(data), data };
    delete capture.pendingRefresh;
    await checkpoint();
    const summary = capture.summary;
    console.log(JSON.stringify({ checked: summary.profilesRead, total: summary.listed, fresh: summary.fresh, unresolved: summary.unresolved.length }));
    if (consecutiveTimeouts >= 3) throw new Error('Three consecutive refresh timeouts; capture preserved.');
  }
  console.log(JSON.stringify(capture.summary, null, 2));
  process.exitCode = capture.summary.completeAndFresh ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
