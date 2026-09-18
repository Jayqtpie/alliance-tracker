import { describe, expect, it } from "vitest";
import { defaultPairings, movePairing, nextRowId, resolvePairings } from "./pairings";
import type { Member } from "./types";

const member = (id: string, profession: string | null, power: number | null, overrides: Partial<Member> = {}): Member => ({
  id, canonicalName: id, aliases: [], active: true,
  manualStats: { power, profession, updatedAt: "2026-09-18" },
  ...overrides,
});

describe("pairings", () => {
  it("zips war leaders and engineers by power descending, half-empty when counts differ", () => {
    const members = [
      member("wl1", "War Leader", 100),
      member("wl2", "War Leader", 300),
      member("eng1", "Engineer", 200),
    ];
    expect(defaultPairings(members)).toEqual([
      { id: "pair-1", warLeaderId: "wl2", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl1", engineerId: undefined },
    ]);
  });

  it("resolvePairings clears a slot when the member was deleted, went inactive, or changed profession", () => {
    const wl = member("wl1", "War Leader", 100);
    const rows = [{ id: "pair-1", warLeaderId: "wl1" }];

    expect(resolvePairings([], rows).rows).toEqual([]); // wl1 deleted entirely, row trimmed once empty
    expect(resolvePairings([{ ...wl, active: false }], rows).rows).toEqual([]);
    expect(resolvePairings([{ ...wl, manualStats: { ...wl.manualStats!, profession: "Engineer" } }], rows).rows).toEqual([]);
  });

  it("resolvePairings puts un-slotted active members into the right pool sorted by power desc, and counts withoutProfession", () => {
    const members = [
      member("wl1", "War Leader", 100),
      member("wl2", "War Leader", 300),
      member("eng1", "Engineer", 200),
      member("none1", null, 50),
    ];
    const result = resolvePairings(members, []);
    expect(result.unpairedWarLeaders.map((m) => m.id)).toEqual(["wl2", "wl1"]);
    expect(result.unpairedEngineers.map((m) => m.id)).toEqual(["eng1"]);
    expect(result.withoutProfession).toBe(1);
  });

  it("resolvePairings trims trailing empty rows but preserves a gap in the middle", () => {
    const members = [member("wl1", "War Leader", 100), member("eng2", "Engineer", 200)];
    const rows = [
      { id: "pair-1", warLeaderId: "wl1" },
      { id: "pair-2" },
      { id: "pair-3", engineerId: "eng2" },
      { id: "pair-4" },
    ];
    expect(resolvePairings(members, rows).rows).toEqual([
      { id: "pair-1", warLeaderId: "wl1" },
      { id: "pair-2" },
      { id: "pair-3", engineerId: "eng2" },
    ]);
  });

  it("nextRowId returns one past the highest pair-N id, or pair-1 for an empty list", () => {
    expect(nextRowId([])).toBe("pair-1");
    expect(nextRowId([{ id: "pair-3" }, { id: "pair-1" }])).toBe("pair-4");
  });

  it("movePairing onto an empty slot moves the member and clears only the origin slot", () => {
    const rows = [
      { id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" },
      { id: "pair-2", engineerId: "eng2" },
    ];
    const result = movePairing(rows, { memberId: "wl1", column: "warLeader", target: { kind: "row", rowId: "pair-2" } });
    expect(result).toEqual([
      { id: "pair-1", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl1", engineerId: "eng2" },
    ]);
  });

  it("movePairing onto an occupied slot swaps exactly the two members", () => {
    const rows = [
      { id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl2", engineerId: "eng2" },
    ];
    const result = movePairing(rows, { memberId: "wl1", column: "warLeader", target: { kind: "row", rowId: "pair-2" } });
    expect(result).toEqual([
      { id: "pair-1", warLeaderId: "wl2", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl1", engineerId: "eng2" },
    ]);
  });

  it("movePairing from the unpaired pool onto an occupied slot sends the displaced member to neither column", () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }];
    const result = movePairing(rows, { memberId: "wl2", column: "warLeader", target: { kind: "row", rowId: "pair-1" } });
    expect(result).toEqual([{ id: "pair-1", warLeaderId: "wl2", engineerId: "eng1" }]);
    expect(result.every((row) => row.warLeaderId !== "wl1")).toBe(true);
  });

  it("movePairing to the unpaired pool removes the member from their row", () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }];
    const result = movePairing(rows, { memberId: "wl1", column: "warLeader", target: { kind: "unpaired" } });
    expect(result).toEqual([{ id: "pair-1", engineerId: "eng1" }]);
  });

  it("movePairing with an unknown rowId appends a new row", () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1" }];
    const result = movePairing(rows, { memberId: "eng1", column: "engineer", target: { kind: "row", rowId: "pair-9" } });
    expect(result).toEqual([{ id: "pair-1", warLeaderId: "wl1" }, { id: "pair-9", engineerId: "eng1" }]);
  });

  it("movePairing does not mutate its input array", () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    movePairing(rows, { memberId: "wl1", column: "warLeader", target: { kind: "unpaired" } });
    expect(rows).toEqual(snapshot);
  });
});
