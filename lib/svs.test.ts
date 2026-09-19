import { describe, expect, it } from "vitest";
import { attendanceCounts, attendanceSummary, createSvsEvent, markAllPresent, overallAttendance, setAttendance } from "./svs";
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
