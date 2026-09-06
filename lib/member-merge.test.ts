import { describe, expect, it } from "vitest";
import { createEmptyState } from "./alliance";
import { analyzeImport, matchMember, memberMergeConflicts, memberPerformance, mergeMemberIdentities, normalizeName } from "./tracker";
import type { TrackerState } from "./types";

function fixture(): TrackerState {
  return {
    ...createEmptyState(),
    members: [
      { id: "keep", canonicalName: "구름빛", active: true, aliases: ["Cloud"], notes: "Officer note", gameProfile: {
        uid: "fictional-1", rank: "R4", avatarPath: "/example.png", heroPower: 100, heroPowerDisplay: "100", heroPowerLegacy: false, kills: 10, killsDisplay: "10", capturedOn: "2026-09-05", source: "test",
      } },
      { id: "duplicate", canonicalName: "구름빚", active: true, aliases: ["Cloud OCR"], notes: "Import note" },
    ],
    snapshots: [{
      id: "capture", capturedAt: "2026-09-06T12:00:00Z", weekStart: "2026-08-31", dayLabel: "Sunday", status: "final", sourceType: "manual",
      entries: [{ id: "duplicate-row", memberId: "duplicate", displayName: "Earlier OCR", points: 250, rank: 2, confidence: .8, sourceFile: "capture.png" }],
    }],
    operations: {
      guardianPool: ["duplicate", "keep"],
      stormEvents: [{ id: "storm", type: "desert", team: "A", battleAt: "2026-09-06", status: "draft", starterLimit: 20, substituteLimit: 10, participants: [{ memberId: "duplicate", availability: "available", role: "starter", attendance: "attended", confirmed: true, score: 100 }] }],
      trainAssignments: [{ id: "train", date: "2026-09-06", conductorMemberId: "duplicate", vipMemberId: "duplicate", backupMemberId: "duplicate", vipType: "special-guest", invitationStatus: "accepted", status: "completed" }],
    },
  };
}

describe("roster duplicate cleanup", () => {
  it("retains the correct profile, transfers results and operations, remembers OCR names, and does not mutate the input", () => {
    const state = fixture();
    const before = structuredClone(state);
    const result = mergeMemberIdentities(state, "keep", "duplicate");
    expect(result.members).toHaveLength(1);
    expect(result.members[0].gameProfile).toEqual(state.members[0].gameProfile);
    expect(result.members[0].canonicalName).toBe("구름빛");
    expect(result.members[0].notes).toBe("Officer note · Import note");
    expect(result.snapshots[0].entries).toEqual([{ ...state.snapshots[0].entries[0], memberId: "keep" }]);
    for (const alias of ["구름빚", "Cloud OCR", "Earlier OCR"]) expect(matchMember(alias, result.members)?.id).toBe("keep");
    expect(result.operations?.guardianPool).toEqual(["keep"]);
    expect(result.operations?.stormEvents[0].participants[0]).toEqual({ ...state.operations!.stormEvents[0].participants[0], memberId: "keep" });
    expect(result.operations?.trainAssignments[0]).toMatchObject({ conductorMemberId: "keep", vipMemberId: "keep", backupMemberId: "keep" });
    expect(state).toEqual(before);
  });

  it("requires a valid explicit score choice when identities overlap and never doubles the score", () => {
    const state = fixture();
    state.snapshots[0].entries.unshift({ id: "primary-row", memberId: "keep", displayName: "구름빛", points: 300, rank: 1, confidence: 1 });
    expect(memberMergeConflicts(state, "keep", "duplicate")).toHaveLength(1);
    expect(() => mergeMemberIdentities(state, "keep", "duplicate")).toThrow("Choose which ranking result");
    expect(() => mergeMemberIdentities(state, "keep", "duplicate", { capture: "invalid-row" })).toThrow("Choose which ranking result");
    for (const entryId of ["primary-row", "duplicate-row"]) {
      const result = mergeMemberIdentities(state, "keep", "duplicate", { capture: entryId });
      expect(result.snapshots[0].entries).toEqual([{ ...state.snapshots[0].entries.find((entry) => entry.id === entryId), memberId: "keep" }]);
    }
  });

  it("rejects self merges and missing identities", () => {
    expect(() => mergeMemberIdentities(fixture(), "keep", "keep")).toThrow("different members");
    expect(() => mergeMemberIdentities(fixture(), "keep", "missing")).toThrow("no longer exists");
  });

  it("does not hide older history when the duplicate has a recent join date", () => {
    const state = fixture();
    state.members[1].joinedAt = "2026-09-06";
    state.snapshots.push({ ...state.snapshots[0], id: "prior", capturedAt: "2026-08-30T12:00:00Z", entries: [{ ...state.snapshots[0].entries[0], id: "prior-row", memberId: "keep" }] });
    const result = mergeMemberIdentities(state, "keep", "duplicate");
    expect(memberPerformance(result.members[0], result.snapshots).appearances).toBe(2);
    expect(result.members[0].joinedAt).toBeUndefined();
  });
});

describe("multilingual identity matching", () => {
  it("preserves combining marks and distinguishes names that differ by them", () => {
    expect(normalizeName("ผู้เล่น")).toBe("ผู้เล่น");
    expect(normalizeName("किरण")).not.toBe(normalizeName("करण"));
    expect(normalizeName("cafe\u0301")).toBe(normalizeName("café"));
    for (const name of ["구름빛", "龍之翼", "さくら", "Игрок", "مُحَمَّد", "ผู้เล่น"]) {
      expect(matchMember(name, [{ id: "one", canonicalName: name, active: true, aliases: [] }])?.id).toBe("one");
    }
  });

  it("does not guess between ambiguous aliases or empty normalized names", () => {
    const members = [{ id: "one", canonicalName: "Alpha", aliases: ["Shared"], active: true }, { id: "two", canonicalName: "Bravo", aliases: ["Shared"], active: true }];
    expect(matchMember("Shared", members)).toBeUndefined();
    expect(matchMember("🌟", [{ id: "one", canonicalName: "🔥", aliases: [], active: true }])).toBeUndefined();
  });

  it("clears unmatched warnings after an officer links or confirms the name", () => {
    const members = fixture().members;
    const row = { rank: 1, displayName: "Unread OCR", points: 100, confidence: 1 };
    expect(analyzeImport([row], members)).not.toEqual([]);
    expect(analyzeImport([{ ...row, memberId: "keep" }], members)).toEqual([]);
    expect(analyzeImport([{ ...row, createMember: true }], members)).toEqual([]);
  });
});
