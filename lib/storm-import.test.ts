import { describe, expect, it } from "vitest";
import { applyStormImport, planStormImport, rebuildTeamFromResults } from "./storm-import";
import type { ExtractedRow, Member, StormSlot, StormWeek } from "./types";

const member = (id: string, name = id, extra: Partial<Member> = {}): Member => ({ id, canonicalName: name, aliases: [], active: true, ...extra });
const slot = (memberId: string, role: StormSlot["role"] = "starter", team: StormSlot["team"] = "B", extra: Partial<StormSlot> = {}): StormSlot => ({ memberId, team, role, ...extra });
const row = (rank: number, displayName: string): ExtractedRow => ({ rank, displayName, points: 1_000_000 - rank, confidence: 0.98 });
const week = (slots: StormSlot[]): StormWeek => ({ id: "w1", kind: "desert", date: "2026-10-16", slots });
const resultOf = (value: StormWeek, memberId: string) => value.slots.find((item) => item.memberId === memberId)?.result;

const members = [
  member("zoth", "Zothargirl"), member("monsta", "monsta717"), member("parrot", "dr parrot"), member("goblin", "Retired Goblin"),
  member("sorry", "SᵒᵒᵒᵒʳʳʳY"), member("vic", "Viccked", { active: false }), member("other", "Team A starter"), member("bench", "Bench warmer"),
];

describe("planning a storm import", () => {
  const lineup = week([slot("zoth"), slot("monsta"), slot("parrot"), slot("goblin", "sub"), slot("sorry"), slot("other", "starter", "A")]);

  it("matches the team's rows, misses absent starters, and leaves unused subs alone", () => {
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl"), row(2, "monsta717"), row(3, "SᵒᵒᵒᵒʳʳʳY")], members);
    expect(plan.played).toEqual(["zoth", "monsta", "sorry"]);
    expect(plan.missed).toEqual(["parrot"]);
    expect(plan.blocked).toBe(false);
  });

  it("blocks on a misread name and suggests the closest member", () => {
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl"), row(2, "SᵒᵒᵒʳʳʳY")], members);
    expect(plan.rows[1]).toMatchObject({ status: "unmatched", suggestion: { id: "sorry" } });
    expect(plan.blocked).toBe(true);
    // Until it is resolved, the misread starter would be missed: the reason applying is blocked.
    expect(plan.missed).toContain("sorry");
    expect(() => applyStormImport(lineup, "B", plan)).toThrow();
    const resolved = planStormImport(lineup, "B", [row(1, "Zothargirl"), row(2, "SᵒᵒᵒʳʳʳY")], members, { 2: "sorry" });
    expect(resolved.blocked).toBe(false);
    expect(resolved.played).toContain("sorry");
  });

  it("lets an officer leave a row out", () => {
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl"), row(2, "Nobody we know")], members, { 2: null });
    expect(plan.rows[1].status).toBe("skipped");
    expect(plan.blocked).toBe(false);
  });

  it("blocks when two rows point at one member", () => {
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl"), row(2, "Something else")], members, { 2: "zoth" });
    expect(plan.rows.map((entry) => entry.status)).toEqual(["duplicate", "duplicate"]);
    expect(plan.blocked).toBe(true);
  });

  it("lists members outside this team for review instead of changing them", () => {
    const plan = planStormImport(lineup, "B", [row(1, "Team A starter"), row(2, "Bench warmer"), row(3, "Viccked")], members);
    expect(plan.rows.map((entry) => entry.status)).toEqual(["other-team", "not-in-lineup", "not-in-lineup"]);
    expect(plan.rows[2].member?.active).toBe(false);
    expect(plan.played).toEqual([]);
    expect(plan.blocked).toBe(false);
  });

  it("does not turn an excused starter into missed", () => {
    const excused = week([slot("zoth"), slot("parrot", "starter", "B", { result: "excused" })]);
    expect(planStormImport(excused, "B", [row(1, "Zothargirl")], members).missed).toEqual([]);
  });
});

