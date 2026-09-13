import { describe, expect, it } from "vitest";
import { INITIAL_STATE } from "./seed";
import { importCapturedRoster } from "./roster-import";
import { applyProfileRefreshRetries } from "./profile-refresh-retries";
import update from "./data/rscl-profile-retry-2026-09-13.json";

const baseline = () => importCapturedRoster(structuredClone(INITIAL_STATE));
describe("verified LastRank retries", () => {
  it("updates only verified profiles once while preserving officer edits and all history", () => {
    const before = baseline();
    const target = before.members.find(m => m.gameProfile?.uid === update.members[0].uid)!;
    target.id = "merged-identity";
    target.canonicalName = "Officer rename";
    target.manualStats = { kills: 0, updatedAt: "2026-09-13" };
    target.notes = "Retain this";
    target.active = false;
    const after = applyProfileRefreshRetries(before);
    expect(after.snapshots).toBe(before.snapshots);
    expect(after.operations).toBe(before.operations);
    expect(after.uploads).toBe(before.uploads);
    expect(after.members).toHaveLength(before.members.length);
    for (const member of before.members) {
      const next = after.members.find(m => m.id === member.id)!;
      const row = update.members.find(r => r.uid === member.gameProfile?.uid);
      if (!row) { expect(next).toBe(member); continue; }
      expect(next.gameProfile?.heroPower).toBe(row.gameProfile.heroPower);
      expect(next.gameProfile?.kills).toBe(row.gameProfile.kills);
      expect(next.gameProfile?.refreshStatus).toBe("fresh");
      expect(next.manualStats).toBe(member.manualStats);
      expect(next.notes).toBe(member.notes);
      expect(next.active).toBe(member.active);
      expect(next.canonicalName).toBe(member.canonicalName);
      expect(next.aliases).toBe(member.aliases);
      expect(next.previousNames).toBe(member.previousNames);
    }
    expect(after.members.filter(m => m.gameProfile?.refreshStatus === "retained").map(m => m.canonicalName)).toEqual(["InfernoBlaze"]);
    expect(applyProfileRefreshRetries(after)).toBe(after);
  });
  it("holds missing, duplicate or conflicting mappings and other roster versions", () => {
    const state = baseline();
    const target = state.members.find(m => m.gameProfile?.uid === update.members[0].uid)!;
    for (const candidate of [
      { ...state, rosterImport: "custom-alliance" },
      { ...state, rosterImport: "lwservers-rscl-927-2026-09-14-v1" },
      { ...state, alliance: { ...state.alliance, tag: "OTHER" } },
      { ...state, members: state.members.filter(m => m !== target) },
      { ...state, members: [...state.members, { ...target, id: "duplicate" }] },
      { ...state, members: state.members.map(m => m === target ? { ...m, gameProfile: { ...m.gameProfile!, lastRankPublicId: "conflicting" } } : m) },
    ]) expect(applyProfileRefreshRetries(candidate)).toBe(candidate);
  });
  it("preserves source data that was refreshed after this retry", () => {
    const state = baseline();
    const target = state.members.find(m => m.gameProfile?.uid === update.members[0].uid)!;
    target.gameProfile = { ...target.gameProfile!, sourceUpdatedAt: "2026-09-14T12:00:00Z", kills: 123 };
    const after = applyProfileRefreshRetries(state);
    expect(after.members.find(m => m.id === target.id)).toBe(target);
  });
});
