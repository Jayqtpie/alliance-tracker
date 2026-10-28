import { describe, expect, it } from "vitest";
import {
  createStormWeek, lineupProblem, lockedWeekViolation, markStartersPlayed, mergeStormMember, nextStormDate, parkedFor,
  parksNextWeek, placeMember, previousWeek, removeMember, setConfirmed, setOutcome, setPark, setResult, STORM_SLOTS, stormDayProblem,
  stormKindOn, stormSummary, suggestLineup, weekCounts,
} from "./storms";
import type { Member, StormSlot, StormWeek } from "./types";

// Hero power falls by index: m000 is the strongest. Total power runs the other way, so picking by it would show.
const roster = (count: number, heroPowerAt = (index: number) => 1_000_000 - index * 1000): Member[] => Array.from({ length: count }, (_, index) => ({
  id: `m${String(index).padStart(3, "0")}`, canonicalName: `m${String(index).padStart(3, "0")}`, aliases: [], active: true,
  manualStats: { power: 1000 + index * 1000, heroPower: heroPowerAt(index), updatedAt: "2026-10-01" },
}));
const heroOf = (members: Member[]) => new Map(members.map((member) => [member.id, member.manualStats!.heroPower!]));
const teamGap = (slots: StormSlot[], hero: Map<string, number>, role: StormSlot["role"]) => slots
  .filter((value) => value.role === role)
  .reduce((gap, value) => gap + (value.team === "A" ? 1 : -1) * hero.get(value.memberId)!, 0);
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

  it("splits each role so the teams' hero power is as even as it can be", () => {
    // Evenly spaced: an exact split exists and is found.
    const even = roster(100);
    const evenSlots = suggestLineup(even, [], "2026-10-02");
    expect(teamGap(evenSlots, heroOf(even), "starter")).toBe(0);
    expect(teamGap(evenSlots, heroOf(even), "sub")).toBe(0);
    // Uneven, with a few far stronger players: placing each on the lighter team alone leaves a 34M gap;
    // the trades bring it within two steps of the spacing between starters.
    const uneven = roster(100, (index) => [410e6, 395e6, 370e6][index] ?? 300e6 - index * 1_370_011);
    const unevenSlots = suggestLineup(uneven, [], "2026-10-02");
    expect(Math.abs(teamGap(unevenSlots, heroOf(uneven), "starter"))).toBeLessThan(1_370_011 * 2);
  });

  it("keeps returning players on last week's team and balances around them", () => {
    // Last week the five strongest all played on A. With 60 members everyone is picked; those five stay
    // on A and the rest even out the totals.
    const members = roster(60);
    const last = week("w1", "2026-10-02", members.slice(0, 5).map((member) => slot(member.id, "starter", "A", { result: "played" })));
    const slots = suggestLineup(members, [last], "2026-10-09");
    for (const member of members.slice(0, 5)) expect(slots.find((value) => value.memberId === member.id)?.team).toBe("A");
    expect(teamGap(slots, heroOf(members), "starter")).toBe(0);
  });

  it("creates a week from the suggestion with nothing recorded", () => {
    const created = createStormWeek(roster(5), [], "2026-10-02", "canyon");
    expect(created).toMatchObject({ kind: "canyon", date: "2026-10-02" });
    expect(created.slots.every((value) => value.result === undefined)).toBe(true);
  });

  it("creates an empty week to fill from the game", () => {
    const created = createStormWeek(roster(5), [], "2026-10-01", "canyon", false);
    expect(created).toMatchObject({ kind: "canyon", date: "2026-10-01", slots: [] });
    expect(lineupProblem(created)).toBeUndefined();
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
  it("takes a team off the confirmed list when its lineup changes, and only that team", () => {
    const confirmed = week("w", "2026-10-02", [slot("a", "starter", "A"), slot("b", "starter", "B"), slot("c", "sub", "B")], { confirmed: ["A", "B"] });
    expect(setConfirmed(confirmed, "A", false).confirmed).toEqual(["B"]);
    expect(setConfirmed(setConfirmed(confirmed, "A", false), "B", false)).not.toHaveProperty("confirmed");
    expect(setConfirmed(week("w", "2026-10-02", []), "B", true).confirmed).toEqual(["B"]);
    // Recording a result, or "moving" someone to the seat they already have, changes no lineup.
    expect(setResult(confirmed, "a", "played").confirmed).toEqual(["A", "B"]);
    expect(placeMember(confirmed, "a", "A", "starter")).toBe(confirmed);
    expect(placeMember(confirmed, "c", "B", "starter").confirmed).toEqual(["A"]);
    expect(placeMember(confirmed, "b", "A", "starter").confirmed).toBeUndefined();
    expect(placeMember(confirmed, "new", "A", "sub").confirmed).toEqual(["B"]);
    expect(removeMember(confirmed, "c").confirmed).toEqual(["A"]);
    expect(removeMember(confirmed, "nobody")).toBe(confirmed);
  });


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
    expect(lockedWeekViolation([locked], [setConfirmed(locked, "A", true)])?.id).toBe("w");
    expect(lockedWeekViolation([locked], [{ ...locked, times: { A: "02:00" } }])?.id).toBe("w");
    expect(lockedWeekViolation([locked], [setOutcome(locked, "B", { result: "win", opponent: "[XYZ] Rivals" })])?.id).toBe("w");
    const won = setOutcome(locked, "A", { result: "win" });
    expect(lockedWeekViolation([won], [setOutcome(won, "A", { result: "win", opponent: "[XYZ]" })])?.id).toBe("w");
  });

  it("records each team's win or loss and opponent, dropping a blank opponent and an empty result set", () => {
    const base = week("w", "2026-10-02", []);
    const both = setOutcome(setOutcome(base, "A", { result: "win", opponent: "[XYZ] Rivals" }), "B", { result: "loss", opponent: "  " });
    expect(both.outcomes).toEqual({ A: { result: "win", opponent: "[XYZ] Rivals" }, B: { result: "loss" } });
    expect(setOutcome(setOutcome(both, "A", undefined), "B", undefined)).not.toHaveProperty("outcomes");
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
