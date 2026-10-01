import { describe, expect, it } from "vitest";
import { attendanceCounts, attendanceSummary, createSvsEvent, eventKind, lockedFightViolation, markAllPresent, overallAttendance, repeatAbsences, setAttendance } from "./svs";
import type { Member, SvsEvent } from "./types";

const member = (id: string, active = true): Member => ({ id, canonicalName: id, aliases: [], active });

describe("createSvsEvent", () => {
  it("snapshots only the active roster, everyone absent", () => {
    const event = createSvsEvent([member("a"), member("b"), member("gone", false)], "2026-09-19", "  vs #931 ");
    expect(event.date).toBe("2026-09-19");
    expect(event.label).toBe("vs #931");
    expect(event.attendance).toEqual({ a: "absent", b: "absent" });
    expect(event.id).toBeTruthy();
  });

  it("omits a blank label", () => {
    expect(createSvsEvent([], "2026-09-19", "   ").label).toBeUndefined();
  });

  it("records the event kind, SvS unless told otherwise", () => {
    expect(createSvsEvent([], "2026-09-19").kind).toBe("svs");
    expect(createSvsEvent([], "2026-10-04", undefined, "goldvein").kind).toBe("goldvein");
  });
});

describe("lockedFightViolation", () => {
  const locked: SvsEvent = { id: "l", date: "2026-09-19", label: "vs #931", locked: true, attendance: { a: "present", b: "absent" } };
  const open: SvsEvent = { id: "o", date: "2026-09-26", attendance: { a: "absent" } };

  it("accepts a locked fight sent back unchanged, whatever its attendance order", () => {
    expect(lockedFightViolation([locked, open], [{ ...locked, attendance: { b: "absent", a: "present" } }, setAttendance(open, "a", "present")])).toBeUndefined();
  });

  it("accepts unlocking on its own, and locking a fight along with edits", () => {
    expect(lockedFightViolation([locked], [{ ...locked, locked: false }])).toBeUndefined();
    expect(lockedFightViolation([open], [{ ...setAttendance(open, "a", "present"), locked: true }])).toBeUndefined();
  });

  it("refuses edits, relabels, kind changes and deletion of a locked fight, even while unlocking", () => {
    for (const next of [
      [setAttendance(locked, "b", "present")],
      [{ ...locked, label: "vs #940" }],
      [{ ...locked, date: "2026-09-20" }],
      [{ ...locked, kind: "goldvein" as const }],
      [{ ...locked, attendance: { a: "present" as const } }],
      [{ ...setAttendance(locked, "b", "present"), locked: false }],
      [],
    ]) expect(lockedFightViolation([locked], next)?.id).toBe("l");
  });
});

describe("eventKind", () => {
  it("treats fights saved before kinds existed as SvS", () => {
    expect(eventKind({ id: "old", date: "2026-09-12", attendance: {} })).toBe("svs");
    expect(eventKind({ id: "gv", date: "2026-10-04", kind: "goldvein", attendance: {} })).toBe("goldvein");
  });
});

describe("setAttendance", () => {
  it("returns a new event without mutating the input", () => {
    const event: SvsEvent = { id: "e", date: "2026-09-19", attendance: { a: "absent" } };
    const next = setAttendance(event, "a", "present");
    expect(next.attendance.a).toBe("present");
    expect(event.attendance.a).toBe("absent");
  });
});

describe("markAllPresent", () => {
  it("marks absent members present and leaves excused alone", () => {
    const event: SvsEvent = { id: "e", date: "2026-09-19", attendance: { a: "absent", b: "excused", c: "present" } };
    expect(markAllPresent(event).attendance).toEqual({ a: "present", b: "excused", c: "present" });
    expect(event.attendance.a).toBe("absent");
  });
});

describe("attendanceCounts", () => {
  it("counts each state", () => {
    expect(attendanceCounts({ id: "e", date: "2026-09-19", attendance: { a: "present", b: "absent", c: "excused", d: "present" } }))
      .toEqual({ present: 2, absent: 1, excused: 1, total: 4 });
  });
});

