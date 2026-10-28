import { memberStats } from "./member-stats";
import type { Member, StormResult, StormSlot, StormSlotRole, StormTeam, StormTeamOutcome, StormType, StormWeek } from "./types";

export const STORM_KINDS: StormType[] = ["desert", "canyon"];
export const STORM_TEAMS: StormTeam[] = ["A", "B"];
export const STORM_ROLES: StormSlotRole[] = ["starter", "sub"];
export const STORM_RESULTS: StormResult[] = ["played", "missed", "excused"];
/** Per team. Two teams, so 40 starters and 20 subs a week. */
export const STORM_CAPACITY: Record<StormSlotRole, number> = { starter: 20, sub: 10 };
export const STORM_SLOTS = STORM_TEAMS.length * (STORM_CAPACITY.starter + STORM_CAPACITY.sub);
/** The day each battlefield runs, as `getUTCDay()`: Canyon Storm on Thursdays, Desert Storm on Fridays. */
export const STORM_WEEKDAY: Record<StormType, number> = { canyon: 4, desert: 5 };
const WEEKDAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The battlefield that runs on `date`, or undefined on any other day. */
export function stormKindOn(date: string): StormType | undefined {
  return STORM_KINDS.find((kind) => STORM_WEEKDAY[kind] === weekday(date));
}

/** The first battle on or after `date`: of `kind` when given, else of either kind. */
export function nextStormDate(date: string, kind?: StormType) {
  let day = date;
  while (kind ? stormKindOn(day) !== kind : !stormKindOn(day)) day = shiftDays(day, 1);
  return day;
}

/** "Canyon Storm runs on Thursdays." */
export function stormDayRule(kind: StormType) {
  return `${kind === "canyon" ? "Canyon" : "Desert"} Storm runs on ${WEEKDAY_NAMES[STORM_WEEKDAY[kind]]}.`;
}

/** `kind`'s day rule when `date` is the wrong day for it, else undefined. */
export function stormDayProblem(kind: StormType, date: string): string | undefined {
  if (weekday(date) === STORM_WEEKDAY[kind]) return undefined;
  return stormDayRule(kind);
}

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

// Hero power, not total power: total power swings with the troops a player has trained.
const heroPower = (member: Member) => memberStats(member).heroPower ?? 0;
const byHeroPower = (a: Member, b: Member) => heroPower(b) - heroPower(a) || a.canonicalName.localeCompare(b.canonicalName);

/**
 * Next week's lineup. Parked members are left out. Of the rest, those who sat out the previous week
 * go first, then everyone else, each by hero power. The strongest 40 of the 60 start. Each role is
 * then split between the teams with their hero power as even as it can be (see assignTeams).
 */
export function suggestLineup(members: Member[], weeks: StormWeek[], date: string): StormSlot[] {
  const previous = previousWeek(weeks, date);
  const parked = parkedFor(weeks, date);
  const lastTeam = new Map(previous?.slots.map((slot) => [slot.memberId, slot.team]));
  const eligible = members.filter((member) => member.active && !parked.has(member.id));
  const satOut = eligible.filter((member) => !lastTeam.has(member.id)).sort(byHeroPower);
  const played = eligible.filter((member) => lastTeam.has(member.id)).sort(byHeroPower);
  const chosen = [...satOut, ...played].slice(0, STORM_SLOTS).sort(byHeroPower);
  const starterCount = STORM_TEAMS.length * STORM_CAPACITY.starter;
  return [
    ...assignTeams(chosen.slice(0, starterCount), "starter", lastTeam),
    ...assignTeams(chosen.slice(starterCount), "sub", lastTeam),
  ];
}

/**
 * Splits one role between the teams. A returning member keeps last week's team while it has room, since
 * the teams play at different times. Everyone else goes to the lighter team by hero power, strongest
 * first; then one of them from each team trade places while a trade narrows the gap.
 */
function assignTeams(group: Member[], role: StormSlotRole, lastTeam: Map<string, StormTeam>): StormSlot[] {
  const teamOf = new Map<string, StormTeam>();
  const kept = new Set<string>();
  const count = { A: 0, B: 0 }, total = { A: 0, B: 0 };
  const room = (team: StormTeam) => count[team] < STORM_CAPACITY[role];
  const place = (member: Member, team: StormTeam) => { teamOf.set(member.id, team); count[team] += 1; total[team] += heroPower(member); };
  for (const member of group) {
    const preferred = lastTeam.get(member.id);
    if (preferred && room(preferred)) { place(member, preferred); kept.add(member.id); }
  }
  for (const member of group) {
    if (!teamOf.has(member.id)) place(member, !room("B") || (room("A") && total.A <= total.B) ? "A" : "B");
  }
  const movable = (team: StormTeam) => group.filter((member) => !kept.has(member.id) && teamOf.get(member.id) === team);
  // Each trade strictly shrinks the gap, so this ends.
  for (;;) {
    const gap = total.A - total.B;
    let best: [Member, Member] | undefined, bestGap = Math.abs(gap);
    for (const a of movable("A")) for (const b of movable("B")) {
      const next = Math.abs(gap - 2 * (heroPower(a) - heroPower(b)));
      if (next < bestGap) { bestGap = next; best = [a, b]; }
    }
    if (!best) break;
    const [a, b] = best;
    teamOf.set(a.id, "B"); teamOf.set(b.id, "A");
    total.A -= heroPower(a) - heroPower(b); total.B += heroPower(a) - heroPower(b);
  }
  return group.map((member) => ({ memberId: member.id, team: teamOf.get(member.id)!, role }));
}

