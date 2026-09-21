import { requiresHumanReview } from "./review";
import type { Member, RankingEntry, Snapshot, TrackerState } from "./types";

export interface WeeklyPerformer {
  member: Member;
  entry: RankingEntry;
}

// A capture is a cumulative score, so each highlight uses one capture only.
// Ambiguous duplicate identities are excluded instead of choosing a convenient score.
function eligibleEntries(snapshot: Snapshot, members: Member[]): WeeklyPerformer[] {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const counts = new Map<string, number>();
  for (const entry of snapshot.entries) {
    if (entry.memberId) counts.set(entry.memberId, (counts.get(entry.memberId) ?? 0) + 1);
  }
  return snapshot.entries.flatMap((entry) => {
    const member = memberById.get(entry.memberId ?? "");
    const date = snapshot.capturedAt.slice(0, 10);
    if (!member?.active || counts.get(member.id) !== 1 || requiresHumanReview(entry)
      || !Number.isSafeInteger(entry.points) || entry.points < 0
      || !Number.isInteger(entry.rank) || entry.rank < 1
      || (member.joinedAt && date < member.joinedAt.slice(0, 10))
      || (member.leftAt && date > member.leftAt.slice(0, 10))) return [];
    return [{ member, entry }];
  });
}

export function weeklyPerformance(state: Pick<TrackerState, "members" | "snapshots">, selected: Snapshot) {
  const leaders = eligibleEntries(selected, state.members).sort((a, b) =>
    b.entry.points - a.entry.points || a.entry.rank - b.entry.rank || a.member.id.localeCompare(b.member.id));
  // A member who joined part-way through the week scores low for a structural
  // reason, not a performance one, so they are not called a low scorer. An
  // import records joinedAt as the capture that first saw the member, so
  // everyone present when tracking began shares the earliest capture date and
  // must not be mistaken for a new joiner.
  const trackingStart = state.snapshots.reduce((earliest, snapshot) =>
    snapshot.capturedAt < earliest ? snapshot.capturedAt : earliest, selected.capturedAt).slice(0, 10);
  const laggards = leaders.filter(({ member }) => {
    const joined = member.joinedAt?.slice(0, 10);
    return !joined || joined < selected.weekStart || joined <= trackingStart;
  }).slice(-3).reverse();
  return {
    snapshot: selected,
    leaders,
    winner: leaders[0],
    tiedLeaders: leaders.length ? leaders.filter((row) => row.entry.points === leaders[0].entry.points).length : 0,
    laggards,
    excludedCount: selected.entries.length - leaders.length,
  };
}
