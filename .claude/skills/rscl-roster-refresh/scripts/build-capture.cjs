// Build lib/data/rscl-roster-<date>.json from the collector output.
// Usage (from repo root): node .claude/skills/rscl-roster-refresh/scripts/build-capture.cjs --date 2026-09-18
// Reads .data/lastrank-refresh-<date>/{capture.json,live-before.json} and the newest earlier roster export.
const fs = require('node:fs'), crypto = require('node:crypto'), sharp = require('sharp');
const args = process.argv.slice(2);
const DATE = args[args.indexOf('--date') + 1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE ?? '')) throw new Error('Provide --date YYYY-MM-DD.');
const dir = '.data/lastrank-refresh-' + DATE, ALLIANCE = 'fca3217524a04960a147436cda692b69';
const priorFile = fs.readdirSync('lib/data').filter(f => /^rscl-roster-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < 'rscl-roster-' + DATE).sort().pop();
if (!priorFile) throw new Error('No earlier roster export to compare against.');
const raw = JSON.parse(fs.readFileSync(dir + '/capture.json', 'utf8'));
const prior = JSON.parse(fs.readFileSync('lib/data/' + priorFile, 'utf8'));
const live = JSON.parse(fs.readFileSync(dir + '/live-before.json', 'utf8'));
// LastRank career_type codes, verified from LastRank's own front-end bundle.
const PROFESSIONS = { 101: 'Engineer', 102: 'War Leader' };
const profession = p => PROFESSIONS[p.career_type] ?? null;
const display = n => { if (n === null || n === undefined) return '—'; for (const [u, d] of [['B', 1e9], ['M', 1e6], ['K', 1e3]]) if (n >= d) return Number((n / d).toFixed(2)) + u; return String(n); };
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const pathname = s => { try { return new URL(s).pathname; } catch { return null; } };

