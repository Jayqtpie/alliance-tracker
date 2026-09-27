// Backup builder: lib/data/rscl-roster-<date>.json from collect-lwservers.mjs output, for when LastRank is stale.
// Usage (from repo root): node .claude/skills/rscl-roster-refresh/scripts/build-capture-lwservers.cjs --date 2026-09-27
// Reads .data/lwservers-refresh-<date>/{capture.json,live-before.json} and the newest earlier roster export.
// Same owner rules as build-capture.cjs: identity by stored game UID, 24-hour freshness, absent members kept, unmapped skipped.
const fs = require('node:fs'), crypto = require('node:crypto'), sharp = require('sharp');
const args = process.argv.slice(2);
const DATE = args[args.indexOf('--date') + 1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE ?? '')) throw new Error('Provide --date YYYY-MM-DD.');
const dir = '.data/lwservers-refresh-' + DATE, ALLIANCE = 'fca3217524a04960a147436cda692b69', DAY = 24 * 60 * 60 * 1000;
const out = 'lib/data/rscl-roster-' + DATE + '.json';
const priorFile = fs.readdirSync('lib/data').filter(f => /^rscl-roster-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < 'rscl-roster-' + DATE).sort().pop();
if (!priorFile) throw new Error('No earlier roster export to compare against.');
const raw = JSON.parse(fs.readFileSync(dir + '/capture.json', 'utf8'));
const prior = JSON.parse(fs.readFileSync('lib/data/' + priorFile, 'utf8'));
const live = JSON.parse(fs.readFileSync(dir + '/live-before.json', 'utf8'));
if (fs.existsSync(out) && JSON.parse(fs.readFileSync(out, 'utf8')).source !== raw.source) throw new Error(out + ' is a LastRank export; the primary source wins on the same date.');
const display = n => { if (n === null || n === undefined) return '—'; for (const [u, d] of [['B', 1e9], ['M', 1e6], ['K', 1e3]]) if (n >= d) return Number((n / d).toFixed(2)) + u; return String(n); };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const pathname = s => { try { return new URL(s).pathname; } catch { return null; } };
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
// lwservers writes 0 or null for a stat it did not read; neither is a real value.
const reading = v => (typeof v === 'number' && v > 0 ? v : null);