describe("applying a storm import", () => {
  it("records played and missed, and overrides an earlier manual result", () => {
    const lineup = week([slot("zoth", "starter", "B", { result: "missed" }), slot("parrot", "starter", "B", { result: "played" }), slot("goblin", "sub")]);
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl")], members);
    const { week: next } = applyStormImport(lineup, "B", plan);
    expect([resultOf(next, "zoth"), resultOf(next, "parrot"), resultOf(next, "goblin")]).toEqual(["played", "missed", undefined]);
  });

  it("moves only the confirmed outsiders into the team as played, as subs first", () => {
    const lineup = week([slot("zoth"), slot("other", "starter", "A")]);
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl"), row(2, "Team A starter"), row(3, "Bench warmer")], members);
    const { week: next, unplaced } = applyStormImport(lineup, "B", plan, ["other", "zoth"]);
    expect(next.slots.find((item) => item.memberId === "other")).toMatchObject({ team: "B", role: "sub", result: "played" });
    expect(next.slots.some((item) => item.memberId === "bench")).toBe(false);
    expect(unplaced).toEqual([]);
  });

  it("handles an in-game swap: the starter who was never in the game's lineup leaves, freeing the seat", () => {
    const full = week([
      slot("parrot"), ...Array.from({ length: 19 }, (_, index) => slot(`s${index}`)),
      ...Array.from({ length: 10 }, (_, index) => slot(`u${index}`, "sub")),
    ]);
    const rows = [row(1, "Bench warmer"), ...Array.from({ length: 19 }, (_, index) => row(index + 2, `s${index}`))];
    const others = [...members, ...Array.from({ length: 19 }, (_, index) => member(`s${index}`))];
    const plan = planStormImport(full, "B", rows, others);
    expect(plan.missed).toEqual(["parrot"]);
    expect(applyStormImport(full, "B", plan, ["bench"]).unplaced).toEqual(["bench"]);
    const { week: next, unplaced } = applyStormImport(full, "B", plan, ["bench"], ["parrot"]);
    expect(unplaced).toEqual([]);
    expect(next.slots.some((item) => item.memberId === "parrot")).toBe(false);
    expect(next.slots.find((item) => item.memberId === "bench")).toMatchObject({ team: "B", role: "starter", result: "played" });
  });

  it("only removes starters the plan would have marked missed", () => {
    const lineup = week([slot("zoth"), slot("parrot")]);
    const plan = planStormImport(lineup, "B", [row(1, "Zothargirl")], members);
    const { week: next } = applyStormImport(lineup, "B", plan, [], ["zoth", "parrot"]);
    expect(next.slots.map((item) => [item.memberId, item.result])).toEqual([["zoth", "played"]]);
  });

  it("reports an outsider with no free seat and leaves them where they were", () => {
    const full = week([
      ...Array.from({ length: 20 }, (_, index) => slot(`s${index}`)),
      ...Array.from({ length: 10 }, (_, index) => slot(`u${index}`, "sub")),
    ]);
    const plan = planStormImport(full, "B", [row(1, "Bench warmer")], members, {});
    const { week: next, unplaced } = applyStormImport(full, "B", plan, ["bench"]);
    expect(unplaced).toEqual(["bench"]);
    expect(next.slots.some((item) => item.memberId === "bench")).toBe(false);
  });
});

describe("rebuilding a team from its results", () => {
  const pointsRow = (rank: number, displayName: string, points: number): ExtractedRow => ({ rank, displayName, points, confidence: 0.98 });

  it("makes the team exactly the listed members, all played, the higher scorers starting", () => {
    const lineup = week([slot("zoth", "sub"), slot("parrot"), slot("goblin", "sub"), slot("other", "starter", "A"), slot("bench", "starter", "A")]);
    const plan = planStormImport(lineup, "B", [pointsRow(1, "Zothargirl", 900), pointsRow(2, "Team A starter", 800)], members);
    const { week: next, unplaced } = rebuildTeamFromResults(lineup, "B", plan);
    expect(unplaced).toEqual([]);
    expect(next.slots).toEqual([
      slot("bench", "starter", "A"),
      slot("zoth", "starter", "B", { result: "played" }),
      slot("other", "starter", "B", { result: "played" }),
    ]);
  });

  it("fills 20 starters by points, then 10 subs, and reports anyone past 30", () => {
    const many = Array.from({ length: 31 }, (_, index) => member(`p${index}`));
    const rows = many.map((value, index) => pointsRow(index + 1, value.id, 1000 - index));
    const plan = planStormImport(week([]), "A", rows, many);
    const { week: next, unplaced } = rebuildTeamFromResults(week([]), "A", plan);
    expect(next.slots.filter((value) => value.role === "starter").map((value) => value.memberId)).toEqual(many.slice(0, 20).map((value) => value.id));
    expect(next.slots.filter((value) => value.role === "sub")).toHaveLength(10);
    expect(unplaced).toEqual(["p30"]);
  });

  it("leaves out skipped rows and refuses while a row is unmatched", () => {
    const rows = [pointsRow(1, "Zothargirl", 900), pointsRow(2, "Nobody we know", 800)];
    expect(() => rebuildTeamFromResults(week([]), "B", planStormImport(week([]), "B", rows, members))).toThrow();
    const { week: next } = rebuildTeamFromResults(week([]), "B", planStormImport(week([]), "B", rows, members, { 2: null }));
    expect(next.slots.map((value) => value.memberId)).toEqual(["zoth"]);
  });
});
