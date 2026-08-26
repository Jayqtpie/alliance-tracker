import { describe, expect, it } from "vitest";
import { addDays, applyGuardianRotation, assignmentsForWeek, hydrateOperations, mondayFor } from "./operations";

describe("alliance operations", () => {
  it("hydrates older tracker state with empty operation collections", () => {
    expect(hydrateOperations()).toEqual({ stormEvents: [], guardianPool: [], trainAssignments: [] });
  });

  it("finds Monday and produces stable UTC date increments", () => {
    expect(mondayFor("2026-08-26")).toBe("2026-08-24");
    expect(mondayFor("2026-08-30")).toBe("2026-08-24");
    expect(addDays("2026-08-30", 1)).toBe("2026-08-31");
  });

  it("assigns each of seven Guardians exactly once while preserving conductors", () => {
    const operations = {
      stormEvents: [],
      guardianPool: ["g1", "g2", "g3", "g4", "g5", "g6", "g7"],
      trainAssignments: [{
        id: "monday", date: "2026-08-24", conductorMemberId: "driver", vipType: "none" as const,
        invitationStatus: "not-sent" as const, status: "planned" as const,
      }],
    };
    const result = applyGuardianRotation(operations, "2026-08-24");
    const week = assignmentsForWeek(result.trainAssignments, "2026-08-24");
    expect(week).toHaveLength(7);
    expect(week.map((assignment) => assignment.vipMemberId)).toEqual(operations.guardianPool);
    expect(week[0].conductorMemberId).toBe("driver");
    expect(week.every((assignment) => assignment.vipType === "guardian-defender")).toBe(true);
  });
});
