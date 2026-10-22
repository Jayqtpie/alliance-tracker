import { describe, expect, it } from "vitest";
import { applyLineupImport, dedupeLineupRows, planLineupImport } from "./storm-lineup-import";
import type { ExtractedRow, Member, StormSlot, StormWeek } from "./types";

// Names and hero powers from a real Canyon Storm Task Force A screen (2026-10-23).
const member = (id: string, name: string, heroPower: number, extra: Partial<Member> = {}): Member => ({
  id, canonicalName: name, aliases: [], active: true, manualStats: { heroPower, updatedAt: "2026-10-20" }, ...extra,
});
const members = [
  member("doom", "NotDoom", 389_760_049), member("zoth", "Zothargirl", 401_657_371),
  member("petros", "Tom and Petros", 297_200_000), member("doc", "NotDoc", 258_410_000),
  member("parrot", "dr parrot", 249_080_000), member("orion", "I Orion I", 216_850_000, { active: false }),
  member("alak", "ᏗᏝᎥ ᏗᏦ47", 205_630_000), member("bench", "Bench warmer", 150_000_000),
];
const row = (displayName: string, millions: number, role: StormSlot["role"], extra: Partial<ExtractedRow> = {}): ExtractedRow =>
  ({ rank: 1, displayName, points: Math.round(millions * 1e6), confidence: 0.95, role, ...extra });
const slot = (memberId: string, team: StormSlot["team"], role: StormSlot["role"] = "starter", extra: Partial<StormSlot> = {}): StormSlot => ({ memberId, team, role, ...extra });
const week = (slots: StormSlot[], extra: Partial<StormWeek> = {}): StormWeek => ({ id: "w", kind: "canyon", date: "2026-10-22", slots, ...extra });

describe("dedupeLineupRows", () => {
  it("merges overlapping screenshots and numbers starters first, strongest first", () => {
    const rows = dedupeLineupRows([
      row("dr parrot", 250, "sub"), row("NotDoom", 391.2, "starter"),
      row("NotDoom", 391.2, "starter", { confidence: 0.99 }),
      // The same row read two ways: same power and seat, so one row, flagged for a look.
      row("ღMBღ Gíxxie", 233.5, "starter"), row("ღMBღ Gixxie", 233.5, "starter", { confidence: 0.9 }),
      row("Zothargirl", 402.5, "starter"),
    ]);
    expect(rows.map((value) => [value.rank, value.displayName, value.role])).toEqual([
      [1, "Zothargirl", "starter"], [2, "NotDoom", "starter"], [3, "ღMBღ Gíxxie", "starter"], [4, "dr parrot", "sub"],
    ]);
    expect(rows[1].confidence).toBe(0.99);
    expect(rows[1].needsReview).toBeUndefined();
    expect(rows[2].needsReview).toBe(true);
  });

  it("drops rows with no seat", () => {
    expect(dedupeLineupRows([{ rank: 1, displayName: "Nobody", points: 1, confidence: 1 }])).toEqual([]);
  });
});

