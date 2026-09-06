import { describe, expect, it } from "vitest";
import { weeklyPerformance } from "./weekly-performance";
import type { Member, RankingEntry, Snapshot } from "./types";

const members: Member[] = ["a", "b", "c", "d"].map((id) => ({ id, canonicalName: id.toUpperCase(), aliases: [], active: true }));
const entry = (memberId: string, points: number, rank = 1, patch: Partial<RankingEntry> = {}): RankingEntry => ({
  id: `${memberId}-entry`, memberId, displayName: memberId, rank, points, confidence: 1, ...patch,
});
const snapshot = (id: string, weekStart: string, entries: RankingEntry[], patch: Partial<Snapshot> = {}): Snapshot => ({
  id, weekStart, capturedAt: `${weekStart}T12:00:00Z`, dayLabel: "Sunday", status: "final", sourceType: "manual", entries, ...patch,
});

describe("weekly overview performance", () => {
  it("uses only the selected capture, without summing cumulative captures or leaking later scores", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 120), entry("b", 100, 2)], { status: "live" });
    const later = snapshot("later", "2026-08-31", [entry("b", 900)], { capturedAt: "2026-09-06T12:00:00Z" });
    const result = weeklyPerformance({ members, snapshots: [later, selected] }, selected);
    expect(result.winner?.member.id).toBe("a");
    expect(result.winner?.entry.points).toBe(120);
    expect(result.snapshot.id).toBe("selected");
    expect(result.previous).toBeUndefined();
    expect(result.declines).toEqual([]);
  });

  it("compares only the immediate previous final week and selects its latest eligible correction", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 100), entry("b", 90, 2)]);
    const old = snapshot("old", "2026-08-24", [entry("a", 80), entry("b", 70, 2)]);
    const prior = snapshot("prior", "2026-08-24", [entry("a", 120), entry("b", 95, 2)], { capturedAt: "2026-08-30T12:00:00Z" });
    const live = snapshot("live", "2026-08-24", [entry("a", 999)], { status: "live", capturedAt: "2026-08-30T18:00:00Z" });
    const futureCorrection = snapshot("future", "2026-08-24", [entry("a", 999)], { capturedAt: "2026-09-02T12:00:00Z" });
    const result = weeklyPerformance({ members, snapshots: [old, futureCorrection, selected, live, prior] }, selected);
    expect(result.previous?.id).toBe("prior");
    expect(result.declines.map((row) => [row.member.id, row.pointChange])).toEqual([["a", -20], ["b", -5]]);
    expect(result.declines[0].percentChange).toBeCloseTo(-100 / 6);
  });

  it("does not compare across a missing week or classify unranked members as zero", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 100)]);
    const older = snapshot("older", "2026-08-17", [entry("a", 500)]);
    expect(weeklyPerformance({ members, snapshots: [older, selected] }, selected).previous).toBeUndefined();
    const prior = snapshot("prior", "2026-08-24", [entry("b", 900)]);
    const result = weeklyPerformance({ members, snapshots: [selected, prior] }, selected);
    expect(result.declines).toEqual([]);
    expect(result.comparedCount).toBe(0);
  });

  it("excludes unlinked, inactive, review-pending and duplicate identities from highlights", () => {
    const selected = snapshot("selected", "2026-08-31", [
      entry("a", 100, 1, { confidence: .7 }), entry("b", 90, 2, { needsReview: true }),
      entry("c", 80, 3), entry("d", 70, 4), entry("d", 60, 5, { id: "duplicate" }),
      entry("unknown", 200, 6), entry("unlinked", 300, 7, { memberId: undefined }),
    ]);
    const result = weeklyPerformance({ members: members.map((member) => ({ ...member, active: member.id !== "c" })), snapshots: [selected] }, selected);
    expect(result.leaders).toEqual([]);
    expect(result.excludedCount).toBe(7);
  });

  it("accepts explicitly reviewed low-confidence scores and reports tied leaders honestly", () => {
    const selected = snapshot("selected", "2026-08-31", [
      entry("a", 100, 2, { confidence: .2, needsReview: true, reviewed: true }), entry("b", 100, 1),
    ]);
    const result = weeklyPerformance({ members, snapshots: [selected] }, selected);
    expect(result.winner?.member.id).toBe("b");
    expect(result.tiedLeaders).toBe(2);
  });

  it("does not infer a decline from unresolved prior scores or scores before a member joined", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 100), entry("b", 90, 2)]);
    const prior = snapshot("prior", "2026-08-24", [entry("a", 200, 1, { needsReview: true }), entry("b", 200, 2)]);
    const result = weeklyPerformance({ members: members.map((member) => member.id === "b" ? { ...member, joinedAt: "2026-08-28" } : member), snapshots: [selected, prior] }, selected);
    expect(result.comparedCount).toBe(0);
    expect(result.declines).toEqual([]);
  });

  it("handles zero scores, rejects invalid points, and leaves input order untouched", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 0, 2), entry("b", 50, 1), entry("c", NaN, 3), entry("d", -1, 4)]);
    const prior = snapshot("prior", "2026-08-24", [entry("a", 100), entry("b", 0, 2)]);
    const state = { members, snapshots: [selected, prior] };
    const before = structuredClone(state);
    const result = weeklyPerformance(state, selected);
    expect(result.leaders.map((row) => row.member.id)).toEqual(["b", "a"]);
    expect(result.declines.map((row) => [row.member.id, row.pointChange, row.percentChange])).toEqual([["a", -100, -100]]);
    expect(result.comparedCount).toBe(2);
    expect(state).toEqual(before);
  });
});