/** A new week, with the suggested lineup or, for a week to be filled from the game's screenshots, nobody. */
export function createStormWeek(members: Member[], weeks: StormWeek[], date: string, kind: StormType, suggest = true): StormWeek {
  return { id: crypto.randomUUID(), kind, date, slots: suggest ? suggestLineup(members, weeks, date) : [] };
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

/** Marks a team's lineup as matching the game, or not. */
export function setConfirmed(week: StormWeek, team: StormTeam, confirmed: boolean): StormWeek {
  const next: StormWeek = { ...week, confirmed: STORM_TEAMS.filter((value) => value === team ? confirmed : week.confirmed?.includes(value)) };
  // Unset, not empty, so an unconfirmed week stores no key.
  if (!next.confirmed!.length) delete next.confirmed;
  return next;
}

/** Records how a team's battle went, or clears it. A blank opponent is not stored. */
export function setOutcome(week: StormWeek, team: StormTeam, outcome: StormTeamOutcome | undefined): StormWeek {
  const outcomes = { ...week.outcomes };
  if (outcome) {
    const opponent = outcome.opponent?.trim();
    outcomes[team] = opponent ? { result: outcome.result, opponent: outcome.opponent } : { result: outcome.result };
  } else delete outcomes[team];
  const next: StormWeek = { ...week, outcomes };
  // Unset, not empty, so a week with no results stores no key.
  if (!Object.keys(outcomes).length) delete next.outcomes;
  return next;
}

/** A lineup change in a team means it no longer matches what was confirmed against the game. */
function unconfirm(week: StormWeek, ...teams: StormTeam[]): StormWeek {
  return teams.reduce((next, team) => next.confirmed?.includes(team) ? setConfirmed(next, team, false) : next, week);
}

/** Puts a member in a team and role, keeping a recorded result. Unchanged when that group is full. */
export function placeMember(week: StormWeek, memberId: string, team: StormTeam, role: StormSlotRole): StormWeek {
  if (seatsTaken(week, team, role, memberId) >= STORM_CAPACITY[role]) return week;
  const current = week.slots.find((slot) => slot.memberId === memberId);
  if (!current) return unconfirm({ ...week, slots: [...week.slots, { memberId, team, role }] }, team);
  if (current.team === team && current.role === role) return week;
  return unconfirm(updateSlot(week, memberId, { team, role }), current.team, team);
}

export function removeMember(week: StormWeek, memberId: string): StormWeek {
  const current = week.slots.find((slot) => slot.memberId === memberId);
  if (!current) return week;
  return unconfirm({ ...week, slots: week.slots.filter((slot) => slot.memberId !== memberId) }, current.team);
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
  const dayProblem = stormDayProblem(week.kind, week.date);
  if (dayProblem) return dayProblem;
  if (new Set(week.slots.map((slot) => slot.memberId)).size !== week.slots.length) return "A member is in a lineup twice.";
  if (week.confirmed && new Set(week.confirmed).size !== week.confirmed.length) return "A team is confirmed twice.";
  for (const team of STORM_TEAMS) {
    for (const role of STORM_ROLES) {
      if (seatsTaken(week, team, role) > STORM_CAPACITY[role]) return `Team ${team} has more than ${STORM_CAPACITY[role]} ${role}s.`;
    }
  }
  return undefined;
}

function sameWeek(a: StormWeek, b: StormWeek) {
  const slot = (value: StormSlot) => [value.memberId, value.team, value.role, value.result ?? "", value.park ?? ""].join("|");
  const teams = (value: StormWeek) => JSON.stringify([value.confirmed ?? [], STORM_TEAMS.map((team) => [value.times?.[team] ?? "", value.outcomes?.[team]?.result ?? "", value.outcomes?.[team]?.opponent ?? ""])]);
  return a.kind === b.kind && a.date === b.date && teams(a) === teams(b) && a.slots.length === b.slots.length
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