describe("planLineupImport", () => {
  const rows = dedupeLineupRows([
    row("NotDoom", 391.2, "starter"), row("Zothargirl", 402.5, "starter"), row("NotPetros", 298.2, "starter"),
    row("Doc404", 260.9, "starter"), row("dr parrot", 250, "sub"), row("I Orion I", 217.7, "starter"),
    row("RezzZz", 206, "sub"), row("Hashim 99", 172.5, "sub"),
  ]);
  const byName = (plan: ReturnType<typeof planLineupImport>, name: string) => plan.rows.find((entry) => entry.row.displayName === name)!;

  it("matches names, suggests renames by hero power, and finds nothing for a stranger", () => {
    const plan = planLineupImport(week([]), "A", rows, members);
    expect(byName(plan, "NotDoom")).toMatchObject({ status: "matched", member: { id: "doom" } });
    // Left the alliance in our records but in the game's list: still matched, for the officer to see.
    expect(byName(plan, "I Orion I")).toMatchObject({ status: "matched", member: { id: "orion", active: false } });
    // Renamed: within 1% of the stored hero power.
    expect(byName(plan, "NotPetros")).toMatchObject({ status: "unmatched", suggestion: { id: "petros" }, suggestedBy: "hero power" });
    expect(byName(plan, "Doc404")).toMatchObject({ status: "unmatched", suggestion: { id: "doc" }, suggestedBy: "hero power" });
    // A newcomer whose power happens to sit near someone else's: suggested, which is why it is only a suggestion.
    expect(byName(plan, "RezzZz")).toMatchObject({ status: "unmatched", suggestion: { id: "alak" } });
    expect(byName(plan, "Hashim 99").suggestion).toBeUndefined();
    expect(plan.blocked).toBe(true);
  });

  it("applies once every row is a member or left out", () => {
    const ranks = Object.fromEntries(rows.map((value) => [value.displayName, value.rank]));
    const plan = planLineupImport(week([]), "A", rows, members, {}, { [ranks.NotPetros]: "petros", [ranks.Doc404]: "doc", [ranks.RezzZz]: null, [ranks["Hashim 99"]]: null });
    expect(plan.blocked).toBe(false);
    expect(plan.counts).toEqual({ starter: 5, sub: 1 });
  });

  it("blocks two rows on one member", () => {
    const plan = planLineupImport(week([]), "A", [row("NotDoom", 391.2, "starter", { rank: 1 }), row("Something", 100, "starter", { rank: 2 })], members, {}, { 2: "doom" });
    expect(plan.rows.map((entry) => entry.status)).toEqual(["duplicate", "duplicate"]);
    expect(plan.blocked).toBe(true);
  });

  it("blocks screenshots of the other Task Force and an over-full team", () => {
    const wrongTeam = planLineupImport(week([]), "A", [row("NotDoom", 391.2, "starter")], members, { team: "B" });
    expect(wrongTeam.problems[0]).toContain("Task Force B");
    expect(wrongTeam.blocked).toBe(true);
    const subMembers = Array.from({ length: 11 }, (_, index) => member(`s${index}`, `Sub ${index}`, 100e6 + index));
    const subs = subMembers.map((value, index) => row(value.canonicalName, 100 + index, "sub", { rank: index + 1 }));
    const overFull = planLineupImport(week([]), "A", subs, subMembers);
    expect(overFull.rows.every((entry) => entry.status === "matched")).toBe(true);
    expect(overFull.problems).toEqual(["A team has 10 sub seats, but 11 were read. Leave out the extra rows."]);
    expect(overFull.blocked).toBe(true);
  });

  it("warns when the game's counts don't match what was read", () => {
    const plan = planLineupImport(week([]), "A", [row("NotDoom", 391.2, "starter")], members, { starters: 20, subs: 9 });
    expect(plan.warnings).toEqual([
      "The game shows 20 starters but 1 were read. A screenshot may be missing.",
      "The game shows 9 subs but 0 were read. A screenshot may be missing.",
    ]);
    expect(plan.blocked).toBe(false);
  });

  it("names who moves across and who leaves the team", () => {
    const current = week([slot("doom", "B"), slot("bench", "A"), slot("parrot", "A", "sub")]);
    const plan = planLineupImport(current, "A", [row("NotDoom", 391.2, "starter", { rank: 1 }), row("dr parrot", 250, "sub", { rank: 2 })], members);
    expect(plan.rows[0].fromOtherTeam).toBe(true);
    expect(plan.rows[1].fromOtherTeam).toBe(false);
    expect(plan.leaving).toEqual(["bench"]);
  });
});

describe("applyLineupImport", () => {
  it("makes the team the game's list, confirmed, with its battle time", () => {
    const current = week(
      [slot("doom", "B"), slot("bench", "A"), slot("parrot", "A", "starter", { park: true }), slot("zoth", "B", "sub")],
      { confirmed: ["A", "B"], times: { B: "earlier" } },
    );
    const rows = [row("NotDoom", 391.2, "starter", { rank: 1 }), row("dr parrot", 250, "sub", { rank: 2 })];
    const plan = planLineupImport(current, "A", rows, members);
    const next = applyLineupImport(current, "A", plan, { team: "A", battleTime: "2026-10-23 02:00~02:30 (Local Time)" });
    expect(next.slots).toEqual([
      slot("zoth", "B", "sub"),
      slot("doom", "A"),
      // Stayed in the team: keeps what was recorded on them, in the game's seat.
      slot("parrot", "A", "sub", { park: true }),
    ]);
    // NotDoom came from B, so B no longer matches the game.
    expect(next.confirmed).toEqual(["A"]);
    expect(next.times).toEqual({ B: "earlier", A: "2026-10-23 02:00~02:30 (Local Time)" });
  });

  it("refuses a blocked plan", () => {
    const plan = planLineupImport(week([]), "A", [row("Stranger", 1, "starter")], members);
    expect(() => applyLineupImport(week([]), "A", plan)).toThrow();
  });
});
