import { describe, expect, it } from "vitest";
import { analyzeImport, analyzeLargeChanges, dedupeRows, mergeMemberIdentities, normalizeName, snapshotComparison, weekStartFor } from "./tracker";
import type { Snapshot } from "./types";

describe("leaderboard processing", () => {
  it("normalizes Unicode names without losing their letters", () => {
    expect(normalizeName(" [RSCL] 구름 DongJa ")).toBe("구름dongja");
  });

  it("drops the pinned card and merges overlapping screenshots", () => {
    const result = dedupeRows([
      { rank: 1, displayName: "Alpha", points: 100, confidence: .9 },
      { rank: 1, displayName: "Alpha", points: 100, confidence: .98 },
      { rank: 2, displayName: "Bravo", points: 90, confidence: .95 },
      { rank: 23, displayName: "JayQT", points: 50, confidence: .99, isPinned: true },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].confidence).toBe(.98);
    expect(result.warnings).toEqual([]);
  });

  it("compares live snapshots only with the same weekday", () => {
    const make = (id: string, weekStart: string, dayLabel: string, points: number): Snapshot => ({
      id, weekStart, dayLabel,
      capturedAt: `${weekStart}T12:00:00Z`, status: "live", sourceType: "manual",
      entries: [{ id: `${id}-row`, memberId: "m1", rank: 1, displayName: "Alpha", points, confidence: 1 }],
    } as Snapshot);
    const current = make("current", "2026-08-24", "Tuesday", 120);
    const previousTuesday = make("prior-tue", "2026-08-17", "Tuesday", 100);
    const previousWednesday = make("prior-wed", "2026-08-17", "Wednesday", 200);
    const result = snapshotComparison(current, [current, previousWednesday, previousTuesday]);
    expect(result.previous?.id).toBe("prior-tue");
    expect(result.rows[0].pointChange).toBe(20);
    expect(result.rows[0].percentChange).toBe(20);
  });

  it("finds the Monday week start", () => {
    expect(weekStartFor("2026-08-25")).toBe("2026-08-24");
    expect(weekStartFor("2026-08-29")).toBe("2026-08-24");
  });

  it("flags unusually large changes against a matching capture", () => {
    const previous: Snapshot = {
      id: "prior", capturedAt: "2026-08-18T12:00:00Z", weekStart: "2026-08-17", dayLabel: "Tuesday", status: "live", sourceType: "manual",
      entries: [{ id: "prior-row", memberId: "m1", rank: 1, displayName: "Alpha", points: 10_000_000, confidence: 1 }],
    };
    const warnings = analyzeLargeChanges(
      [{ rank: 1, displayName: "Alpha", points: 20_000_000, confidence: 1 }],
      [{ id: "m1", canonicalName: "Alpha", aliases: [], active: true }],
      [previous],
      "2026-08-25",
      "live",
    );
    expect(warnings[0]).toContain("100%");
  });

  it("suggests likely name changes and detects ranking anomalies", () => {
    const members = [{ id: "one", canonicalName: "Newsshooter", aliases: [], active: true }];
    const warnings = analyzeImport([
      { rank: 1, displayName: "NewsShootr", points: 100, confidence: 0.8 },
      { rank: 2, displayName: "Another", points: 120, confidence: 1 },
    ], members);
    expect(warnings.some((warning) => warning.includes("Possible name change: Newsshooter"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("Points increase"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("low OCR confidence"))).toBe(true);
  });

  it("merges aliases and remaps historical entries", () => {
    const history: Snapshot = {
      id: "one",
      capturedAt: "2026-08-25T12:00:00Z",
      weekStart: "2026-08-24",
      dayLabel: "Tuesday",
      status: "live",
      sourceType: "manual",
      entries: [{ id: "entry", memberId: "merge", rank: 1, displayName: "Old Jay", points: 10, confidence: 1 }],
    };
    const merged = mergeMemberIdentities({
      version: 1,
      alliance: { name: "The Rascals", tag: "RSCL", server: "927" },
      updatedAt: "2026-08-25T00:00:00Z",
      uploads: [],
      members: [
        { id: "keep", canonicalName: "JayQT", aliases: [], active: true, joinedAt: "2026-01-01" },
        { id: "merge", canonicalName: "Old Jay", aliases: ["Older Jay"], active: false, joinedAt: "2025-01-01" },
      ],
      snapshots: [history],
    }, "keep", "merge");
    expect(merged.members).toHaveLength(1);
    expect(merged.members[0].aliases).toEqual(["Old Jay", "Older Jay"]);
    expect(merged.members[0].joinedAt).toBe("2025-01-01");
    expect(merged.snapshots[0].entries[0].memberId).toBe("keep");
  });
});
