import type { TrackerState } from "./types";

export const ALIAS_CORRECTION = "rscl-alias-corrections-2026-09-27-v1";

// Aliases an earlier screenshot read attached to the wrong player, keyed by game UID.
// "Baby Bee ie FAFO" is another member's name (formerly ABU BADDA, UID 1426415525000863);
// the owner confirmed on 2026-09-27 that the two are separate people.
const WRONG_ALIASES: { uid: string; alias: string }[] = [
  { uid: "1136632270000866", alias: "Baby Bee ie FAFO" },
];

/**
 * Remove each wrong alias once, from the one record holding that game UID. With nothing to
 * remove it returns the state untouched, so a tracker without these aliases is never rewritten.
 */
export function applyAliasCorrections(state: TrackerState): TrackerState {
  if (state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927" ||
      state.memberProfileUpdates?.includes(ALIAS_CORRECTION)) return state;
  let changed = false;
  const members = state.members.map((member) => {
    const wrong = WRONG_ALIASES.filter((row) => row.uid === member.gameProfile?.uid).map((row) => row.alias);
    if (!wrong.some((alias) => member.aliases.includes(alias)) ||
        state.members.filter((other) => other.gameProfile?.uid === member.gameProfile?.uid).length !== 1) return member;
    changed = true;
    return { ...member, aliases: member.aliases.filter((alias) => !wrong.includes(alias)) };
  });
  if (!changed) return state;
  return { ...state, memberProfileUpdates: [...(state.memberProfileUpdates ?? []), ALIAS_CORRECTION], members };
}
