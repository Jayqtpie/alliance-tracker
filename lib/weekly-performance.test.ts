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
    expect(result.laggards.map((row) => row.member.id)).toEqual(["b", "a"]);
  });

  it("lists the lowest verified scores of the capture, weakest first", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 400), entry("b", 300, 2), entry("c", 200, 3), entry("d", 100, 4)]);
    const result = weeklyPerformance({ members, snapshots: [selected] }, selected);
    expect(result.laggards.map((row) => [row.member.id, row.entry.points])).toEqual([["d", 100], ["c", 200], ["b", 300]]);
  });

  it("never treats a member missing from the capture as a zero score", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 100)]);
    const result = weeklyPerformance({ members, snapshots: [selected] }, selected);
    expect(result.laggards.map((row) => row.member.id)).toEqual(["a"]);
  });

  it("excludes unlinked, inactive, review-pending and duplicate identities from highlights", () => {
    const selected = snapshot("selected", "2026-08-31", [
      entry("a", 100, 1, { confidence: .7 }), entry("b", 90, 2, { needsReview: true }),
      entry("c", 80, 3), entry("d", 70, 4), entry("d", 60, 5, { id: "duplicate" }),
      entry("unknown", 200, 6), entry("unlinked", 300, 7, { memberId: undefined }),
    ]);
    const result = weeklyPerformance({ members: members.map((member) => ({ ...member, active: member.id !== "c" })), snapshots: [selected] }, selected);
    expect(result.leaders).toEqual([]);
    expect(result.laggards).toEqual([]);
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

  it("does not call a mid-week joiner a low scorer, but keeps members with no recorded join date", () => {
    const selected = snapshot("selected", "2026-08-31", [
      entry("a", 400), entry("b", 300, 2), entry("c", 200, 3), entry("d", 100, 4),
    ], { capturedAt: "2026-09-06T12:00:00Z" });
    const first = snapshot("first", "2026-08-17", [entry("a", 10)], { capturedAt: "2026-08-17T12:00:00Z" });
    const joined = members.map((member) => member.id === "d" ? { ...member, joinedAt: "2026-09-02" } : member);
    expect(weeklyPerformance({ members: joined, snapshots: [first, selected] }, selected)
      .laggards.map((row) => row.member.id)).toEqual(["c", "b", "a"]);
    const early = members.map((member) => member.id === "d" ? { ...member, joinedAt: "2026-08-30" } : member);
    expect(weeklyPerformance({ members: early, snapshots: [first, selected] }, selected)
      .laggards.map((row) => row.member.id)).toEqual(["d", "c", "b"]);
  });

  it("does not mistake the roster present when tracking began for mid-week joiners", () => {
    // An import stamps joinedAt with the capture date, so the founding roster
    // all shares the first capture date and must still be rankable.
    const selected = snapshot("selected", "2026-08-24", [
      entry("a", 400), entry("b", 300, 2), entry("c", 200, 3), entry("d", 100, 4),
    ], { capturedAt: "2026-08-25T12:00:00Z" });
    const founding = members.map((member) => ({ ...member, joinedAt: "2026-08-25" }));
    expect(weeklyPerformance({ members: founding, snapshots: [selected] }, selected)
      .laggards.map((row) => row.member.id)).toEqual(["d", "c", "b"]);
  });

  it("handles zero scores, rejects invalid points, and leaves input order untouched", () => {
    const selected = snapshot("selected", "2026-08-31", [entry("a", 0, 2), entry("b", 50, 1), entry("c", NaN, 3), entry("d", -1, 4)]);
    const state = { members, snapshots: [selected] };
    const before = structuredClone(state);
    const result = weeklyPerformance(state, selected);
    expect(result.leaders.map((row) => row.member.id)).toEqual(["b", "a"]);
    expect(result.laggards.map((row) => [row.member.id, row.entry.points])).toEqual([["a", 0], ["b", 50]]);
    expect(state).toEqual(before);
  });
});
