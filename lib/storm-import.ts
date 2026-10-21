import { placeMember, removeMember, setResult, STORM_CAPACITY, seatsTaken } from "./storms";
import { matchMember, suggestMember } from "./tracker";
import type { ExtractedRow, Member, StormSlotRole, StormTeam, StormWeek } from "./types";

/** An officer's answer for one row, by rank: the member it is, or null to leave the row out. */
export type StormRowChoices = Record<number, string | null>;

/**
 * team: in this team's lineup. other-team / not-in-lineup: a real member, but the lineup says otherwise,
 * so an officer decides. unmatched: no member yet. duplicate: two rows point at one member.
 */
export type StormRowStatus = "team" | "other-team" | "not-in-lineup" | "unmatched" | "duplicate" | "skipped";

export interface StormImportRow {
  row: ExtractedRow;
  status: StormRowStatus;
  member?: Member;
  /** For an unmatched row, the closest name on the roster. */
  suggestion?: Member;
}

export interface StormImportPlan {
  rows: StormImportRow[];
  /** This team's members in the results: they played. */
  played: string[];
  /** This team's starters missing from the results, unless already excused. Missed parks them. */
  missed: string[];
  /** Applying waits until every row is a member or left out, since a misread name would park someone who played. */
  blocked: boolean;
}

/** Reads one team's results mail against that team's lineup. Only players who entered are listed. */
export function planStormImport(week: StormWeek, team: StormTeam, rows: ExtractedRow[], members: Member[], choices: StormRowChoices = {}): StormImportPlan {
  const byId = new Map(members.map((member) => [member.id, member]));
  const slotOf = new Map(week.slots.map((slot) => [slot.memberId, slot]));
  const resolved = rows.map((row) => {
    const choice = choices[row.rank];
    if (choice === null) return { row, skipped: true as const };
    return { row, member: choice ? byId.get(choice) : matchMember(row.displayName, members) };
  });
  const uses = new Map<string, number>();
  for (const entry of resolved) if ("member" in entry && entry.member) uses.set(entry.member.id, (uses.get(entry.member.id) ?? 0) + 1);

  const planned: StormImportRow[] = resolved.map((entry) => {
    if ("skipped" in entry) return { row: entry.row, status: "skipped" };
    const { row, member } = entry;
    if (!member) return { row, status: "unmatched", suggestion: suggestMember(row.displayName, members)?.member };
    if ((uses.get(member.id) ?? 0) > 1) return { row, member, status: "duplicate" };
    const slot = slotOf.get(member.id);
    return { row, member, status: !slot ? "not-in-lineup" : slot.team === team ? "team" : "other-team" };
  });

  const played = planned.filter((entry) => entry.status === "team").map((entry) => entry.member!.id);
  const present = new Set(planned.flatMap((entry) => entry.member ? [entry.member.id] : []));
  const missed = week.slots
    .filter((slot) => slot.team === team && slot.role === "starter" && !present.has(slot.memberId) && slot.result !== "excused")
    .map((slot) => slot.memberId);
  return { rows: planned, played, missed, blocked: planned.some((entry) => entry.status === "unmatched" || entry.status === "duplicate") };
}

/**
 * Records the plan on the week. `add` holds the members from outside this team that an officer
 * confirmed fought for it: each moves into the team, as a sub when there is room, and is played.
 * `remove` holds missing starters who were never in the game's lineup (it differed from the app's):
 * they leave the week instead of being marked missed, which also frees their seats for `add`.
 * Anyone with no free seat comes back in `unplaced` and is left as they were.
 */
export function applyStormImport(week: StormWeek, team: StormTeam, plan: StormImportPlan, add: Iterable<string> = [], remove: Iterable<string> = []) {
  if (plan.blocked) throw new Error("Match or leave out every row before applying the results.");
  const removed = new Set([...remove].filter((memberId) => plan.missed.includes(memberId)));
  let next = week;
  for (const memberId of plan.played) next = setResult(next, memberId, "played");
  for (const memberId of plan.missed) next = removed.has(memberId) ? removeMember(next, memberId) : setResult(next, memberId, "missed");
  const unplaced: string[] = [];
  const outside = new Set(plan.rows.filter((entry) => entry.status === "other-team" || entry.status === "not-in-lineup").map((entry) => entry.member!.id));
  for (const memberId of add) {
    if (!outside.has(memberId)) continue;
    const role: StormSlotRole | undefined = (["sub", "starter"] as const).find((value) => seatsTaken(next, team, value, memberId) < STORM_CAPACITY[value]);
    if (!role) { unplaced.push(memberId); continue; }
    next = setResult(placeMember(next, memberId, team, role), memberId, "played");
  }
  return { week: next, unplaced };
}