async function avatar(url, uid, currentPath) {
  // Same image path on the game's second CDN host, which LastRank also lists as a failover.
  const failover = url && url.replace('://lastwar-cdn.akamaized.net/', '://lastwar-cdn.lastwarapp.net/');
  for (const candidate of [...new Set([url, failover].filter(Boolean))]) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer()), meta = await sharp(bytes).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || !meta.height) throw new Error('Unusable image');
      const previous = currentPath && fs.existsSync('public' + currentPath) ? hash(fs.readFileSync('public' + currentPath)) : null;
      if (hash(bytes) === previous) return { url: candidate, file: currentPath.replace(/^\//, ''), status: 'validated-current', changed: false };
      const file = 'avatars/rscl/' + uid + '-lwservers-' + DATE + '.' + (meta.format === 'jpeg' ? 'jpg' : meta.format);
      fs.writeFileSync('public/' + file, bytes);
      return { url: candidate, file, status: 'validated-current', changed: true };
    } catch (e) { console.log('avatar attempt failed', uid, candidate, e.message); }
  }
  return { url: null, file: currentPath.replace(/^\//, ''), status: 'retained-download-failed', changed: false };
}

const retainedProfile = (gp, killsStatus) => ({ source: gp.source, capturedOn: gp.capturedOn, heroPower: gp.heroPower, heroPowerDisplay: gp.heroPowerDisplay, heroPowerLegacy: gp.heroPowerLegacy, power: gp.power ?? null, powerDisplay: gp.powerDisplay ?? '—', profession: gp.profession ?? null, killsApproximate: gp.kills, killsDisplay: gp.killsDisplay, killsStatus, activityDate: gp.sourceActivityDate ?? null, heroPowerMeasuredAt: gp.heroPowerMeasuredAt ?? null });

(async () => {
  const retrievedMs = Date.parse(raw.retrievedAt);
  const listedRows = raw.players.filter(p => p.allianceId === ALLIANCE);
  const unresolved = [], members = [], membershipMismatches = [];
  for (const p of listedRows) {
    // Identity is the game UID stored on the live record, never the name.
    const matches = live.members.filter(m => m.gameProfile?.uid === p.uid);
    // Same shape as LastRank exports (older exports share the importer's type); the UID is marked so it is never read as a LastRank ID.
    const sameName = () => live.members.filter(m => m.canonicalName === p.name).map(m => ({ id: m.id, active: m.active, uid: m.gameProfile?.uid ?? null }));
    if (matches.length !== 1) { unresolved.push({ publicId: 'uid:' + p.uid, sourceName: p.name, reason: matches.length ? 'multiple tracker records share this game UID' : 'no tracker record with this game UID; skipped at user request', sameNameTrackerRecords: sameName() }); continue; }
    const current = matches[0], gp = current.gameProfile, uid = gp.uid;
    // The importer pairs every row with a LastRank public ID; a row without one would trip its identity guard.
    if (!gp.lastRankPublicId) { unresolved.push({ publicId: 'uid:' + uid, sourceName: p.name, reason: 'tracker record has no LastRank public ID', sameNameTrackerRecords: sameName() }); continue; }
    const priorRow = prior.members.find(x => x.uid === uid);
    if (priorRow && priorRow.lastRankPublicId !== gp.lastRankPublicId) throw new Error('Mapping conflict with prior capture for ' + uid);

    const confirmedMs = (p.lastConfirmedAt?.seconds ?? 0) * 1000, ageMs = retrievedMs - confirmedMs;
    const withinDay = ageMs >= -60_000 && ageMs <= DAY;
    // `daily` is lwservers' dated reading; each stat in it is either that day's value or null.
    const d = p.daily && p.daily.date >= isoDate(confirmedMs - DAY) ? p.daily : null;
    const measured = { heroPower: reading(d?.heroPower), power: reading(d?.power), kills: reading(d?.kills) };
    const anyMeasured = Object.values(measured).some(v => v !== null);
    const membershipOk = p.warzone === 927;
    if (withinDay && !membershipOk) membershipMismatches.push({ uid, name: p.name, alliance: p.alliance, server: p.warzone });
    const fresh = withinDay && anyMeasured && membershipOk;
    const retainReason = !withinDay ? 'source record older than 24 hours' : !anyMeasured ? 'no dated stat reading within 24 hours' : 'source membership mismatch';
    const asset = fresh ? await avatar(p.avatarUrl, uid, gp.avatarPath) : { url: priorRow?.avatarUrl ?? null, file: gp.avatarPath.replace(/^\//, ''), status: 'retained', changed: false };
    const from = key => (measured[key] !== null ? 'lwservers daily reading ' + d.date : 'retained tracker value (not read by lwservers within 24 hours)');
    members.push({
      position: members.length + 1, uid, lastRankPublicId: gp.lastRankPublicId,
      name: fresh ? p.name : current.canonicalName,
      active: true,
      // lwservers fills alliance rank only from occasional, undated per-player reads, so ranks are never taken from it.
      rank: gp.rank,
      originServerId: gp.originServer ?? p.homeServer ?? null,
      identityEvidence: { basis: 'game UID on the live tracker record equals the lwservers UID', initialSourceName: p.name, previousTrackerName: current.canonicalName, avatarCorroborated: !!priorRow && pathname(priorRow.avatarUrl) === pathname(p.avatarUrl) },
      avatarUrl: asset.url, avatarFile: asset.file, avatarStatus: asset.status,
      sourceMembership: { allianceId: p.allianceId, allianceTag: p.alliance, allianceName: p.allianceName, homeServerId: p.warzone },
      freshness: { status: fresh ? 'fresh' : 'retained', maxAgeHours: 24, retrievedAt: raw.retrievedAt, previousSourceUpdatedAt: gp.sourceUpdatedAt ?? null, sourceUpdatedAt: confirmedMs ? new Date(confirmedMs).toISOString() : null, refreshRequested: false, refreshResult: fresh ? 'lwservers-daily-reading' : retainReason },
      profile: fresh
        ? {
          source: raw.source, capturedOn: DATE,
          heroPower: measured.heroPower ?? gp.heroPower, heroPowerDisplay: measured.heroPower !== null ? display(measured.heroPower) : gp.heroPowerDisplay, heroPowerLegacy: measured.heroPower !== null ? false : gp.heroPowerLegacy,
          power: measured.power ?? gp.power ?? null, powerDisplay: measured.power !== null ? display(measured.power) : gp.powerDisplay ?? '—',
          // lwservers' profession field is undated and disagrees with LastRank for some players.
          profession: gp.profession ?? null,
          killsApproximate: measured.kills ?? gp.kills, killsDisplay: measured.kills !== null ? display(measured.kills) : gp.killsDisplay,
          killsStatus: measured.kills !== null ? 'exact source value; compact display' : 'retained previous tracker value; not read by lwservers within 24 hours',
          activityDate: gp.sourceActivityDate ?? null,
          heroPowerMeasuredAt: measured.heroPower !== null ? d.date : gp.heroPowerMeasuredAt ?? null,
          fieldSources: { heroPower: from('heroPower'), power: from('power'), kills: from('kills'), profession: 'retained tracker value (lwservers profession is undated)' },
        }
        : retainedProfile(gp, 'retained previous tracker value; ' + retainReason),
      _changedAvatar: asset.changed,
    });
  }
  if (membershipMismatches.length) { console.log(JSON.stringify({ membershipMismatches }, null, 2)); throw new Error('Reconcile membership mismatches before writing'); }
  const listed = new Set(members.map(m => m.uid));
  const absent = live.members.filter(m => m.active && !listed.has(m.gameProfile?.uid));
  // Absent is not gone: keep them active with every tracker value unaltered.
  for (const m of absent) {
    const gp = m.gameProfile, priorRow = prior.members.find(x => x.uid === gp?.uid);
    if (!gp?.uid || !gp.lastRankPublicId) throw new Error('Active tracker member without a game UID and LastRank ID: ' + m.id);
    members.push({
      position: members.length + 1, uid: gp.uid, lastRankPublicId: gp.lastRankPublicId, name: m.canonicalName, active: true, rank: gp.rank,
      originServerId: gp.originServer ?? null,
      identityEvidence: { basis: 'existing live tracker record; absent from the lwservers RSCL rows, kept as still in RSCL', initialSourceName: null, previousTrackerName: m.canonicalName, avatarCorroborated: false },
      avatarUrl: priorRow?.avatarUrl ?? null, avatarFile: gp.avatarPath.replace(/^\//, ''), avatarStatus: 'retained',
      sourceMembership: null,
      freshness: { status: 'retained', maxAgeHours: 24, retrievedAt: null, previousSourceUpdatedAt: gp.sourceUpdatedAt ?? null, sourceUpdatedAt: null, refreshRequested: false, refreshResult: 'not-in-source-alliance-list' },
      profile: retainedProfile(gp, 'retained previous tracker value; absent from source list'),
      _changedAvatar: false,
    });
  }
  const liveOf = uid => live.members.find(m => m.gameProfile?.uid === uid);
  const capture = {
    source: raw.source, warzone: 927, allianceTag: 'RSCL', allianceName: 'The Rascals', capturedOn: DATE, exportedAt: new Date().toISOString(),
    sourceRosterUpdatedAt: raw.snapshotGeneratedAt, sourceListedMemberCount: listedRows.length,
    memberCount: members.filter(x => x.active).length, profileCount: listedRows.length,
    freshProfileCount: members.filter(x => x.freshness.status === 'fresh').length, retainedProfileCount: members.filter(x => x.freshness.status === 'retained').length,
    leader: members.find(x => x.rank === 'R5')?.name, officerCount: members.filter(x => x.rank === 'R4').length,
    supersedesProfileUpdates: ['lastrank-rscl-profiles-2026-09-10-v1', 'lastrank-rscl-profile-retry-2026-09-13-v1', 'lastrank-rscl-power-profession-2026-09-14-v1'],
    notes: [],
    unresolvedIdentities: unresolved,
    changes: {
      addedToThisExport: [],
      absentFromSourceRoster: absent.map(m => ({ uid: m.gameProfile.uid, name: m.canonicalName, lastRankPublicId: m.gameProfile.lastRankPublicId, basis: 'Absent from the lwservers RSCL rows; kept active and unaltered' })),
      markedInactive: [],
      renamed: members.filter(x => x.name !== liveOf(x.uid).canonicalName).map(x => ({ uid: x.uid, previous: liveOf(x.uid).canonicalName, current: x.name })),
      rankChanged: members.filter(x => x.rank !== liveOf(x.uid).gameProfile.rank).map(x => ({ uid: x.uid, name: x.name, previous: liveOf(x.uid).gameProfile.rank, current: x.rank })),
      changedStatistics: members.filter(x => { const b = liveOf(x.uid).gameProfile; return x.profile.heroPower !== b.heroPower || x.profile.killsApproximate !== b.kills || x.profile.power !== (b.power ?? null); }).map(x => x.uid),
      changedAvatars: members.filter(x => x._changedAvatar).map(x => x.uid),
    },
    members: members.map(({ _changedAvatar, ...x }) => x),
  };
  const fresh = capture.members.filter(x => x.freshness.status === 'fresh');
  const count = key => fresh.filter(x => x.profile.fieldSources[key].startsWith('lwservers')).length;
  const retainedNames = capture.members.filter(x => x.freshness.status === 'retained');
  capture.notes = [
    `Backup source: LastRank's alliance list was stale, so this export reads lwservers.com's public warzone 927 snapshot (generated ${raw.snapshotGeneratedAt}).`,
    `lwservers lists ${listedRows.length} RSCL players; ${members.length - absent.length} mapped to existing tracker records by game UID, not by name. lwservers' own roster sweep counts ${raw.allianceMemberCount ?? 'unknown'} members (${raw.allianceMemberCountDate ?? 'undated'}).`,
    `${fresh.length} profiles were confirmed by lwservers within 24 hours with a dated reading (user rule: data no more than 1 day old): hero power read for ${count('heroPower')}, power for ${count('power')}, kills for ${count('kills')}; any stat lwservers did not read keeps its tracker value, as each row's profile.fieldSources records. Profession and alliance rank are always kept: lwservers' values for both are undated.`,
    `${capture.retainedProfileCount} rows keep their existing tracker name, rank, statistics and dates unaltered${retainedNames.length ? ': ' + retainedNames.map(x => x.name).join(', ') : ''}.`,
    `${unresolved.length} lwservers RSCL players have no tracker record with their game UID and were skipped at the user's request: ${unresolved.map(x => x.sourceName).join(', ') || 'none'}.`,
    `${absent.length} active tracker members are absent from the lwservers RSCL rows (${absent.map(m => m.canonicalName).join(', ') || 'none'}); they stay active with existing values unaltered.`,
  ];
  if (new Set(capture.members.map(x => x.uid)).size !== members.length || new Set(capture.members.map(x => x.lastRankPublicId)).size !== members.length) throw new Error('Duplicate identities');
  // Identities are copied from the live record, never from lwservers: prove it before writing.
  for (const x of capture.members) {
    const owners = live.members.filter(m => m.gameProfile?.uid === x.uid);
    if (owners.length !== 1 || owners[0].gameProfile.lastRankPublicId !== x.lastRankPublicId) throw new Error('Identity not taken from the live record: ' + x.uid);
  }
  const exported = new Set(capture.members.map(x => x.uid));
  for (const m of live.members.filter(m => m.active)) if (!exported.has(m.gameProfile?.uid)) throw new Error('Active tracker member missing from export: ' + m.id);
  for (const x of capture.members) if (!fs.existsSync('public/' + x.avatarFile)) throw new Error('Missing avatar ' + x.avatarFile);
  fs.writeFileSync(out, JSON.stringify(capture, null, 2) + '\n');
  const moves = fresh.map(x => { const b = liveOf(x.uid).gameProfile; return { name: x.name, heroPower: b.heroPower ? +(x.profile.heroPower / b.heroPower - 1).toFixed(3) : null, power: b.power ? +(x.profile.power / b.power - 1).toFixed(3) : null }; })
    .filter(m => Math.abs(m.heroPower ?? 0) > 0.05 || Math.abs(m.power ?? 0) > 0.15);
  console.log(JSON.stringify({ prior: priorFile, active: capture.memberCount, fresh: capture.freshProfileCount, freshFields: { heroPower: count('heroPower'), power: count('power'), kills: count('kills') }, retained: retainedNames.map(x => x.name), unresolved: unresolved.map(x => x.sourceName), absent: absent.map(m => m.canonicalName), renamed: capture.changes.renamed, rankChanged: capture.changes.rankChanged, changedStats: capture.changes.changedStatistics.length, changedAvatars: capture.changes.changedAvatars.length, largeMoves: moves }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
