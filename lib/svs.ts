import type { AttendanceEventKind, Member, SvsAttendance, SvsEvent } from "./types";

export const SVS_ATTENDANCE: SvsAttendance[] = ["present", "absent", "excused"];
export const EVENT_KINDS: AttendanceEventKind[] = ["svs", "goldvein"];

export function eventKind(event: SvsEvent): AttendanceEventKind {
  return event.kind ?? "svs";
}

export function createSvsEvent(members: Member[], date: string, label?: string, kind: AttendanceEventKind = "svs"): SvsEvent {
  const trimmed = label?.trim();
  return {
    id: crypto.randomUUID(),
    date,
    ...(trimmed ? { label: trimmed } : {}),
    kind,
    attendance: Object.fromEntries(members.filter((member) => member.active).map((member) => [member.id, "absent" as const])),
  };
}

function sameFight(a: SvsEvent, b: SvsEvent) {
  const ids = Object.keys(a.attendance);
  return a.date === b.date && (a.label ?? "") === (b.label ?? "") && eventKind(a) === eventKind(b)
    && ids.length === Object.keys(b.attendance).length && ids.every((id) => a.attendance[id] === b.attendance[id]);
}

/**
 * The first stored locked fight that `incoming` deletes or changes. Unlocking is the only change a
 * locked fight accepts, and only on its own: unlock, then edit in a later save.
 */
export function lockedFightViolation(stored: SvsEvent[], incoming: SvsEvent[]): SvsEvent | undefined {
  const byId = new Map(incoming.map((event) => [event.id, event]));
  return stored.find((event) => {
    if (!event.locked) return false;
    const next = byId.get(event.id);
    return !next || !sameFight(event, next);
  });
}

export function setAttendance(event: SvsEvent, memberId: string, value: SvsAttendance): SvsEvent {
  return { ...event, attendance: { ...event.attendance, [memberId]: value } };
}

/** Excused marks are deliberate, so they survive a bulk "everyone showed up". */
export function markAllPresent(event: SvsEvent): SvsEvent {
  return { ...event, attendance: Object.fromEntries(Object.entries(event.attendance).map(([id, value]) => [id, value === "excused" ? value : "present"])) };
}

/**
 * How a fight's roster differs from today's: active members it is missing, and ids on it whose
 * member has since left. A fight created before a roster refresh lands drifts this way.
 */
export function rosterDrift(event: SvsEvent, members: Member[]) {
  const byId = new Map(members.map((member) => [member.id, member]));
  return {
    added: members.filter((member) => member.active && !(member.id in event.attendance)),
    removed: Object.keys(event.attendance).filter((id) => !byId.get(id)?.active),
  };
}

/** Brings a fight to the current roster: missing members join as absent, leavers drop off. */
export function syncRoster(event: SvsEvent, members: Member[]): SvsEvent {
  const { added, removed } = rosterDrift(event, members);
  const gone = new Set(removed);
  return { ...event, attendance: {
    ...Object.fromEntries(Object.entries(event.attendance).filter(([id]) => !gone.has(id))),
    ...Object.fromEntries(added.map((member) => [member.id, "absent" as const])),
  } };
}

export function attendanceCounts(event: SvsEvent) {
  const counts = { present: 0, absent: 0, excused: 0, total: 0 };
  for (const value of Object.values(event.attendance)) { counts[value] += 1; counts.total += 1; }
  return counts;
}

/** Alliance-wide totals across every fight. Excused doesn't count toward the rate. */
export function overallAttendance(events: SvsEvent[]) {
  if (!events.length) return { fights: 0, rate: null, averagePresent: null, averageRoster: null };
  let present = 0, absent = 0, roster = 0;
  for (const event of events) {
    const counts = attendanceCounts(event);
    present += counts.present; absent += counts.absent; roster += counts.total;
  }
  return {
    fights: events.length,
    rate: present + absent ? present / (present + absent) : null,
    averagePresent: present / events.length,
    averageRoster: roster / events.length,
  };
}

export const REPEAT_STREAK = 2;
export const REPEAT_WINDOW = 5;
export const REPEAT_WINDOW_MISSES = 3;

export interface RepeatAbsenceRow { member: Member; streak: number; recentAbsent: number; recentCounted: number; lastPresent: string | null }

/**
 * Active members who missed the last {@link REPEAT_STREAK}+ fights in a row, or {@link REPEAT_WINDOW_MISSES}+
 * of their last {@link REPEAT_WINDOW}. Only fights a member was on count, and excused fights are skipped
 * entirely: they neither break a streak nor count as a miss. Longest streak first.
 */
export function repeatAbsences(events: SvsEvent[], members: Member[]): RepeatAbsenceRow[] {
  const newestFirst = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const rows: RepeatAbsenceRow[] = [];
  for (const member of members) {
    if (!member.active) continue;
    const counted = newestFirst.filter((event) => event.attendance[member.id] === "present" || event.attendance[member.id] === "absent");
    const firstPresent = counted.findIndex((event) => event.attendance[member.id] === "present");
    const streak = firstPresent === -1 ? counted.length : firstPresent;
    const recent = counted.slice(0, REPEAT_WINDOW);
    const recentAbsent = recent.filter((event) => event.attendance[member.id] === "absent").length;
    if (streak < REPEAT_STREAK && recentAbsent < REPEAT_WINDOW_MISSES) continue;
    rows.push({ member, streak, recentAbsent, recentCounted: recent.length, lastPresent: firstPresent === -1 ? null : counted[firstPresent].date });
  }
  return rows.sort((a, b) => b.streak - a.streak || b.recentAbsent - a.recentAbsent || a.member.canonicalName.localeCompare(b.member.canonicalName));
}

export interface AttendanceSummaryRow { member: Member; present: number; absent: number; excused: number; rate: number | null }

/** Excused fights don't count toward the rate. Sorted worst rate first; members with no counted fights last. */
export function attendanceSummary(events: SvsEvent[], members: Member[]): AttendanceSummaryRow[] {
  return members.map((member) => {
    const row = { member, present: 0, absent: 0, excused: 0, rate: null as number | null };
    for (const event of events) {
      const value = event.attendance[member.id];
      if (value) row[value] += 1;
    }
    const counted = row.present + row.absent;
    row.rate = counted ? row.present / counted : null;
    return row;
  }).sort((a, b) => (a.rate ?? 2) - (b.rate ?? 2) || a.member.canonicalName.localeCompare(b.member.canonicalName));
}
