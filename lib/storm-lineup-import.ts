import type { BridgeLineupHeader } from "./bridge-types";
import { memberStats } from "./member-stats";
import { setConfirmed, STORM_CAPACITY, STORM_ROLES, STORM_TEAMS } from "./storms";
import { matchMember, normalizeName, suggestMember } from "./tracker";
import type { ExtractedRow, Member, StormSlot, StormSlotRole, StormTeam, StormWeek } from "./types";

/**
 * Confirming a team against the game: the game's View Participants list for one Task Force, read from
 * screenshots, becomes that team's lineup here. Its rows have no rank and no score: a name, the player's
 * total hero power (carried in `points`) and whether the game seats them as a starter or a sub.
 */

/** An officer's answer for one row, by its number: the member it is, or null to leave the row out. */
export type LineupRowChoices = Record<number, string | null>;
export type LineupRowStatus = "matched" | "unmatched" | "duplicate" | "skipped";

export interface LineupImportRow {
  row: ExtractedRow & { role: StormSlotRole };
  status: LineupRowStatus;
  member?: Member;
  /** For an unmatched row, a member it may be. */
  suggestion?: Member;
  /**
   * A similar name, or only a close hero power. Power survives a rename, but other players sit close
   * too, so a power suggestion is a lead for the officer, never a match.
   */
  suggestedBy?: "name" | "hero power";
  /** In the other team in this week's lineup: confirming moves them across. */
  fromOtherTeam?: boolean;
}

export interface LineupImportPlan {
  rows: LineupImportRow[];
  /** This team's members here whom the game doesn't list: confirming takes them out of the week. */
  leaving: string[];
  /** Rows read per role, apart from rows left out. */
  counts: Record<StormSlotRole, number>;
  /** Reasons the list can't be applied as it stands. */
  problems: string[];
  /** Things worth a look that don't stop it. */
  warnings: string[];
  blocked: boolean;
}

const ROLE_ORDER: Record<StormSlotRole, number> = { starter: 0, sub: 1 };
// A hero power this close is worth suggesting; real renames read within about 1%.
const POWER_TOLERANCE = 0.02;

/**
 * Overlapping screenshots repeat rows. With no rank to key on, a row is the same as another when its
 * name reads the same, or its hero power and seat do. Disagreeing readings keep the more confident one,
 * flagged for review. Rows come back starters first, strongest first, numbered from 1.
 */
