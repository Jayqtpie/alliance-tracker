import { describe, expect, it } from "vitest";
import { dedupeRows, normalizeName, snapshotComparison, weekStartFor } from "./tracker";
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
});
