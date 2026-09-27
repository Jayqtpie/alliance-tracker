import { describe, expect, it } from "vitest";
import { allianceStatTotals, manualStatsInEffect, memberServers, memberStats, parseMemberStat, parseServerId, serverHuePalette, serverLabel } from "./member-stats";
import { importCapturedRoster } from "./roster-import";
import { createEmptyState } from "./alliance";
import { mergeMemberIdentities } from "./tracker";

describe("manual player statistics", () => {
  it("totals active members with corrections and tracks missing values separately from zero", () => {
    const state = importCapturedRoster({ ...createEmptyState(), rosterImport: undefined, alliance: { name: "The Rascals", tag: "RSCL", server: "927" } });
    const profileMember = { ...state.members.find((member) => member.gameProfile)!, active: true };
    // Made on the capture's day, so the correction outranks the captured values.
    const correctedOn = profileMember.gameProfile!.capturedOn;
    const totals = allianceStatTotals([
      { ...profileMember, manualStats: { heroPower: 2000000000, kills: null, profession: "Engineer", updatedAt: correctedOn } },
      { id: "manual", canonicalName: "Manual", aliases: [], active: true, manualStats: { heroPower: 500000000, kills: 0, profession: "War Leader", updatedAt: "2026-09-07" } },
      { id: "missing", canonicalName: "Missing", aliases: [], active: true },
      { ...profileMember, id: "departed", active: false, manualStats: { heroPower: 999, kills: 999, profession: "Engineer", updatedAt: "2026-09-07" } },
    ]);
    expect(totals).toEqual({ activeCount: 3, heroPower: { value: 2500000000, display: "2.5B", recorded: 2 }, kills: { value: 0, display: "0", recorded: 1 }, engineers: 1, warLeaders: 1 });
    expect(allianceStatTotals([profileMember]).heroPower.value).toBe(profileMember.gameProfile!.heroPower);
    expect(allianceStatTotals([])).toEqual({ activeCount: 0, heroPower: { value: null, display: "—", recorded: 0 }, kills: { value: null, display: "—", recorded: 0 }, engineers: 0, warLeaders: 0 });
  });

  it("reads full numbers, compact values, zero and unavailable values", () => {
    for (const [input, expected] of [["125,000,001", 125000001], [" 125.5m ", 125500000], ["1.2B", 1200000000], ["25K", 25000], ["0", 0], ["", null], ["—", null]] as const) {
      expect(parseMemberStat(input)).toBe(expected);
    }
    for (const input of ["-5", "1.5", "12,34", "unknown", "Infinity", "1e8", "9999999999999999999", "125M junk"]) expect(() => parseMemberStat(input)).toThrow();
  });

  it("reads three and four digit server numbers and rejects anything else", () => {
    for (const [input, expected] of [["927", 927], [" s856 ", 856], ["#1024", 1024], ["", null], ["—", null]] as const) {
      expect(parseServerId(input)).toBe(expected);
    }
    for (const input of ["92", "12345", "-927", "92.7", "9 2 7", "nine two seven", "927 extra"]) expect(() => parseServerId(input)).toThrow();
    expect(serverLabel(856)).toBe("S856");
    expect(serverLabel(null)).toBe("—");
  });

  it("spreads server hues as far apart as the palette allows", () => {
    // The real spread of origin servers in the 21 September RSCL roster.
    const servers = [830, 836, 841, 843, 844, 856, 862, 863, 866, 872, 891, 900, 905, 906, 907, 908, 912, 915, 918, 919, 921, 922, 923, 926, 931];
    const palette = serverHuePalette(servers);
    const separation = (a: number, b: number) => { const gap = Math.abs(palette.get(a)! - palette.get(b)!); return Math.min(gap, 360 - gap); };
    expect(new Set(palette.values()).size).toBe(servers.length);
    // Every pair sits at least a full even slot apart; a hash of the server number
    // put a third of the pairs inside 25 degrees and some inside 3.
    const slot = Math.floor(360 / servers.length);
    for (const [index, server] of servers.entries()) {
      for (const other of servers.slice(index + 1)) expect(separation(server, other)).toBeGreaterThanOrEqual(slot);
    }
    // Neighbours by number are the easiest to confuse, so they must be far apart.
    for (const [a, b] of [[862, 863], [856, 862], [843, 844], [918, 919]]) expect(separation(a, b)).toBeGreaterThan(90);
    expect(palette.get(927)).toBeUndefined();
    expect(serverHuePalette([856]).get(856)).toBe(0);
    expect(serverHuePalette([])).toEqual(new Map());
  });

  it("prefers an officer's server correction over the captured one and keeps departures separate", () => {
    const captured = { id: "a", canonicalName: "A", aliases: [], active: true, gameProfile: { originServer: 856 } } as unknown as Parameters<typeof memberServers>[0];
    expect(memberServers(captured)).toEqual({ origin: 856, transferredTo: null });
    expect(memberServers({ ...captured, originServer: 900 })).toEqual({ origin: 900, transferredTo: null });
    // A cleared override outranks the capture rather than falling back to it.
    expect(memberServers({ ...captured, originServer: null })).toEqual({ origin: null, transferredTo: null });
    expect(memberServers({ ...captured, transferredTo: 931 })).toEqual({ origin: 856, transferredTo: 931 });
    expect(memberServers({ id: "b", canonicalName: "B", aliases: [], active: false })).toEqual({ origin: null, transferredTo: null });
  });

  it("lets whichever is newer win, per statistic, between a correction and a capture", () => {
    const profile = { uid: "1", rank: "R3", avatarPath: "", heroPower: 200_000_000, heroPowerDisplay: "200M", heroPowerLegacy: false, kills: 31_000_000, killsDisplay: "31M", power: 290_000_000, powerDisplay: "290M", profession: "War Leader", capturedOn: "2026-09-27", heroPowerMeasuredAt: "2026-09-26", source: "test" };
    const member = { id: "m", canonicalName: "M", aliases: [], active: true, gameProfile: profile };
    const older = { heroPower: 199_000_000, kills: 30_000_000, power: 310_000_000, profession: "Engineer", updatedAt: "2026-09-20T03:16:24.752Z" };
    // An older correction yields to the capture, except profession, which not every source dates.
    expect(memberStats({ ...member, manualStats: older })).toMatchObject({ heroPower: 200_000_000, heroPowerDisplay: "200M", kills: 31_000_000, power: 290_000_000, powerDisplay: "290M", profession: "Engineer" });
    // Hero power is dated by its own measurement, so a correction made the day after it still stands.
    expect(memberStats({ ...member, manualStats: { heroPower: 199_000_000, kills: 30_000_000, updatedAt: "2026-09-26T20:00:00Z" } })).toMatchObject({ heroPower: 199_000_000, heroPowerDisplay: "199M", kills: 31_000_000 });
    // A later correction, including a cleared value, outranks the capture until a newer one arrives.
    expect(memberStats({ ...member, manualStats: { power: null, updatedAt: "2026-09-28T09:00:00Z" } })).toMatchObject({ power: null, powerDisplay: "—", heroPower: 200_000_000 });
    // A capture that did not measure a statistic never displaces a correction of it.
    expect(memberStats({ ...member, gameProfile: { ...profile, heroPower: null, heroPowerDisplay: "—" }, manualStats: older })).toMatchObject({ heroPower: 199_000_000, heroPowerDisplay: "199M" });
    expect(manualStatsInEffect({ ...member, manualStats: older })).toEqual({ profession: "Engineer" });
    expect(manualStatsInEffect(member)).toEqual({});
  });

  it("retains corrections through source refreshes and member merges", () => {
    const state = importCapturedRoster({ ...createEmptyState(), rosterImport: undefined, alliance: { name: "The Rascals", tag: "RSCL", server: "927" } });
    const player = state.members[0];
    player.manualStats = { heroPower: 123456789, kills: null, updatedAt: `${player.gameProfile!.capturedOn}T00:00:00Z` };
    state.rosterImport = undefined;
    const refreshed = importCapturedRoster(state);
    expect(refreshed.members[0].manualStats).toEqual(player.manualStats);
    expect(memberStats(refreshed.members[0])).toMatchObject({ heroPower: 123456789, heroPowerDisplay: "123.46M", kills: null, killsDisplay: "—" });
    expect(memberStats({ ...player, manualStats: undefined })).toMatchObject({ power: player.gameProfile!.power, powerDisplay: player.gameProfile!.powerDisplay, profession: player.gameProfile!.profession });
    expect(memberStats({ ...player, manualStats: { power: 450500000, profession: null, updatedAt: player.gameProfile!.capturedOn } })).toMatchObject({ power: 450500000, powerDisplay: "450.5M", profession: null, heroPower: player.gameProfile!.heroPower });
    refreshed.members.push({ id: "duplicate", canonicalName: "Duplicate", aliases: [], active: false, manualStats: { kills: 42, updatedAt: "2026-09-05T00:00:00Z" } });
    expect(mergeMemberIdentities(refreshed, player.id, "duplicate").members[0].manualStats).toEqual(player.manualStats);
  });
});
