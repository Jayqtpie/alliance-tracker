import capture from "./data/rscl-roster-2026-09-05.json";
import type { Member, TrackerState } from "./types";

export const ROSTER_IMPORT = "lwservers-rscl-927-2026-09-05-v1";

function nameKey(name: string) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseDisplayedPower(display: string): number | null {
  const match = display.replace(/LEGACY/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!match) return null;
  return Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1);
}

/** One captured roster, applied once. Unmatched identities remain available to historical reports. */
export function importCapturedRoster(state: TrackerState): TrackerState {
  if (state.rosterImport === ROSTER_IMPORT || state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927") return state;
  const used = new Set<string>();
  const members: Member[] = capture.members.map((row) => {
    const previousNames = capture.changes.renamed.filter((change) => change.uid === row.uid).map((change) => change.previous);
    const names = new Set([row.name, ...previousNames].map(nameKey));
    const byUid = state.members.find((member) => member.gameProfile?.uid === row.uid);
    const candidates = state.members.filter((member) => !member.gameProfile && !used.has(member.id) &&
      [member.canonicalName, ...member.aliases].some((name) => names.has(nameKey(name))));
    // Do not guess between ambiguous identities or fuzzy OCR matches.
    const existing = byUid || (candidates.length === 1 ? candidates[0] : undefined);
    const id = existing?.id ?? `lw-${row.uid}`;
    used.add(id);
    return {
      ...existing,
      id,
      canonicalName: row.name,
      aliases: [...new Set([...(existing?.aliases ?? []), ...(existing && existing.canonicalName !== row.name ? [existing.canonicalName] : []), ...previousNames])].filter((name) => name !== row.name),
      active: true,
      leftAt: undefined,
      gameProfile: {
        uid: row.uid,
        rank: row.rank,
        avatarPath: `/avatars/rscl/${row.uid}.jpg`,
        heroPower: parseDisplayedPower(row.profile.heroPowerDisplay),
        heroPowerDisplay: row.profile.heroPowerDisplay.replace(/LEGACY/g, "").trim(),
        heroPowerLegacy: row.profile.heroPowerDisplay.includes("LEGACY"),
        kills: row.profile.killsApproximate,
        killsDisplay: row.profile.killsDisplay,
        capturedOn: capture.capturedOn,
        source: capture.source,
      },
    };
  });
  const historical = state.members.filter((member) => !used.has(member.id)).map((member) => ({ ...member, active: false }));
  return { ...state, rosterImport: ROSTER_IMPORT, members: [...members, ...historical] };
}
