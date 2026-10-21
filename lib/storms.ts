import { memberStats } from "./member-stats";
import type { Member, StormResult, StormSlot, StormSlotRole, StormTeam, StormType, StormWeek } from "./types";

export const STORM_KINDS: StormType[] = ["desert", "canyon"];
export const STORM_TEAMS: StormTeam[] = ["A", "B"];
export const STORM_ROLES: StormSlotRole[] = ["starter", "sub"];
export const STORM_RESULTS: StormResult[] = ["played", "missed", "excused"];
/** Per team. Two teams, so 40 starters and 20 subs a week. */
export const STORM_CAPACITY: Record<StormSlotRole, number> = { starter: 20, sub: 10 };
export const STORM_SLOTS = STORM_TEAMS.length * (STORM_CAPACITY.starter + STORM_CAPACITY.sub);

/**
 * Whether this slot keeps its member out of the next week. A starter who missed is parked; a sub is
 * never parked by the rule, since an unused sub does not appear in the results. Excused never parks.
 * An officer's override wins either way.
 */
export function parksNextWeek(slot: StormSlot) {
  return slot.park ?? (slot.role === "starter" && slot.result === "missed");
}

/** The latest week before `date`, of either kind: parking and rotation carry across kinds. */
export function previousWeek(weeks: StormWeek[], date: string): StormWeek | undefined {
  return weeks.filter((week) => week.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** Members parked for the week on `date`, with the week they were parked from. */
export function parkedFor(weeks: StormWeek[], date: string) {
  const previous = previousWeek(weeks, date);
  return new Map(previous ? previous.slots.filter(parksNextWeek).map((slot) => [slot.memberId, previous] as const) : []);
}

const power = (member: Member) => memberStats(member).power ?? 0;
const byPower = (a: Member, b: Member) => power(b) - power(a) || a.canonicalName.localeCompare(b.canonicalName);

/**
 * Next week's lineup. Parked members are left out. Of the rest, those who sat out the previous week
 * go first, then everyone else, each by power. The strongest 40 of the 60 start. A member keeps the
 * previous week's team when it has room in their role, since teams play at different times;
 * everyone else joins whichever team is weaker so far.
 */
export function suggestLineup(members: Member[], weeks: StormWeek[], date: string): StormSlot[] {
  const previous = previousWeek(weeks, date);
  const parked = parkedFor(weeks, date);
  const lastTeam = new Map(previous?.slots.map((slot) => [slot.memberId, slot.team]));
  const eligible = members.filter((member) => member.active && !parked.has(member.id));
  const satOut = eligible.filter((member) => !lastTeam.has(member.id)).sort(byPower);
  const played = eligible.filter((member) => lastTeam.has(member.id)).sort(byPower);
  const chosen = [...satOut, ...played].slice(0, STORM_SLOTS).sort(byPower);
  const starterCount = STORM_TEAMS.length * STORM_CAPACITY.starter;
  return [
    ...assignTeams(chosen.slice(0, starterCount), "starter", lastTeam),
    ...assignTeams(chosen.slice(starterCount), "sub", lastTeam),
  ];
}

function assignTeams(group: Member[], role: StormSlotRole, lastTeam: Map<string, StormTeam>): StormSlot[] {
  const count = { A: 0, B: 0 }, total = { A: 0, B: 0 };
  const room = (team: StormTeam) => count[team] < STORM_CAPACITY[role];
  return group.map((member) => {
    const preferred = lastTeam.get(member.id);
    const team: StormTeam = preferred && room(preferred) ? preferred
      : !room("B") || (room("A") && total.A <= total.B) ? "A" : "B";
    count[team] += 1; total[team] += power(member);
    return { memberId: member.id, team, role };
  });
}

export function createStormWeek(members: Member[], weeks: StormWeek[], date: string, kind: StormType): StormWeek {
  return { id: crypto.randomUUID(), kind, date, slots: suggestLineup(members, weeks, date) };
}

function updateSlot(week: StormWeek, memberId: string, change: Partial<Pick<StormSlot, "result" | "park" | "team" | "role">>): StormWeek {
  return { ...week, slots: week.slots.map((slot) => {
    if (slot.memberId !== memberId) return slot;
    const next = { ...slot, ...change };
    // Unset, not undefined, so a cleared field leaves no key behind in the stored JSON.
    if (next.result === undefined) delete next.result;
    if (next.park === undefined) delete next.park;
    return next;
  }) };
}

export function setResult(week: StormWeek, memberId: string, result: StormResult | undefined): StormWeek {
  return updateSlot(week, memberId, { result });
}

/** `undefined` goes back to the rule. */
export function setPark(week: StormWeek, memberId: string, park: boolean | undefined): StormWeek {
  return updateSlot(week, memberId, { park });
}

export function seatsTaken(week: StormWeek, team: StormTeam, role: StormSlotRole, except?: string) {
  return week.slots.filter((slot) => slot.team === team && slot.role === role && slot.memberId !== except).length;
}

/** Puts a member in a team and role, keeping a recorded result. Unchanged when that group is full. */
export function placeMember(week: StormWeek, memberId: string, team: StormTeam, role: StormSlotRole): StormWeek {
  if (seatsTaken(week, team, role, memberId) >= STORM_CAPACITY[role]) return week;
  const current = week.slots.find((slot) => slot.memberId === memberId);
  if (!current) return { ...week, slots: [...week.slots, { memberId, team, role }] };
  return updateSlot(week, memberId, { team, role });
}

export function removeMember(week: StormWeek, memberId: string): StormWeek {
  return { ...week, slots: week.slots.filter((slot) => slot.memberId !== memberId) };
}

/** Records every unrecorded starter as played. Subs stay unrecorded: most are never called in. */
export function markStartersPlayed(week: StormWeek): StormWeek {
  return { ...week, slots: week.slots.map((slot) => slot.role === "starter" && !slot.result ? { ...slot, result: "played" as const } : slot) };
}

export function weekCounts(week: StormWeek) {
  const counts = { starters: 0, subs: 0, played: 0, missed: 0, excused: 0, unrecorded: 0, startersPlayed: 0, parked: 0 };
  for (const slot of week.slots) {
    if (slot.role === "starter") counts.starters += 1; else counts.subs += 1;
    if (slot.result) counts[slot.result] += 1; else counts.unrecorded += 1;
    if (slot.role === "starter" && slot.result === "played") counts.startersPlayed += 1;
    if (parksNextWeek(slot)) counts.parked += 1;
  }
  return counts;
}

/** What is wrong with a lineup, or undefined. The server checks this on every save. */
export function lineupProblem(week: StormWeek): string | undefined {
  if (new Set(week.slots.map((slot) => slot.memberId)).size !== week.slots.length) return "A member is in a lineup twice.";
  for (const team of STORM_TEAMS) {
    for (const role of STORM_ROLES) {
      if (seatsTaken(week, team, role) > STORM_CAPACITY[role]) return `Team ${team} has more than ${STORM_CAPACITY[role]} ${role}s.`;
    }
  }
  return undefined;
}

function sameWeek(a: StormWeek, b: StormWeek) {
  const slot = (value: StormSlot) => [value.memberId, value.team, value.role, value.result ?? "", value.park ?? ""].join("|");
  return a.kind === b.kind && a.date === b.date && a.slots.length === b.slots.length
    && a.slots.every((value, index) => slot(value) === slot(b.slots[index]));
}

/** The first stored locked week that `incoming` deletes or changes. Unlocking alone is allowed. */
export function lockedWeekViolation(stored: StormWeek[], incoming: StormWeek[]): StormWeek | undefined {
  const byId = new Map(incoming.map((week) => [week.id, week]));
  return stored.find((week) => {
    if (!week.locked) return false;
    const next = byId.get(week.id);
    return !next || !sameWeek(week, next);
  });
}

export interface StormSummaryRow { member: Member; picked: number; played: number; missed: number; excused: number; rate: number | null; lastPlayed: string | null }

/** Per member, across every week. Excused and unrecorded slots don't count toward the rate. Worst rate first. */
export function stormSummary(weeks: StormWeek[], members: Member[]): StormSummaryRow[] {
  const newestFirst = [...weeks].sort((a, b) => b.date.localeCompare(a.date));
  return members.map((member) => {
    const row: StormSummaryRow = { member, picked: 0, played: 0, missed: 0, excused: 0, rate: null, lastPlayed: null };
    for (const week of newestFirst) {
      const slot = week.slots.find((value) => value.memberId === member.id);
      if (!slot) continue;
      row.picked += 1;
      if (slot.result) row[slot.result] += 1;
      if (slot.result === "played" && !row.lastPlayed) row.lastPlayed = week.date;
    }
    const counted = row.played + row.missed;
    row.rate = counted ? row.played / counted : null;
    return row;
  }).sort((a, b) => (a.rate ?? 2) - (b.rate ?? 2) || a.member.canonicalName.localeCompare(b.member.canonicalName));
}

const RESULT_RANK: Record<StormResult, number> = { missed: 0, excused: 1, played: 2 };

/** Moves a merged duplicate's slots onto the primary. Both in one week: the primary's seat, the better result. */
export function mergeStormMember(weeks: StormWeek[], duplicateId: string, primaryId: string): StormWeek[] {
  return weeks.map((week) => {
    const moved = week.slots.find((slot) => slot.memberId === duplicateId);
    if (!moved) return week;
    const kept = week.slots.find((slot) => slot.memberId === primaryId);
    if (!kept) return { ...week, slots: week.slots.map((slot) => slot === moved ? { ...slot, memberId: primaryId } : slot) };
    const better = !kept.result || (moved.result && RESULT_RANK[moved.result] > RESULT_RANK[kept.result]) ? moved.result : kept.result;
    return { ...week, slots: week.slots.filter((slot) => slot !== moved).map((slot) => slot === kept ? { ...slot, ...(better ? { result: better } : {}) } : slot) };
  });
}
