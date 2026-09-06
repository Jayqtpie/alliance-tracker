import { requiresHumanReview } from "./review";
import type { Member, RankingEntry, Snapshot, TrackerState } from "./types";

export interface WeeklyPerformer {
  member: Member;
  entry: RankingEntry;
  pointChange?: number;
  percentChange?: number;
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
  const previousWeekDate = new Date(`${selected.weekStart}T12:00:00Z`);
  previousWeekDate.setUTCDate(previousWeekDate.getUTCDate() - 7);
  const previousWeek = previousWeekDate.toISOString().slice(0, 10);
  // Never compare an unfinished live week with a completed week. Also exclude
  // later corrections when viewing a historical capture.
  const previous = selected.status === "final" ? state.snapshots
    .filter((snapshot) => snapshot.status === "final" && snapshot.id !== selected.id
      && snapshot.weekStart === previousWeek
      && Date.parse(snapshot.capturedAt) < Date.parse(selected.capturedAt))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart)
      || Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || a.id.localeCompare(b.id))[0] : undefined;
  const previousByMember = new Map(previous
    ? eligibleEntries(previous, state.members).map((row) => [row.member.id, row.entry]) : []);
  const compared = leaders.flatMap((row): WeeklyPerformer[] => {
    const prior = previousByMember.get(row.member.id);
    if (!prior) return [];
    const pointChange = row.entry.points - prior.points;
    return [{ ...row, pointChange, percentChange: prior.points > 0 ? pointChange / prior.points * 100 : undefined }];
  });
  const declines = compared.filter((row) => (row.pointChange ?? 0) < 0)
    .sort((a, b) => a.pointChange! - b.pointChange! || a.member.id.localeCompare(b.member.id));
  return {
    snapshot: selected,
    previous,
    leaders,
    winner: leaders[0],
    tiedLeaders: leaders.length ? leaders.filter((row) => row.entry.points === leaders[0].entry.points).length : 0,
    declines,
    comparedCount: compared.length,
    excludedCount: selected.entries.length - leaders.length,
  };
}
