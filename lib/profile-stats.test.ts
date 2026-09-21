import { describe, expect, it } from "vitest";
import { INITIAL_STATE } from "./seed";
import { importCapturedRoster } from "./roster-import";
import { applyProfileStats, PROFILE_STATS_UPDATE } from "./profile-stats";
import capture from "./data/rscl-roster-2026-09-14.json";

// Simulate a tracker that applied the 14 September capture before power and profession were stored.
const baseline = () => {
  const state = importCapturedRoster(structuredClone(INITIAL_STATE));
  state.memberProfileUpdates = state.memberProfileUpdates?.filter((id) => id !== PROFILE_STATS_UPDATE);
  for (const member of state.members) {
    if (!member.gameProfile) continue;
    delete member.gameProfile.power;
    delete member.gameProfile.powerDisplay;
    delete member.gameProfile.profession;
  }
  return state;
};

describe("LastRank power and profession", () => {
  it("imports power and profession with fresh captured profiles", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    const row = capture.members.find((row) => row.name === "Zothargirl")!;
    const member = state.members.find((m) => m.gameProfile?.uid === row.uid)!;
    expect(member.gameProfile).toMatchObject({ power: 606595540, powerDisplay: "606.6M", profession: "War Leader" });
  });

  it("adds stats once to fresh profiles, leaving retained profiles and officer edits unaltered", () => {
    const before = baseline();
    const target = before.members.find((m) => m.gameProfile?.uid === capture.members[0].uid)!;
    target.canonicalName = "Officer rename";
    target.manualStats = { heroPower: 1, updatedAt: "2026-09-15" };
    const after = applyProfileStats(before);
    expect(after.memberProfileUpdates).toContain(PROFILE_STATS_UPDATE);
    expect(after.members).toHaveLength(before.members.length);
    for (const member of before.members) {
      const next = after.members.find((m) => m.id === member.id)!;
      const row = capture.members.find((r) => r.uid === member.gameProfile?.uid);
      if (!row || row.freshness.status !== "fresh") { expect(next).toBe(member); continue; }
      expect(next.gameProfile).toEqual({ ...member.gameProfile, power: row.profile.power, powerDisplay: row.profile.powerDisplay, profession: row.profile.profession });
      expect(next.canonicalName).toBe(member.canonicalName);
      expect(next.manualStats).toBe(member.manualStats);
    }
    expect(after.members.filter((m) => m.gameProfile?.profession).length).toBe(capture.members.filter((r) => r.freshness.status === "fresh").length);
    expect(applyProfileStats(after)).toBe(after);
  });

  it("holds other alliances and roster versions, and skips conflicting mappings", () => {
    const state = baseline();
    for (const candidate of [
      { ...state, rosterImport: "custom-alliance" },
      { ...state, rosterImport: "lwservers-rscl-927-2026-09-13-v1" },
      { ...state, alliance: { ...state.alliance, tag: "OTHER" } },
    ]) expect(applyProfileStats(candidate)).toBe(candidate);
    const target = state.members.find((m) => m.gameProfile?.uid === capture.members[0].uid)!;
    const duplicated = applyProfileStats({ ...state, members: [...state.members, { ...target, id: "duplicate" }] });
    expect(duplicated.members.find((m) => m.id === target.id)).toBe(target);
    const conflicting = { ...target, gameProfile: { ...target.gameProfile!, lastRankPublicId: "conflicting" } };
    const mismatched = applyProfileStats({ ...state, members: state.members.map((m) => m === target ? conflicting : m) });
    expect(mismatched.members.find((m) => m.id === target.id)).toBe(conflicting);
  });
});