describe("overallAttendance", () => {
  it("pools every fight, leaving excused out of the rate", () => {
    const totals = overallAttendance([
      { id: "1", date: "2026-09-01", attendance: { a: "present", b: "absent", c: "excused", d: "present" } },
      { id: "2", date: "2026-09-08", attendance: { a: "present", b: "present" } },
    ]);
    expect(totals).toEqual({ fights: 2, rate: 4 / 5, averagePresent: 2, averageRoster: 3 });
  });

  it("has no numbers before the first fight", () => {
    expect(overallAttendance([])).toEqual({ fights: 0, rate: null, averagePresent: null, averageRoster: null });
  });
});

describe("attendanceSummary", () => {
  const events: SvsEvent[] = [
    { id: "1", date: "2026-09-01", attendance: { a: "present", b: "absent", c: "excused" } },
    { id: "2", date: "2026-09-08", attendance: { a: "present", b: "present", c: "excused" } },
    { id: "3", date: "2026-09-15", attendance: { a: "absent", b: "absent" } },
  ];

  it("leaves excused fights out of the rate", () => {
    const rows = attendanceSummary(events, [member("a"), member("b"), member("c")]);
    const byId = Object.fromEntries(rows.map((row) => [row.member.id, row]));
    expect(byId.a).toMatchObject({ present: 2, absent: 1, excused: 0, rate: 2 / 3 });
    expect(byId.b).toMatchObject({ present: 1, absent: 2, excused: 0, rate: 1 / 3 });
    expect(byId.c).toMatchObject({ present: 0, absent: 0, excused: 2, rate: null });
  });

  it("gives a null rate to members with no recorded fights, and ignores unknown ids", () => {
    const rows = attendanceSummary([{ id: "x", date: "2026-09-01", attendance: { ghost: "present" } }], [member("new")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ present: 0, absent: 0, excused: 0, rate: null });
  });

  it("sorts worst rate first, members with no rate last", () => {
    const rows = attendanceSummary(events, [member("a"), member("c"), member("b")]);
    expect(rows.map((row) => row.member.id)).toEqual(["b", "a", "c"]);
  });
});

describe("repeatAbsences", () => {
  // Deliberately out of date order: the rule reads newest first.
  const fight = (date: string, attendance: SvsEvent["attendance"]): SvsEvent => ({ id: date, date, attendance });
  const events: SvsEvent[] = [
    fight("2026-09-03", { streaky: "present", window: "absent", excusedGap: "absent", fine: "present", left: "absent" }),
    fight("2026-09-01", { streaky: "present", window: "absent", excusedGap: "present", fine: "absent", left: "absent" }),
    fight("2026-09-05", { streaky: "present", window: "present", excusedGap: "absent", fine: "absent", left: "absent" }),
    fight("2026-09-07", { streaky: "absent", window: "absent", excusedGap: "excused", fine: "present", left: "absent", newbie: "absent" }),
    fight("2026-09-09", { streaky: "absent", window: "present", excusedGap: "absent", fine: "present", left: "absent", newbie: "absent" }),
  ];
  const roster = ["streaky", "window", "excusedGap", "fine", "newbie"].map((id) => member(id)).concat(member("left", false));

  it("flags a current streak or too many misses in the recent window, skipping excused", () => {
    const rows = repeatAbsences(events, roster);
    const byId = Object.fromEntries(rows.map((row) => [row.member.id, row]));
    expect(byId.streaky).toMatchObject({ streak: 2, recentAbsent: 2, recentCounted: 5, lastPresent: "2026-09-05" });
    expect(byId.window).toMatchObject({ streak: 0, recentAbsent: 3, lastPresent: "2026-09-09" });
    // excused on 09-07 is skipped, so 09-09, 09-05 and 09-03 are one unbroken streak
    expect(byId.excusedGap).toMatchObject({ streak: 3, recentAbsent: 3, recentCounted: 4, lastPresent: "2026-09-01" });
    expect(byId.newbie).toMatchObject({ streak: 2, recentCounted: 2, lastPresent: null });
    expect(byId.fine).toBeUndefined();
    expect(byId.left).toBeUndefined();
  });

  it("sorts longest streak first, then most recent misses, then name", () => {
    expect(repeatAbsences(events, roster).map((row) => row.member.id)).toEqual(["excusedGap", "newbie", "streaky", "window"]);
  });

  it("does not flag a single miss", () => {
    expect(repeatAbsences([fight("2026-09-01", { a: "absent" })], [member("a")])).toEqual([]);
  });
});
