import update from "./data/rscl-profile-retry-2026-09-13.json";
import type { TrackerState } from "./types";

/** Apply verified retries to mapped profiles without replaying the full roster. */
export function applyProfileRefreshRetries(state: TrackerState): TrackerState {
  if (state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927" ||
      state.rosterImport !== update.rosterImport || state.memberProfileUpdates?.includes(update.id)) return state;
  if (update.members.some((row) =>
    state.members.filter((member) => member.gameProfile?.uid === row.uid).length !== 1 ||
    state.members.some((member) => member.gameProfile?.uid === row.uid && member.gameProfile.lastRankPublicId !== row.lastRankPublicId) ||
    state.members.some((member) => member.gameProfile?.lastRankPublicId === row.lastRankPublicId && member.gameProfile.uid !== row.uid))) return state;
  return {
    ...state,
    memberProfileUpdates: [...(state.memberProfileUpdates ?? []), update.id],
    members: state.members.map((member) => {
      const row = update.members.find((row) => row.uid === member.gameProfile?.uid);
      if (!row || !member.gameProfile) return member;
      // A later source refresh or officer rename must survive this older retry.
      if (Date.parse(member.gameProfile.sourceUpdatedAt ?? "") >= Date.parse(row.gameProfile.sourceUpdatedAt)) return member;
      const name = member.canonicalName === row.previousName ? row.name : member.canonicalName;
      return {
        ...member,
        canonicalName: name,
        aliases: name === member.canonicalName ? member.aliases : [...new Set([...member.aliases, member.canonicalName])].filter((alias) => alias !== name),
        previousNames: name === member.canonicalName ? member.previousNames : [...new Set([...(member.previousNames ?? []), member.canonicalName])].filter((alias) => alias !== name),
        gameProfile: {
          ...member.gameProfile,
          ...row.gameProfile,
          rank: row.gameProfile.rank as NonNullable<typeof member.gameProfile>["rank"],
          refreshStatus: "fresh",
          sourceActivityDate: undefined,
          heroPowerMeasuredAt: row.gameProfile.heroPowerMeasuredAt ?? undefined,
        },
      };
    }),
  };
}
