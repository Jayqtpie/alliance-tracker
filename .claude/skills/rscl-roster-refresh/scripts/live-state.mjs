#!/usr/bin/env node
// Snapshot the deployed tracker state before importing a capture.
// Usage: node .claude/skills/rscl-roster-refresh/scripts/live-state.mjs --out .data/lastrank-refresh-<date>
// Env: TRACKER_BASE_URL (default the Vercel deployment), TRACKER_PASSCODE (officer or viewer passcode).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex < 0 || !args[outIndex + 1]) throw new Error('Provide --out <capture-directory>.');
const dir = path.resolve(args[outIndex + 1]);
const base = process.env.TRACKER_BASE_URL ?? 'https://alliance-tracker-nine.vercel.app';
const passcode = process.env.TRACKER_PASSCODE;
if (!passcode) throw new Error('Set TRACKER_PASSCODE to the viewer passcode (the TRACKER_PASSCODE secret in Actions).');

const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, Referer: base + '/login' },
  body: JSON.stringify({ passcode }),
  redirect: 'manual',
});
if (!login.ok) throw new Error('Login HTTP ' + login.status + ' ' + (await login.text()));
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const res = await fetch(base + '/api/state', { headers: { Cookie: cookie, Accept: 'application/json', Origin: base } });
if (!res.ok) throw new Error('State HTTP ' + res.status);
const body = await res.json();
const state = body.state ?? body;
if (!Array.isArray(state.members)) throw new Error('Unexpected state payload.');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'live-before.json'), JSON.stringify(state, null, 2));
console.log(JSON.stringify({
  base,
  version: state.version,
  members: state.members.length,
  active: state.members.filter(m => m.active).length,
  withPublicId: state.members.filter(m => m.gameProfile?.lastRankPublicId).length,
  snapshots: state.snapshots?.length,
  retained: state.members.filter(m => m.gameProfile?.refreshStatus === 'retained').map(m => m.canonicalName),
}));
