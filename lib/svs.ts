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

export function attendanceCounts(event: SvsEvent) {
  const counts = { present: 0, absent: 0, excused: 0, total: 0 };
  for (const value of Object.values(event.attendance)) { counts[value] += 1; counts.total += 1; }
  return counts;
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
