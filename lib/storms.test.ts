import { describe, expect, it } from "vitest";
import {
  createStormWeek, lineupProblem, lockedWeekViolation, markStartersPlayed, mergeStormMember, nextStormDate, parkedFor,
  parksNextWeek, placeMember, previousWeek, removeMember, setPark, setResult, STORM_SLOTS, stormDayProblem,
  stormKindOn, stormSummary, suggestLineup, weekCounts,
} from "./storms";
import type { Member, StormSlot, StormWeek } from "./types";

// Power falls by index: m000 is the strongest.
const roster = (count: number): Member[] => Array.from({ length: count }, (_, index) => ({
  id: `m${String(index).padStart(3, "0")}`, canonicalName: `m${String(index).padStart(3, "0")}`, aliases: [], active: true,
  manualStats: { power: 1_000_000 - index * 1000, updatedAt: "2026-10-01" },
}));
const week = (id: string, date: string, slots: StormSlot[], extra: Partial<StormWeek> = {}): StormWeek => ({ id, kind: "desert", date, slots, ...extra });
const slot = (memberId: string, role: StormSlot["role"] = "starter", team: StormSlot["team"] = "A", extra: Partial<StormSlot> = {}): StormSlot => ({ memberId, team, role, ...extra });

describe("parking", () => {
  it("parks a starter who missed, never a sub by rule, never excused, and follows an officer override", () => {
    expect(parksNextWeek(slot("a", "starter", "A", { result: "missed" }))).toBe(true);
    expect(parksNextWeek(slot("a", "sub", "A", { result: "missed" }))).toBe(false);
    expect(parksNextWeek(slot("a", "starter", "A", { result: "excused" }))).toBe(false);
    expect(parksNextWeek(slot("a", "starter"))).toBe(false);
    expect(parksNextWeek(slot("a", "sub", "A", { park: true }))).toBe(true);
    expect(parksNextWeek(slot("a", "starter", "A", { result: "missed", park: false }))).toBe(false);
  });

  it("parks from the latest earlier week of either kind, for one week only", () => {
    const weeks = [
      week("w1", "2026-10-02", [slot("a", "starter", "A", { result: "missed" })]),
      week("w2", "2026-10-09", [slot("b", "starter", "A", { result: "missed" })], { kind: "canyon" }),
    ];
    expect(previousWeek(weeks, "2026-10-16")?.id).toBe("w2");
    expect([...parkedFor(weeks, "2026-10-16").keys()]).toEqual(["b"]);
    expect([...parkedFor(weeks, "2026-10-09").keys()]).toEqual(["a"]);
    expect(parkedFor(weeks, "2026-10-02").size).toBe(0);
  });
});

describe("suggestLineup", () => {
  it("fills 40 starters and 20 subs, 20 + 10 per team, strongest starting", () => {
    const members = roster(100);
    const slots = suggestLineup(members, [], "2026-10-02");
    expect(slots).toHaveLength(STORM_SLOTS);
    expect(lineupProblem(week("x", "2026-10-02", slots))).toBeUndefined();
    for (const team of ["A", "B"] as const) {
      expect(slots.filter((value) => value.team === team && value.role === "starter")).toHaveLength(20);
      expect(slots.filter((value) => value.team === team && value.role === "sub")).toHaveLength(10);
    }
    const starters = new Set(slots.filter((value) => value.role === "starter").map((value) => value.memberId));
    expect(starters).toEqual(new Set(members.slice(0, 40).map((member) => member.id)));
    expect(slots.some((value) => value.memberId === "m060")).toBe(false);
  });

  it("rotates in last week's sit-outs, leaves parked members out and keeps teams", () => {
    // 62 members; last week only the top three played. m000 missed as a starter (parked), m001 missed
    // as a sub (not parked by rule), m002 played. The 59 who sat out fill 59 seats, m001 the 60th.
    const members = roster(62);
    const last = week("w1", "2026-10-02", [
      slot("m000", "starter", "A", { result: "missed" }),
      slot("m001", "sub", "B", { result: "missed" }),
      slot("m002", "starter", "B", { result: "played" }),
    ]);
    const next = suggestLineup(members, [last], "2026-10-09");
    const ids = new Set(next.map((value) => value.memberId));
    expect(next).toHaveLength(STORM_SLOTS);
    expect(ids.has("m000")).toBe(false);
    expect(ids.has("m002")).toBe(false);
    for (const member of members.slice(3)) expect(ids.has(member.id)).toBe(true);
    // m001 is now the strongest pick, so starts, and keeps last week's team B.
    expect(next.find((value) => value.memberId === "m001")).toEqual({ memberId: "m001", team: "B", role: "starter" });
  });

  it("creates a week from the suggestion with nothing recorded", () => {
    const created = createStormWeek(roster(5), [], "2026-10-02", "canyon");
    expect(created).toMatchObject({ kind: "canyon", date: "2026-10-02" });
    expect(created.slots.every((value) => value.result === undefined)).toBe(true);
  });

  it("only picks active members and copes with a short roster", () => {
    const members = roster(30).map((member, index) => index === 0 ? { ...member, active: false } : member);
    const slots = suggestLineup(members, [], "2026-10-02");
    expect(slots).toHaveLength(29);
    expect(slots.every((value) => value.role === "starter")).toBe(true);
    expect(slots.some((value) => value.memberId === "m000")).toBe(false);
  });
});

