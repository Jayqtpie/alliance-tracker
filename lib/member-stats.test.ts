import { describe, expect, it } from "vitest";
import { memberStats, parseMemberStat } from "./member-stats";
import { importCapturedRoster } from "./roster-import";
import { createEmptyState } from "./alliance";
import { mergeMemberIdentities } from "./tracker";

describe("manual player statistics", () => {
  it("reads full numbers, compact values, zero and unavailable values", () => {
    for (const [input, expected] of [["125,000,001", 125000001], [" 125.5m ", 125500000], ["1.2B", 1200000000], ["25K", 25000], ["0", 0], ["", null], ["—", null]] as const) {
      expect(parseMemberStat(input)).toBe(expected);
    }
    for (const input of ["-5", "1.5", "12,34", "unknown", "Infinity", "1e8", "9999999999999999999", "125M junk"]) expect(() => parseMemberStat(input)).toThrow();
  });

  it("retains corrections through source refreshes and member merges", () => {
    const state = importCapturedRoster({ ...createEmptyState(), rosterImport: undefined, alliance: { name: "The Rascals", tag: "RSCL", server: "927" } });
    const player = state.members[0];
    player.manualStats = { heroPower: 123456789, kills: null, updatedAt: "2026-09-06T00:00:00Z" };
    state.rosterImport = undefined;
    const refreshed = importCapturedRoster(state);
    expect(refreshed.members[0].manualStats).toEqual(player.manualStats);
    expect(memberStats(refreshed.members[0])).toMatchObject({ heroPower: 123456789, heroPowerDisplay: "123.46M", kills: null, killsDisplay: "—" });
    refreshed.members.push({ id: "duplicate", canonicalName: "Duplicate", aliases: [], active: false, manualStats: { kills: 42, updatedAt: "2026-09-05T00:00:00Z" } });
    expect(mergeMemberIdentities(refreshed, player.id, "duplicate").members[0].manualStats).toEqual(player.manualStats);
  });
});