async function avatar(p, uid, currentPath) {
  for (const url of [...new Set([p.photo_url, p.photo_url_failover].filter(Boolean))]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer()), meta = await sharp(bytes).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || !meta.height) throw new Error('Unusable image');
      const previous = currentPath && fs.existsSync('public' + currentPath) ? hash(fs.readFileSync('public' + currentPath)) : null;
      if (hash(bytes) === previous) return { url, file: currentPath.replace(/^\//, ''), status: 'validated-current', changed: false };
      const file = 'avatars/rscl/' + uid + '-lastrank-' + DATE + '.' + (meta.format === 'jpeg' ? 'jpg' : meta.format);
      fs.writeFileSync('public/' + file, bytes);
      return { url, file, status: 'validated-current', changed: true };
    } catch (e) { console.log('avatar attempt failed', uid, url, e.message); }
  }
  return { url: null, file: currentPath.replace(/^\//, ''), status: 'retained-download-failed', changed: false };
}

(async () => {
  const unresolved = [], members = [], membershipMismatches = [];
  for (const entry of raw.alliance.members) {
    const publicId = String(entry.public_id), r = raw.profiles[publicId], p = r.data;
    // Identity is the verified LastRank public ID -> game UID link on the live record, never the name.
    const matches = live.members.filter(m => m.gameProfile?.lastRankPublicId === publicId);
    if (matches.length !== 1) {
      unresolved.push({ publicId, sourceName: p.name, reason: matches.length ? 'multiple tracker records share this LastRank ID' : 'no verified game UID mapping; skipped at user request', sameNameTrackerRecords: live.members.filter(m => m.canonicalName === p.name).map(m => ({ id: m.id, active: m.active, uid: m.gameProfile?.uid ?? null })) });
      continue;
    }
    const current = matches[0], gp = current.gameProfile, uid = gp.uid, priorRow = prior.members.find(x => x.uid === uid);
    if (priorRow && priorRow.lastRankPublicId !== publicId) throw new Error('Mapping conflict with prior capture for ' + uid);
    const membershipOk = p.alliance_id === ALLIANCE && p.home_server_id === 927;
    if (r.freshnessPassed && !membershipOk) membershipMismatches.push({ publicId, uid, name: p.name, alliance: p.alliance_abbr, server: p.home_server_id });
    const fresh = r.freshnessPassed && membershipOk;
    const asset = fresh ? await avatar(p, uid, gp.avatarPath) : { url: priorRow?.avatarUrl ?? null, file: gp.avatarPath.replace(/^\//, ''), status: 'retained', changed: false };
    members.push({
      position: members.length + 1, uid, lastRankPublicId: publicId,
      name: fresh ? p.name : current.canonicalName,
      active: true,
      rank: fresh && p.alliance_rank >= 1 && p.alliance_rank <= 5 ? 'R' + p.alliance_rank : gp.rank,
      // A starting server never changes, so read it even from a stale profile.
      originServerId: p.origin_server_id ?? gp.originServer ?? null,
      identityEvidence: { basis: 'existing verified LastRank public ID to game UID mapping on the live tracker record', initialSourceName: raw.initialProfiles[publicId].data.name, previousTrackerName: current.canonicalName, avatarCorroborated: !!priorRow && pathname(priorRow.avatarUrl) === pathname(p.photo_url) },
      avatarUrl: asset.url, avatarFile: asset.file, avatarStatus: asset.status,
      sourceMembership: { allianceId: p.alliance_id, allianceTag: p.alliance_abbr, allianceName: p.alliance_name, homeServerId: p.home_server_id },
      freshness: { status: fresh ? 'fresh' : 'retained', maxAgeHours: 24, retrievedAt: r.retrievedAt, previousSourceUpdatedAt: r.beforeLastEnrichedAt, sourceUpdatedAt: p.last_enriched_at, refreshRequested: r.refreshRequested, refreshResult: r.refreshResponse?.enrich_status ?? r.refreshError ?? (r.refreshRequested ? 'unverified' : 'already-fresh') },
      profile: fresh
        ? { source: raw.source, capturedOn: DATE, heroPower: p.hero_power ?? null, heroPowerDisplay: display(p.hero_power), heroPowerLegacy: false, power: p.power ?? null, powerDisplay: display(p.power), profession: profession(p), killsApproximate: p.army_kill ?? null, killsDisplay: display(p.army_kill), killsStatus: 'exact source value; compact display', activityDate: null, heroPowerMeasuredAt: p.rankings?.find(x => x.rank_type === 13)?.captured_at ?? null }
        : { source: gp.source, capturedOn: gp.capturedOn, heroPower: gp.heroPower, heroPowerDisplay: gp.heroPowerDisplay, heroPowerLegacy: gp.heroPowerLegacy, power: gp.power ?? null, powerDisplay: gp.powerDisplay ?? '—', profession: gp.profession ?? null, killsApproximate: gp.kills, killsDisplay: gp.killsDisplay, killsStatus: 'retained previous tracker value; source profile older than 24 hours', activityDate: gp.sourceActivityDate ?? null, heroPowerMeasuredAt: gp.heroPowerMeasuredAt ?? null },
      _changedAvatar: asset.changed,
    });
  }
  if (membershipMismatches.length) { console.log(JSON.stringify({ membershipMismatches }, null, 2)); throw new Error('Reconcile membership mismatches before writing'); }
  const listed = new Set(raw.alliance.members.map(m => String(m.public_id)));
  const absent = live.members.filter(m => m.active && !listed.has(m.gameProfile?.lastRankPublicId));
  // User confirmed these are still in RSCL: keep them active with every tracker value unaltered.
  for (const m of absent) {
    const gp = m.gameProfile, priorRow = prior.members.find(x => x.uid === gp.uid);
    members.push({
      position: members.length + 1, uid: gp.uid, lastRankPublicId: gp.lastRankPublicId, name: m.canonicalName, active: true, rank: gp.rank,
      originServerId: gp.originServer ?? null,
      identityEvidence: { basis: 'existing live tracker record; absent from LastRank alliance list but user confirmed still in RSCL', initialSourceName: null, previousTrackerName: m.canonicalName, avatarCorroborated: false },
      avatarUrl: priorRow?.avatarUrl ?? null, avatarFile: gp.avatarPath.replace(/^\//, ''), avatarStatus: 'retained',
      sourceMembership: null,
      freshness: { status: 'retained', maxAgeHours: 24, retrievedAt: null, previousSourceUpdatedAt: gp.sourceUpdatedAt ?? null, sourceUpdatedAt: null, refreshRequested: false, refreshResult: 'not-in-source-alliance-list' },
      profile: { source: gp.source, capturedOn: gp.capturedOn, heroPower: gp.heroPower, heroPowerDisplay: gp.heroPowerDisplay, heroPowerLegacy: gp.heroPowerLegacy, power: gp.power ?? null, powerDisplay: gp.powerDisplay ?? '—', profession: gp.profession ?? null, killsApproximate: gp.kills, killsDisplay: gp.killsDisplay, killsStatus: 'retained previous tracker value; absent from source list', activityDate: gp.sourceActivityDate ?? null, heroPowerMeasuredAt: gp.heroPowerMeasuredAt ?? null },
      _changedAvatar: false,
    });
  }
  const liveOf = uid => live.members.find(m => m.gameProfile?.uid === uid);
  const capture = {
    source: raw.source, warzone: 927, allianceTag: 'RSCL', allianceName: 'The Rascals', capturedOn: DATE, exportedAt: new Date().toISOString(),
    sourceRosterUpdatedAt: raw.alliance.last_seen_at, sourceListedMemberCount: raw.alliance.cur_member,
    memberCount: members.filter(x => x.active).length, profileCount: Object.keys(raw.profiles).length,
    freshProfileCount: members.filter(x => x.freshness.status === 'fresh').length, retainedProfileCount: members.filter(x => x.freshness.status === 'retained').length,
    leader: members.find(x => x.rank === 'R5')?.name, officerCount: members.filter(x => x.rank === 'R4').length,
    supersedesProfileUpdates: ['lastrank-rscl-profiles-2026-09-10-v1', 'lastrank-rscl-profile-retry-2026-09-13-v1', 'lastrank-rscl-power-profession-2026-09-14-v1'],
    notes: [],
    unresolvedIdentities: unresolved,
    changes: {
      addedToThisExport: [],
      absentFromSourceRoster: absent.map(m => ({ uid: m.gameProfile.uid, name: m.canonicalName, lastRankPublicId: m.gameProfile.lastRankPublicId, basis: 'User confirmed still in RSCL; kept active and unaltered' })),
      markedInactive: [],
      renamed: members.filter(x => x.name !== liveOf(x.uid).canonicalName).map(x => ({ uid: x.uid, previous: liveOf(x.uid).canonicalName, current: x.name })),
      rankChanged: members.filter(x => x.rank !== liveOf(x.uid).gameProfile.rank).map(x => ({ uid: x.uid, name: x.name, previous: liveOf(x.uid).gameProfile.rank, current: x.rank })),
      changedStatistics: members.filter(x => { const b = liveOf(x.uid).gameProfile; return x.profile.heroPower !== b.heroPower || x.profile.killsApproximate !== b.kills || x.profile.power !== (b.power ?? null); }).map(x => x.uid),
      changedAvatars: members.filter(x => x._changedAvatar).map(x => x.uid),
    },
    members: members.map(({ _changedAvatar, ...x }) => x),
  };
  const retainedNames = capture.members.filter(x => x.freshness.status === 'retained');
  capture.notes = [
    `LastRank alliance list read ${raw.alliance.cur_member} players; ${members.length} mapped to existing game UIDs through the stored LastRank public ID link, not by name.`,
    `${capture.freshProfileCount} profiles have update timestamps within 24 hours (user rule: data no more than 1 day old). ${capture.retainedProfileCount} were older than 24 hours after a refresh attempt and keep their existing tracker name, rank, statistics and dates unaltered${retainedNames.length ? ': ' + retainedNames.map(x => x.name).join(', ') : ''}.`,
    `${unresolved.length} listed players have no verified game UID and were skipped at the user's request: ${unresolved.map(x => x.sourceName).join(', ') || 'none'}.`,
    `${absent.length} active tracker members are absent from the LastRank alliance list (${absent.map(m => m.canonicalName).join(', ') || 'none'}); the user confirmed they are still in RSCL, so they stay active with existing values unaltered.`,
    'LastRank profile update timestamps are distinct from ranking measurement timestamps. Missing values are unavailable, not zero.',
  ];
  if (new Set(capture.members.map(x => x.uid)).size !== members.length || new Set(capture.members.map(x => x.lastRankPublicId)).size !== members.length) throw new Error('Duplicate identities');
  for (const x of capture.members) if (!fs.existsSync('public/' + x.avatarFile)) throw new Error('Missing avatar ' + x.avatarFile);
  fs.writeFileSync('lib/data/rscl-roster-' + DATE + '.json', JSON.stringify(capture, null, 2) + '\n');
  console.log(JSON.stringify({ prior: priorFile, active: capture.memberCount, fresh: capture.freshProfileCount, retained: retainedNames.map(x => x.name), unresolved: unresolved.map(x => x.sourceName), absent: absent.map(m => m.canonicalName), renamed: capture.changes.renamed, rankChanged: capture.changes.rankChanged, changedStats: capture.changes.changedStatistics.length, changedAvatars: capture.changes.changedAvatars.length, professions: capture.members.reduce((a, x) => (a[x.profile.profession ?? 'none'] = (a[x.profile.profession ?? 'none'] ?? 0) + 1, a), {}) }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
