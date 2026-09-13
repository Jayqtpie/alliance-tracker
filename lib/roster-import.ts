import capture from "./data/rscl-roster-2026-09-13.json";
import type { Member, TrackerState } from "./types";

// Keep the legacy prefix so older deployments also reject this newer capture.
// The capture source and profile public IDs identify LastRank independently.
export const ROSTER_IMPORT = "lwservers-rscl-927-2026-09-13-v1";

const capturedRenames: { uid: string; previous: string; current: string }[] = capture.changes.renamed;

function nameKey(name: string) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseDisplayedPower(display: string): number | null {
  const match = display.replace(/LEGACY/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!match) return null;
  return Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1);
}

function captureVersion(marker: string | undefined) {
  const match = marker?.match(/^(?:lwservers|lastrank)-rscl-927-(\d{4}-\d{2}-\d{2})-v(\d+)$/);
  return match ? { date: match[1], version: Number(match[2]) } : undefined;
}

/** One reconciled roster capture, applied once to the freshly loaded state. */
export function importCapturedRoster(state: TrackerState): TrackerState {
  if (state.rosterImport === "custom-alliance" || state.rosterImport === ROSTER_IMPORT || state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927") return state;
  const current = captureVersion(state.rosterImport);
  const incoming = captureVersion(ROSTER_IMPORT)!;
  if (current && (current.date > incoming.date || (current.date === incoming.date && current.version >= incoming.version))) return state;

  // A duplicated live UID or conflicting source mapping requires reconciliation,
  // not two captured rows being attached to one tracker identity.
  if (capture.members.some((row) => state.members.filter((member) => member.gameProfile?.uid === row.uid).length > 1 ||
    state.members.some((member) => member.gameProfile?.lastRankPublicId === row.lastRankPublicId && member.gameProfile.uid !== row.uid))) return state;

  const used = new Set<string>();
  const members: Member[] = capture.members.map((row) => {
    const previousNames = capturedRenames.filter((change) => change.uid === row.uid).map((change) => change.previous);
    const names = new Set([row.name, ...previousNames].map(nameKey));
    const byUid = state.members.find((member) => member.gameProfile?.uid === row.uid);
    const candidates = state.members.filter((member) => !member.gameProfile && !used.has(member.id) &&
      [member.canonicalName, ...member.aliases].some((name) => names.has(nameKey(name))));
    const existing = byUid || (candidates.length === 1 ? candidates[0] : undefined);
    const id = existing?.id ?? `lw-${row.uid}`;
    used.add(id);
    const retained = row.freshness.status === "retained";
    const profile: NonNullable<Member["gameProfile"]> = retained && existing?.gameProfile ? existing.gameProfile : {
      uid: row.uid,
      rank: row.rank,
      avatarPath: `/${row.avatarFile}`,
      heroPower: row.profile.heroPower,
      heroPowerDisplay: row.profile.heroPowerDisplay,
      heroPowerLegacy: row.profile.heroPowerLegacy,
      kills: row.profile.killsApproximate,
      killsDisplay: row.profile.killsDisplay,
      capturedOn: row.profile.capturedOn,
      sourceActivityDate: row.profile.activityDate ?? undefined,
      source: row.profile.source,
      sourceUpdatedAt: retained ? undefined : row.freshness.sourceUpdatedAt ?? undefined,
      heroPowerMeasuredAt: row.profile.heroPowerMeasuredAt ?? undefined,
    };
    return {
      ...existing,
      id,
      canonicalName: row.name,
      aliases: [...new Set([...(existing?.aliases ?? []), ...(existing && existing.canonicalName !== row.name ? [existing.canonicalName] : []), ...previousNames])].filter((name) => name !== row.name),
      previousNames: [...new Set([...(existing?.previousNames ?? []), ...(existing && existing.canonicalName.replace(/\s+/g, " ") !== row.name.replace(/\s+/g, " ") ? [existing.canonicalName] : []), ...previousNames])].filter((name) => name !== row.name),
      active: row.active,
      leftAt: row.active ? undefined : existing?.leftAt,
      gameProfile: {
        ...profile,
        lastRankPublicId: row.lastRankPublicId,
        refreshStatus: retained ? "retained" : "fresh",
        refreshAttemptedOn: capture.capturedOn,
      },
    };
  });
  const historical = state.members.filter((member) => !used.has(member.id)).map((member) => ({ ...member, active: false }));
  return {
    ...state,
    rosterImport: ROSTER_IMPORT,
    // Older deployments must not replay an earlier name/avatar correction.
    memberProfileUpdates: [...new Set([...(state.memberProfileUpdates ?? []), ...capture.supersedesProfileUpdates])],
    members: [...members, ...historical],
  };
}
