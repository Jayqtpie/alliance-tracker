import capture from "./data/rscl-roster-2026-09-14.json";
import { ROSTER_IMPORT } from "./roster-import";
import type { TrackerState } from "./types";

export const PROFILE_STATS_UPDATE = "lastrank-rscl-power-profession-2026-09-14-v1";

/** Add total power and profession from the already-applied capture without replaying the roster. */
export function applyProfileStats(state: TrackerState): TrackerState {
  if (state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927" ||
      state.rosterImport !== ROSTER_IMPORT || state.memberProfileUpdates?.includes(PROFILE_STATS_UPDATE)) return state;
  return {
    ...state,
    memberProfileUpdates: [...(state.memberProfileUpdates ?? []), PROFILE_STATS_UPDATE],
    members: state.members.map((member) => {
      // Retained profiles are older than 24 hours and stay unaltered.
      const row = capture.members.find((row) => row.freshness.status === "fresh" && row.uid === member.gameProfile?.uid);
      if (!row || !member.gameProfile || member.gameProfile.power !== undefined ||
          member.gameProfile.lastRankPublicId !== row.lastRankPublicId ||
          state.members.filter((other) => other.gameProfile?.uid === row.uid).length !== 1) return member;
      return {
        ...member,
        gameProfile: { ...member.gameProfile, power: row.profile.power, powerDisplay: row.profile.powerDisplay, profession: row.profile.profession },
      };
    }),
  };
}