describe("lineup edits", () => {
  it("refuses a move into a full group and keeps a result across a move", () => {
    let current = week("w", "2026-10-02", suggestLineup(roster(100), [], "2026-10-02"));
    const sub = current.slots.find((value) => value.role === "sub")!;
    expect(placeMember(current, sub.memberId, sub.team, "starter")).toBe(current);
    current = setResult(current, sub.memberId, "played");
    const other = sub.team === "A" ? "B" : "A";
    const starter = current.slots.find((value) => value.team === other && value.role === "starter")!;
    current = removeMember(current, starter.memberId);
    current = placeMember(current, sub.memberId, other, "starter");
    expect(current.slots.find((value) => value.memberId === sub.memberId)).toEqual({ memberId: sub.memberId, team: other, role: "starter", result: "played" });
  });

  it("clears a result or override without leaving a key behind", () => {
    const current = week("w", "2026-10-02", [slot("a", "starter", "A", { result: "missed", park: false })]);
    expect(setPark(setResult(current, "a", undefined), "a", undefined).slots[0]).toEqual(slot("a"));
  });

  it("marks only unrecorded starters played", () => {
    const current = markStartersPlayed(week("w", "2026-10-02", [slot("a"), slot("b", "starter", "A", { result: "excused" }), slot("c", "sub")]));
    expect(current.slots.map((value) => value.result)).toEqual(["played", "excused", undefined]);
    expect(weekCounts(current)).toMatchObject({ starters: 2, subs: 1, played: 1, excused: 1, unrecorded: 1, startersPlayed: 1, parked: 0 });
  });

  it("flags duplicates and over-full groups", () => {
    expect(lineupProblem(week("w", "2026-10-02", [slot("a"), slot("a", "sub")]))).toMatch(/twice/);
    const subs = Array.from({ length: 11 }, (_, index) => slot(`s${index}`, "sub", "B"));
    expect(lineupProblem(week("w", "2026-10-02", subs))).toBe("Team B has more than 10 subs.");
  });
});

describe("battle days", () => {
  it("runs Canyon Storm on Thursdays and Desert Storm on Fridays", () => {
    expect(stormKindOn("2026-10-22")).toBe("canyon");
    expect(stormKindOn("2026-10-23")).toBe("desert");
    expect(stormKindOn("2026-10-21")).toBeUndefined();
    expect(stormDayProblem("canyon", "2026-10-22")).toBeUndefined();
    expect(stormDayProblem("canyon", "2026-10-23")).toBe("Canyon Storm runs on Thursdays.");
    expect(lineupProblem(week("w", "2026-10-22", []))).toBe("Desert Storm runs on Fridays.");
    expect(lineupProblem(week("w", "2026-10-22", [], { kind: "canyon" }))).toBeUndefined();
  });

  it("finds the next battle on or after a date", () => {
    expect(nextStormDate("2026-10-21")).toBe("2026-10-22");
    expect(nextStormDate("2026-10-23")).toBe("2026-10-23");
    expect(nextStormDate("2026-10-24")).toBe("2026-10-29");
  });

  it("finds the next battle of one kind", () => {
    expect(nextStormDate("2026-10-22", "desert")).toBe("2026-10-23");
    expect(nextStormDate("2026-10-23", "canyon")).toBe("2026-10-29");
    expect(nextStormDate("2026-10-22", "canyon")).toBe("2026-10-22");
  });
});

describe("locks, summary and merge", () => {
  it("allows only unlocking a locked week", () => {
    const locked = week("w", "2026-10-02", [slot("a", "starter", "A", { result: "played" })], { locked: true });
    expect(lockedWeekViolation([locked], [{ ...locked, locked: false }])).toBeUndefined();
    expect(lockedWeekViolation([locked], [setResult(locked, "a", "missed")])?.id).toBe("w");
    expect(lockedWeekViolation([locked], [])?.id).toBe("w");
  });

  it("summarises per member with excused left out of the rate", () => {
    const members = roster(2);
    const weeks = [
      week("w1", "2026-10-02", [slot("m000", "starter", "A", { result: "played" }), slot("m001", "starter", "A", { result: "missed" })]),
      week("w2", "2026-10-09", [slot("m000", "starter", "A", { result: "excused" }), slot("m001", "sub")]),
    ];
    const [worst, best] = stormSummary(weeks, members);
    expect(worst).toMatchObject({ picked: 2, played: 0, missed: 1, rate: 0, lastPlayed: null });
    expect(best).toMatchObject({ picked: 2, played: 1, excused: 1, rate: 1, lastPlayed: "2026-10-02" });
  });

  it("moves a duplicate onto the primary, keeping the primary's seat and the better result", () => {
    const weeks = [
      week("w1", "2026-10-02", [slot("dup", "sub", "B", { result: "played" })]),
      week("w2", "2026-10-09", [slot("main", "starter", "A", { result: "missed" }), slot("dup", "sub", "B", { result: "played" })]),
    ];
    const [first, second] = mergeStormMember(weeks, "dup", "main");
    expect(first.slots).toEqual([slot("main", "sub", "B", { result: "played" })]);
    expect(second.slots).toEqual([slot("main", "starter", "A", { result: "played" })]);
  });
});
