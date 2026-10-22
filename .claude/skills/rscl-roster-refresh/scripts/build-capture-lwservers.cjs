// Backup builder: lib/data/rscl-roster-<date>.json from collect-lwservers.mjs output, for when LastRank is stale.
// Usage (from repo root): node .claude/skills/rscl-roster-refresh/scripts/build-capture-lwservers.cjs --date 2026-09-27
// Reads .data/lwservers-refresh-<date>/{capture.json,live-before.json} and the newest earlier roster export.
// Same owner rules as build-capture.cjs: identity by stored game UID, 24-hour freshness, absent members kept, unmapped skipped.
// Optional: --identities <file>, a JSON array of { publicId, uid, name, evidence } for RSCL players with no game UID on the
// tracker yet, verified as in SKILL.md "Adding new members". Each is added as a fresh row; when an officer already created
// the player by name, the importer attaches the UID to that record, so it must be the only one with that name.
const fs = require('node:fs'), crypto = require('node:crypto'), sharp = require('sharp');
const args = process.argv.slice(2);
const DATE = args[args.indexOf('--date') + 1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE ?? '')) throw new Error('Provide --date YYYY-MM-DD.');
const identitiesFile = args.includes('--identities') ? args[args.indexOf('--identities') + 1] : null;
const newIdentities = new Map((identitiesFile ? JSON.parse(fs.readFileSync(identitiesFile, 'utf8')) : []).map(x => [String(x.uid), x]));
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
// pf[1] is the career type, same codes as LastRank's career_type; read with each confirmation.
const PROFESSIONS = { 101: 'Engineer', 102: 'War Leader' };
// The importer's name key (lib/roster-import.ts), which pairs a new row with a tracker record that has no game profile.
const nameKey = name => name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

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
  if (!currentPath) throw new Error('No avatar for new member ' + uid);
  return { url: null, file: currentPath.replace(/^\//, ''), status: 'retained-download-failed', changed: false };
}

const retainedProfile = (gp, killsStatus) => ({ source: gp.source, capturedOn: gp.capturedOn, heroPower: gp.heroPower, heroPowerDisplay: gp.heroPowerDisplay, heroPowerLegacy: gp.heroPowerLegacy, power: gp.power ?? null, powerDisplay: gp.powerDisplay ?? '—', profession: gp.profession ?? null, killsApproximate: gp.kills, killsDisplay: gp.killsDisplay, killsStatus, activityDate: gp.sourceActivityDate ?? null, heroPowerMeasuredAt: gp.heroPowerMeasuredAt ?? null });

(async () => {
  const retrievedMs = Date.parse(raw.retrievedAt);
  const listedRows = raw.players.filter(p => p.allianceId === ALLIANCE);
  // A joiner's lwservers row can be weeks old and still name their previous alliance, which is as stale as its stats.
  // Such a row is taken only for an --identities entry, and only with newer RSCL evidence (checked below).
  const staleJoinerRows = raw.players.filter(p => p.allianceId !== ALLIANCE && newIdentities.has(p.uid) && !live.members.some(m => m.gameProfile?.uid === p.uid));
  const unresolved = [], members = [], membershipMismatches = [], listedMarkedLeft = [];
  for (const p of [...listedRows, ...staleJoinerRows]) {
    const confirmedMs = (p.lastConfirmedAt?.seconds ?? 0) * 1000, ageMs = retrievedMs - confirmedMs;
    const withinDay = ageMs >= -60_000 && ageMs <= DAY;
    // `daily` is lwservers' dated reading; each stat in it is either that day's value or null.
    const d = p.daily && p.daily.date >= isoDate(confirmedMs - DAY) ? p.daily : null;
    const measured = { heroPower: reading(d?.heroPower), power: reading(d?.power), kills: reading(d?.kills) };
    const anyMeasured = Object.values(measured).some(v => v !== null);
    const fieldSource = key => (measured[key] !== null ? 'lwservers daily reading ' + d.date : 'not read by lwservers within 24 hours');

    // Identity is the game UID stored on the live record, never the name.
    const matches = live.members.filter(m => m.gameProfile?.uid === p.uid);
    const added = newIdentities.get(p.uid);
    if (matches.length === 0 && added) {
      const uid = p.uid, publicId = String(added.publicId ?? '');
      if (p.warzone !== 927) throw new Error('New member ' + uid + ' is not on 927 per lwservers');
      if (p.allianceId !== ALLIANCE) {
        const e = added.evidence ?? {}, seen = e.lwatlasLastSeenAt ?? '';
        const seenMs = Date.parse(/(Z|[+-]\d\d:\d\d)$/i.test(seen) ? seen : seen + 'Z');
        if (withinDay || e.lwatlasUid !== uid || e.lwatlasAllianceAbbr !== 'RSCL' || e.lastRankAlliance !== 'RSCL' || !(seenMs > confirmedMs)) throw new Error('New member ' + uid + ' is in ' + p.alliance + ' per lwservers, without newer RSCL evidence from lwatlas and LastRank');
      }
      // A stale reading is not used: the row carries the verified identity with empty stats for the next refresh to fill.
      const fresh = withinDay && anyMeasured, stale = !withinDay ? 'source record older than 24 hours' : 'no dated stat reading within 24 hours';
      if (!fresh) Object.keys(measured).forEach(key => { measured[key] = null; });
      if (p.name !== added.name) throw new Error('New member ' + uid + ' is named ' + p.name + ' on lwservers, not ' + added.name);
      if (!/^\d+$/.test(publicId) || live.members.some(m => m.gameProfile?.lastRankPublicId === publicId)) throw new Error('New member ' + uid + ' needs a LastRank public ID that is not already on the tracker');
      if (Number(uid.slice(-3)) !== added.evidence?.lastRankOriginServerId) throw new Error('New member ' + uid + ': UID server suffix does not match LastRank origin_server_id');
      const owners = live.members.filter(m => !m.gameProfile && [m.canonicalName, ...m.aliases].some(n => nameKey(n) === nameKey(p.name)));
      if (owners.length > 1 || owners.some(m => !m.active)) throw new Error('New member ' + uid + ': the importer needs at most one active record without a game profile named ' + p.name);
      const asset = await avatar(p.avatarUrl, uid, null);
      const lwatlasRank = added.evidence?.lwatlasRank;
      members.push({
        position: members.length + 1, uid, lastRankPublicId: publicId, name: p.name, active: true,
        // No tracker rank exists yet; lwatlas' map scan is dated (lwatlasLastSeenAt), unlike lwservers' allianceRank.
        rank: lwatlasRank >= 1 && lwatlasRank <= 5 ? 'R' + lwatlasRank : null,
        originServerId: Number(uid.slice(-3)),
        identityEvidence: { basis: 'new member; game UID verified outside LastRank', initialSourceName: p.name, previousTrackerName: owners[0]?.canonicalName ?? null, avatarCorroborated: !!added.evidence?.lwserversAvatarMatchesLastRank, external: added.evidence ?? null },
        avatarUrl: asset.url, avatarFile: asset.file, avatarStatus: asset.status,
        sourceMembership: { allianceId: p.allianceId, allianceTag: p.alliance, allianceName: p.allianceName, homeServerId: p.warzone },
        freshness: { status: fresh ? 'fresh' : 'retained', maxAgeHours: 24, retrievedAt: raw.retrievedAt, previousSourceUpdatedAt: null, sourceUpdatedAt: new Date(confirmedMs).toISOString(), refreshRequested: false, refreshResult: fresh ? 'lwservers-daily-reading' : stale },
        profile: {
          source: raw.source, capturedOn: DATE,
          heroPower: measured.heroPower, heroPowerDisplay: display(measured.heroPower), heroPowerLegacy: false,
          power: measured.power, powerDisplay: display(measured.power),
          profession: fresh ? PROFESSIONS[p.pf?.[1]] ?? null : null,
          killsApproximate: measured.kills, killsDisplay: display(measured.kills),
          killsStatus: measured.kills !== null ? 'exact source value; compact display' : 'not read by lwservers within 24 hours',
          activityDate: null,
          heroPowerMeasuredAt: measured.heroPower !== null ? d.date : null,
          fieldSources: { heroPower: fieldSource('heroPower'), power: fieldSource('power'), kills: fieldSource('kills'), profession: fresh && PROFESSIONS[p.pf?.[1]] ? 'lwservers pf confirmed ' + isoDate(confirmedMs) : 'not read by lwservers within 24 hours', rank: lwatlasRank ? 'lwatlas map scan ' + (added.evidence?.lwatlasLastSeenAt ?? 'undated') : 'none' },
        },
        _changedAvatar: asset.changed, _added: true, _owner: owners[0]?.id ?? null,
      });
      continue;
    }
    // Same shape as LastRank exports (older exports share the importer's type); the UID is marked so it is never read as a LastRank ID.
    const sameName = () => live.members.filter(m => m.canonicalName === p.name).map(m => ({ id: m.id, active: m.active, uid: m.gameProfile?.uid ?? null }));
    if (matches.length !== 1) { unresolved.push({ publicId: 'uid:' + p.uid, sourceName: p.name, reason: matches.length ? 'multiple tracker records share this game UID' : 'no tracker record with this game UID; skipped at user request', sameNameTrackerRecords: sameName() }); continue; }
    const current = matches[0], gp = current.gameProfile, uid = gp.uid;
    // An officer marked them left; lwservers keeps stale rows for weeks, so a row must not reactivate them.
    if (!current.active) { listedMarkedLeft.push({ uid, name: p.name, trackerName: current.canonicalName, sourceConfirmedAt: confirmedMs ? new Date(confirmedMs).toISOString() : null }); continue; }
    // The importer pairs every row with a LastRank public ID; a row without one would trip its identity guard.
    if (!gp.lastRankPublicId) { unresolved.push({ publicId: 'uid:' + uid, sourceName: p.name, reason: 'tracker record has no LastRank public ID', sameNameTrackerRecords: sameName() }); continue; }
    const priorRow = prior.members.find(x => x.uid === uid);
    if (priorRow && priorRow.lastRankPublicId !== gp.lastRankPublicId) throw new Error('Mapping conflict with prior capture for ' + uid);

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
          // Confirmed by the owner in-game on 2026-09-27: where pf and an older LastRank read disagreed, pf was right.
          profession: PROFESSIONS[p.pf?.[1]] ?? gp.profession ?? null,
          killsApproximate: measured.kills ?? gp.kills, killsDisplay: measured.kills !== null ? display(measured.kills) : gp.killsDisplay,
          killsStatus: measured.kills !== null ? 'exact source value; compact display' : 'retained previous tracker value; not read by lwservers within 24 hours',
          activityDate: gp.sourceActivityDate ?? null,
          heroPowerMeasuredAt: measured.heroPower !== null ? d.date : gp.heroPowerMeasuredAt ?? null,
          fieldSources: { heroPower: from('heroPower'), power: from('power'), kills: from('kills'), profession: PROFESSIONS[p.pf?.[1]] ? 'lwservers pf confirmed ' + isoDate(confirmedMs) : 'retained tracker value (no lwservers career type)' },
        }
        : retainedProfile(gp, 'retained previous tracker value; ' + retainReason),
      _changedAvatar: asset.changed,
    });
  }
  const unused = [...newIdentities.keys()].filter(uid => !members.some(x => x._added && x.uid === uid));
  if (unused.length) throw new Error('--identities entries not added (not an RSCL row on lwservers, or already on the tracker): ' + unused.join(', '));
  if (membershipMismatches.length) { console.log(JSON.stringify({ membershipMismatches }, null, 2)); throw new Error('Reconcile membership mismatches before writing'); }
  const existingRows = members.filter(x => !x._added), addedRows = members.filter(x => x._added);
  // Records an officer created by name that an added row takes over; the importer attaches the UID to them.
  const claimed = new Set(addedRows.map(x => x._owner).filter(Boolean));
  const listed = new Set(members.map(m => m.uid));
  const absent = live.members.filter(m => m.active && !listed.has(m.gameProfile?.uid) && !claimed.has(m.id));
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
      addedToThisExport: addedRows.map(x => ({ uid: x.uid, name: x.name, lastRankPublicId: x.lastRankPublicId, basis: x.identityEvidence.basis })),
      absentFromSourceRoster: absent.map(m => ({ uid: m.gameProfile.uid, name: m.canonicalName, lastRankPublicId: m.gameProfile.lastRankPublicId, basis: 'Absent from the lwservers RSCL rows; kept active and unaltered' })),
      listedButMarkedLeft: listedMarkedLeft.map(x => ({ ...x, basis: 'Listed in RSCL by lwservers, but an officer marked them left; not exported, so the import keeps them left' })),
      markedInactive: [],
      renamed: existingRows.filter(x => x.name !== liveOf(x.uid).canonicalName).map(x => ({ uid: x.uid, previous: liveOf(x.uid).canonicalName, current: x.name })),
      rankChanged: existingRows.filter(x => x.rank !== liveOf(x.uid).gameProfile.rank).map(x => ({ uid: x.uid, name: x.name, previous: liveOf(x.uid).gameProfile.rank, current: x.rank })),
      changedStatistics: existingRows.filter(x => { const b = liveOf(x.uid).gameProfile; return x.profile.heroPower !== b.heroPower || x.profile.killsApproximate !== b.kills || x.profile.power !== (b.power ?? null) || x.profile.profession !== (b.profession ?? null); }).map(x => x.uid),
      changedAvatars: members.filter(x => x._changedAvatar).map(x => x.uid),
    },
    members: members.map(({ _changedAvatar, _added, _owner, ...x }) => x),
  };
  const addedUids = new Set(addedRows.map(x => x.uid));
  const staleAlliance = addedRows.filter(x => x.sourceMembership.allianceId !== ALLIANCE);
  const fresh = capture.members.filter(x => x.freshness.status === 'fresh');
  const count = key => fresh.filter(x => x.profile.fieldSources[key].startsWith('lwservers')).length;
  const retainedNames = capture.members.filter(x => x.freshness.status === 'retained');
  capture.notes = [
    `Backup source: LastRank's alliance list was stale, so this export reads lwservers.com's public warzone 927 snapshot (generated ${raw.snapshotGeneratedAt}).`,
    `lwservers lists ${listedRows.length} RSCL players; ${existingRows.length} mapped to existing tracker records by game UID, not by name. lwservers' own roster sweep counts ${raw.allianceMemberCount ?? 'unknown'} members (${raw.allianceMemberCountDate ?? 'undated'}).`,
    `${addedRows.length} new members added at the user's request, each game UID verified outside LastRank (lwservers and lwatlas agree on name, UID and RSCL; LastRank's avatar and origin server agree; see identityEvidence.external)${addedRows.length ? ': ' + addedRows.map(x => x.name).join(', ') : ''}.${staleAlliance.length ? ` For ${staleAlliance.map(x => x.name).join(', ')}, lwservers' row was older than 24 hours and still showed their previous alliance (${[...new Set(staleAlliance.map(x => x.sourceMembership.allianceTag))].join(', ')}); RSCL membership comes from lwatlas and LastRank, both dated later.` : ''}`,
    `${fresh.length} profiles were confirmed by lwservers within 24 hours with a dated reading (user rule: data no more than 1 day old): hero power read for ${count('heroPower')}, power for ${count('power')}, kills for ${count('kills')}; any stat lwservers did not read keeps its tracker value, as each row's profile.fieldSources records. Profession comes from lwservers' career type (pf) for ${count('profession')}; alliance rank is always kept, as lwservers leaves it empty or undated.`,
    `${capture.retainedProfileCount} rows keep their existing tracker name, rank, statistics and dates unaltered${retainedNames.length ? ': ' + retainedNames.map(x => x.name).join(', ') : ''}.`,
    `${unresolved.length} lwservers RSCL players have no tracker record with their game UID and were skipped at the user's request: ${unresolved.map(x => x.sourceName).join(', ') || 'none'}.`,
    `${absent.length} active tracker members are absent from the lwservers RSCL rows (${absent.map(m => m.canonicalName).join(', ') || 'none'}); they stay active with existing values unaltered.`,
    `${listedMarkedLeft.length} lwservers RSCL rows belong to members an officer marked left and are not exported: ${listedMarkedLeft.map(x => x.trackerName).join(', ') || 'none'}.`,
  ];
  if (new Set(capture.members.map(x => x.uid)).size !== members.length || new Set(capture.members.map(x => x.lastRankPublicId)).size !== members.length) throw new Error('Duplicate identities');
  // Identities are copied from the live record, never from lwservers: prove it before writing.
  // Added rows were checked against --identities above instead.
  for (const x of capture.members.filter(x => !addedUids.has(x.uid))) {
    const owners = live.members.filter(m => m.gameProfile?.uid === x.uid);
    if (owners.length !== 1 || owners[0].gameProfile.lastRankPublicId !== x.lastRankPublicId) throw new Error('Identity not taken from the live record: ' + x.uid);
  }
  const exported = new Set(capture.members.map(x => x.uid));
  for (const m of live.members.filter(m => m.active)) if (!exported.has(m.gameProfile?.uid) && !claimed.has(m.id)) throw new Error('Active tracker member missing from export: ' + m.id);
  for (const x of capture.members) if (!fs.existsSync('public/' + x.avatarFile)) throw new Error('Missing avatar ' + x.avatarFile);
  fs.writeFileSync(out, JSON.stringify(capture, null, 2) + '\n');
  const moves = fresh.filter(x => !addedUids.has(x.uid)).map(x => { const b = liveOf(x.uid).gameProfile; return { name: x.name, heroPower: b.heroPower ? +(x.profile.heroPower / b.heroPower - 1).toFixed(3) : null, power: b.power ? +(x.profile.power / b.power - 1).toFixed(3) : null }; })
    .filter(m => Math.abs(m.heroPower ?? 0) > 0.05 || Math.abs(m.power ?? 0) > 0.15);
  console.log(JSON.stringify({ prior: priorFile, active: capture.memberCount, fresh: capture.freshProfileCount, freshFields: { heroPower: count('heroPower'), power: count('power'), kills: count('kills'), profession: count('profession') }, added: addedRows.map(x => ({ name: x.name, rank: x.rank, power: x.profile.powerDisplay, heroPower: x.profile.heroPowerDisplay, kills: x.profile.killsDisplay, profession: x.profile.profession })), professionChanged: capture.members.filter(x => !addedUids.has(x.uid)).filter(x => x.profile.profession !== (liveOf(x.uid).gameProfile.profession ?? null)).map(x => ({ name: x.name, previous: liveOf(x.uid).gameProfile.profession ?? null, current: x.profile.profession })), retained: retainedNames.map(x => x.name), unresolved: unresolved.map(x => x.sourceName), absent: absent.map(m => m.canonicalName), listedButMarkedLeft: listedMarkedLeft.map(x => x.trackerName), renamed: capture.changes.renamed, rankChanged: capture.changes.rankChanged, changedStats: capture.changes.changedStatistics.length, changedAvatars: capture.changes.changedAvatars.length, largeMoves: moves }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
