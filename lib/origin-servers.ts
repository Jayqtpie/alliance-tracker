import capture from "./data/rscl-roster-2026-09-21.json";
import { ROSTER_IMPORT } from "./roster-import";
import type { TrackerState } from "./types";

export const ORIGIN_SERVER_UPDATE = "lastrank-rscl-origin-servers-2026-09-21-v1";

/**
 * Add each player's starting server from the already-applied capture without
 * replaying the roster, which would overwrite names, ranks and membership.
 */
export function applyOriginServers(state: TrackerState): TrackerState {
  if (state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927" ||
      state.rosterImport !== ROSTER_IMPORT || state.memberProfileUpdates?.includes(ORIGIN_SERVER_UPDATE)) return state;
  return {
    ...state,
    memberProfileUpdates: [...(state.memberProfileUpdates ?? []), ORIGIN_SERVER_UPDATE],
    members: state.members.map((member) => {
      const row = capture.members.find((row) => row.uid === member.gameProfile?.uid);
      // A starting server is stable, so retained profiles take it too. Only a
      // single unambiguous UID match may be written.
      if (!row || row.originServerId === null || !member.gameProfile || member.gameProfile.originServer !== undefined ||
          member.gameProfile.lastRankPublicId !== row.lastRankPublicId ||
          state.members.filter((other) => other.gameProfile?.uid === row.uid).length !== 1) return member;
      return { ...member, gameProfile: { ...member.gameProfile, originServer: row.originServerId } };
    }),
  };
}
