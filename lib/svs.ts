import type { Member, SvsAttendance, SvsEvent } from "./types";

export const SVS_ATTENDANCE: SvsAttendance[] = ["present", "absent", "excused"];

export function createSvsEvent(members: Member[], date: string, label?: string): SvsEvent {
  const trimmed = label?.trim();
  return {
    id: crypto.randomUUID(),
    date,
    ...(trimmed ? { label: trimmed } : {}),
    attendance: Object.fromEntries(members.filter((member) => member.active).map((member) => [member.id, "absent" as const])),
  };
}

export function setAttendance(event: SvsEvent, memberId: string, value: SvsAttendance): SvsEvent {
  return { ...event, attendance: { ...event.attendance, [memberId]: value } };
}

/** Excused marks are deliberate, so they survive a bulk "everyone showed up". */
export function markAllPresent(event: SvsEvent): SvsEvent {
  return { ...event, attendance: Object.fromEntries(Object.entries(event.attendance).map(([id, value]) => [id, value === "excused" ? value : "present"])) };
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