export function dedupeLineupRows(rows: ExtractedRow[]): ExtractedRow[] {
  const kept: ExtractedRow[] = [];
  for (const row of rows) {
    if (!row.role) continue;
    const index = kept.findIndex((other) => normalizeName(other.displayName) === normalizeName(row.displayName)
      || (other.points === row.points && other.role === row.role));
    if (index < 0) { kept.push(row); continue; }
    const other = kept[index];
    const agree = normalizeName(other.displayName) === normalizeName(row.displayName) && other.points === row.points && other.role === row.role;
    const chosen = row.confidence > other.confidence ? row : other;
    kept[index] = agree && !other.needsReview && !row.needsReview ? chosen : { ...chosen, needsReview: true };
  }
  return kept
    .sort((a, b) => ROLE_ORDER[a.role!] - ROLE_ORDER[b.role!] || b.points - a.points || a.displayName.localeCompare(b.displayName))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function closestByPower(heroPower: number, members: Member[]) {
  let best: { member: Member; gap: number } | undefined;
  for (const member of members) {
    const power = memberStats(member).heroPower;
    if (!power) continue;
    const gap = Math.abs(power - heroPower) / heroPower;
    if (gap <= POWER_TOLERANCE && (!best || gap < best.gap)) best = { member, gap };
  }
  return best?.member;
}

/** Reads one team's game list against this week's lineup. Nothing changes until it is applied. */
export function planLineupImport(week: StormWeek, team: StormTeam, rows: ExtractedRow[], members: Member[], header: BridgeLineupHeader = {}, choices: LineupRowChoices = {}): LineupImportPlan {
  const byId = new Map(members.map((member) => [member.id, member]));
  const slotOf = new Map(week.slots.map((slot) => [slot.memberId, slot]));
  const seated = rows.filter((row): row is ExtractedRow & { role: StormSlotRole } => Boolean(row.role));
  const resolved = seated.map((row) => {
    const choice = choices[row.rank];
    if (choice === null) return { row, skipped: true as const };
    return { row, member: choice ? byId.get(choice) : matchMember(row.displayName, members) };
  });
  const uses = new Map<string, number>();
  for (const entry of resolved) if ("member" in entry && entry.member) uses.set(entry.member.id, (uses.get(entry.member.id) ?? 0) + 1);
  // A power suggestion only points at someone no other row already is.
  const unclaimed = members.filter((member) => !uses.has(member.id));

  const planned: LineupImportRow[] = resolved.map((entry) => {
    if ("skipped" in entry) return { row: entry.row, status: "skipped" };
    const { row, member } = entry;
    if (!member) {
      const byName = suggestMember(row.displayName, members)?.member;
      const byPower = byName ? undefined : closestByPower(row.points, unclaimed);
      return { row, status: "unmatched", suggestion: byName ?? byPower, suggestedBy: byName ? "name" : byPower ? "hero power" : undefined };
    }
    const slot = slotOf.get(member.id);
    return { row, member, status: (uses.get(member.id) ?? 0) > 1 ? "duplicate" : "matched", fromOtherTeam: Boolean(slot && slot.team !== team) };
  });

  const counts: Record<StormSlotRole, number> = { starter: 0, sub: 0 };
  for (const entry of planned) if (entry.status !== "skipped") counts[entry.row.role] += 1;
  const read: Record<StormSlotRole, number> = { starter: 0, sub: 0 };
  for (const row of seated) read[row.role] += 1;

  const problems: string[] = [];
  if (header.team && header.team !== team) problems.push(`These screenshots show Task Force ${header.team}, not team ${team}. Upload them under team ${header.team}.`);
  for (const role of STORM_ROLES) {
    if (counts[role] > STORM_CAPACITY[role]) problems.push(`A team has ${STORM_CAPACITY[role]} ${role} seats, but ${counts[role]} were read. Leave out the extra rows.`);
  }
  const warnings: string[] = [];
  const gameCount: Record<StormSlotRole, number | undefined> = { starter: header.starters, sub: header.subs };
  for (const role of STORM_ROLES) {
    const shown = gameCount[role];
    if (shown !== undefined && shown !== read[role]) warnings.push(`The game shows ${shown} ${role}s but ${read[role]} were read. A screenshot may be missing.`);
  }
  if (planned.some((entry) => entry.row.needsReview && entry.status !== "skipped")) warnings.push("Some names were hard to read. Check the rows marked for a look.");

  const listed = new Set(planned.flatMap((entry) => entry.member && entry.status !== "skipped" ? [entry.member.id] : []));
  const leaving = week.slots.filter((slot) => slot.team === team && !listed.has(slot.memberId)).map((slot) => slot.memberId);
  const blocked = problems.length > 0 || planned.some((entry) => entry.status === "unmatched" || entry.status === "duplicate");
  return { rows: planned, leaving, counts, problems, warnings, blocked };
}

/**
 * The team becomes exactly the game's list, in the game's seats, and is marked confirmed with its battle
 * time. Members who stay in the team keep anything recorded on them; anyone listed from the other team
 * moves across, which leaves that team unconfirmed; the team's other members leave the week.
 */
export function applyLineupImport(week: StormWeek, team: StormTeam, plan: LineupImportPlan, header: BridgeLineupHeader = {}): StormWeek {
  if (plan.blocked) throw new Error("Match or leave out every row before confirming the lineup.");
  const listed = plan.rows.filter((entry) => entry.status === "matched");
  const ids = new Set(listed.map((entry) => entry.member!.id));
  const before = new Map(week.slots.map((slot) => [slot.memberId, slot]));
  const teamSlots: StormSlot[] = listed.map((entry) => {
    const previous = before.get(entry.member!.id);
    return { ...(previous?.team === team ? previous : {}), memberId: entry.member!.id, team, role: entry.row.role };
  });
  const tookFromOther = listed.some((entry) => entry.fromOtherTeam);
  let next: StormWeek = { ...week, slots: [...week.slots.filter((slot) => slot.team !== team && !ids.has(slot.memberId)), ...teamSlots] };
  next = setConfirmed(next, team, true);
  if (tookFromOther) next = setConfirmed(next, STORM_TEAMS.find((value) => value !== team)!, false);
  if (header.battleTime) next = { ...next, times: { ...next.times, [team]: header.battleTime } };
  return next;
}
