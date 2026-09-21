import { describe, expect, it } from "vitest";
import { INITIAL_STATE } from "./seed";
import { importCapturedRoster } from "./roster-import";
import { applyOriginServers, ORIGIN_SERVER_UPDATE } from "./origin-servers";
import capture from "./data/rscl-roster-2026-09-21.json";

// Simulate a tracker that applied the 21 September capture before origin servers were stored.
const baseline = () => {
  const state = importCapturedRoster(structuredClone(INITIAL_STATE));
  state.memberProfileUpdates = state.memberProfileUpdates?.filter((id) => id !== ORIGIN_SERVER_UPDATE);
  for (const member of state.members) {
    if (member.gameProfile) delete member.gameProfile.originServer;
  }
  return state;
};

describe("LastRank origin servers", () => {
  it("imports the starting server with the captured roster", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    const row = capture.members.find((row) => row.name === "Zothargirl")!;
    expect(row.originServerId).toBe(843);
    expect(state.members.find((member) => member.gameProfile?.uid === row.uid)?.gameProfile?.originServer).toBe(843);
  });

  it("backfills every mapped profile once, including retained ones, and leaves the rest of the record alone", () => {
    const before = baseline();
    const target = before.members.find((member) => member.gameProfile?.uid === capture.members[0].uid)!;
    target.canonicalName = "Officer rename";
    target.manualStats = { heroPower: 1, updatedAt: "2026-09-15" };
    target.active = false;
    const after = applyOriginServers(before);
    expect(after.memberProfileUpdates).toContain(ORIGIN_SERVER_UPDATE);
    expect(after.members).toHaveLength(before.members.length);
    for (const member of before.members) {
      const next = after.members.find((item) => item.id === member.id)!;
      const row = capture.members.find((row) => row.uid === member.gameProfile?.uid);
      if (!row) { expect(next).toBe(member); continue; }
      expect(next.gameProfile).toEqual({ ...member.gameProfile, originServer: row.originServerId });
      expect(next.canonicalName).toBe(member.canonicalName);
      expect(next.active).toBe(member.active);
      expect(next.manualStats).toBe(member.manualStats);
    }
    // A retained profile is stale for statistics, but a starting server cannot go
    // stale, so freshness is not consulted and every mapped row is written.
    expect(after.members.filter((member) => typeof member.gameProfile?.originServer === "number")).toHaveLength(capture.members.length);
    expect(applyOriginServers(after)).toBe(after);
  });

  it("never overwrites an officer correction already stored on the profile", () => {
    const state = baseline();
    const target = state.members.find((member) => member.gameProfile?.uid === capture.members[0].uid)!;
    target.gameProfile!.originServer = null;
    expect(applyOriginServers(state).members.find((member) => member.id === target.id)).toBe(target);
  });

  it("holds other alliances and roster versions, and skips conflicting mappings", () => {
    const state = baseline();
    for (const candidate of [
      { ...state, rosterImport: "custom-alliance" },
      { ...state, rosterImport: "lwservers-rscl-927-2026-09-13-v1" },
      { ...state, alliance: { ...state.alliance, tag: "OTHER" } },
      { ...state, alliance: { ...state.alliance, server: "931" } },
    ]) expect(applyOriginServers(candidate)).toBe(candidate);
    const target = state.members.find((member) => member.gameProfile?.uid === capture.members[0].uid)!;
    const duplicated = applyOriginServers({ ...state, members: [...state.members, { ...target, id: "duplicate" }] });
    expect(duplicated.members.find((member) => member.id === target.id)).toBe(target);
    const conflicting = { ...target, gameProfile: { ...target.gameProfile!, lastRankPublicId: "conflicting" } };
    const mismatched = applyOriginServers({ ...state, members: state.members.map((member) => member === target ? conflicting : member) });
    expect(mismatched.members.find((member) => member.id === target.id)).toBe(conflicting);
  });
});
