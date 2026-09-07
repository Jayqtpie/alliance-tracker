import { describe, expect, it } from "vitest";
import { allianceStatTotals, memberStats, parseMemberStat } from "./member-stats";
import { importCapturedRoster } from "./roster-import";
import { createEmptyState } from "./alliance";
import { mergeMemberIdentities } from "./tracker";

describe("manual player statistics", () => {
  it("totals active members with corrections and tracks missing values separately from zero", () => {
    const state = importCapturedRoster({ ...createEmptyState(), rosterImport: undefined, alliance: { name: "The Rascals", tag: "RSCL", server: "927" } });
    const profileMember = { ...state.members.find((member) => member.gameProfile)!, active: true };
    const totals = allianceStatTotals([
      { ...profileMember, manualStats: { heroPower: 2000000000, kills: null, updatedAt: "2026-09-07" } },
      { id: "manual", canonicalName: "Manual", aliases: [], active: true, manualStats: { heroPower: 500000000, kills: 0, updatedAt: "2026-09-07" } },
      { id: "missing", canonicalName: "Missing", aliases: [], active: true },
      { ...profileMember, id: "departed", active: false, manualStats: { heroPower: 999, kills: 999, updatedAt: "2026-09-07" } },
    ]);
    expect(totals).toEqual({ activeCount: 3, heroPower: { value: 2500000000, display: "2.5B", recorded: 2 }, kills: { value: 0, display: "0", recorded: 1 } });
    expect(allianceStatTotals([profileMember]).heroPower.value).toBe(profileMember.gameProfile!.heroPower);
    expect(allianceStatTotals([])).toEqual({ activeCount: 0, heroPower: { value: null, display: "—", recorded: 0 }, kills: { value: null, display: "—", recorded: 0 } });
  });

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
