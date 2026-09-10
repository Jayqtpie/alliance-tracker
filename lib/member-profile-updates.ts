import update from "./data/rscl-profile-updates-2026-09-10.json";
import type { TrackerState } from "./types";

/** Apply the two user-confirmed identity updates once, using retained game UIDs. */
export function applyMemberProfileUpdates(state: TrackerState): TrackerState {
  if (state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927" ||
      state.rosterImport === "custom-alliance" || state.memberProfileUpdates?.includes(update.id)) return state;
  // Do not guess or partially apply when a UID is missing or duplicated.
  if (update.members.some((row) => state.members.filter((member) => member.gameProfile?.uid === row.uid).length !== 1)) return state;
  return {
    ...state,
    memberProfileUpdates: [...(state.memberProfileUpdates ?? []), update.id],
    members: state.members.map((member) => {
      const row = update.members.find((entry) => entry.uid === member.gameProfile?.uid);
      if (!row || !member.gameProfile) return member;
      return {
        ...member,
        canonicalName: row.name,
        aliases: [...new Set([...member.aliases, member.canonicalName, row.previousName])].filter((name) => name !== row.name),
        previousNames: [...new Set([...(member.previousNames ?? []), member.canonicalName, row.previousName])].filter((name) => name !== row.name),
        gameProfile: { ...member.gameProfile, avatarPath: row.avatarPath },
      };
    }),
  };
}
