import { describe, expect, it } from "vitest";
import { defaultPairings, movePairing, nextRowId, resolvePairings, slotMismatch } from "./pairings";
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

  it("resolvePairings clears a slot when the member was deleted or went inactive, but keeps a profession change", () => {
    const wl = member("wl1", "War Leader", 100);
    const rows = [{ id: "pair-1", warLeaderId: "wl1" }];

    expect(resolvePairings([], rows).rows).toEqual([]); // wl1 deleted entirely, row trimmed once empty
    expect(resolvePairings([{ ...wl, active: false }], rows).rows).toEqual([]);
    expect(resolvePairings([{ ...wl, manualStats: { ...wl.manualStats!, profession: "Engineer" } }], rows).rows).toEqual([
      { id: "pair-1", warLeaderId: "wl1" },
    ]);
  });

  it("resolvePairings retains a member slotted against a mismatched profession, and puts them in neither pool", () => {
    const members = [member("wl1", "War Leader", 100), member("eng1", "Engineer", 200)];
    const rows = [{ id: "pair-1", warLeaderId: "eng1" }]; // Engineer deliberately slotted as War Leader
    const result = resolvePairings(members, rows);
    expect(result.rows).toEqual([{ id: "pair-1", warLeaderId: "eng1" }]);
    expect(result.unpairedWarLeaders.map((m) => m.id)).toEqual(["wl1"]); // real war leader still pooled
    expect(result.unpairedEngineers).toEqual([]); // eng1 is slotted, so absent from its own pool
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

  it("withoutProfession excludes a slotted no-profession member but counts an un-slotted one", () => {
    const members = [member("wl1", "War Leader", 100), member("none1", null, 50), member("none2", null, 40)];
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "none1" }]; // no-profession member deliberately slotted
    const result = resolvePairings(members, rows);
    expect(result.withoutProfession).toBe(1); // only none2, not the slotted none1
  });

  it("slotMismatch returns null on a match, the profession on a mismatch, and \"no profession\" for null", () => {
    expect(slotMismatch(member("wl1", "War Leader", 100), "warLeader")).toBeNull();
    expect(slotMismatch(member("eng1", "Engineer", 200), "warLeader")).toBe("Engineer");
    expect(slotMismatch(member("none1", null, 50), "engineer")).toBe("no profession");
  });

  it("resolvePairings drops every empty row so the rows below move up", () => {
    const members = [member("wl1", "War Leader", 100), member("eng2", "Engineer", 200)];
    const rows = [
      { id: "pair-1", warLeaderId: "wl1" },
      { id: "pair-2" },
      { id: "pair-3", engineerId: "eng2" },
      { id: "pair-4" },
    ];
    expect(resolvePairings(members, rows).rows).toEqual([
      { id: "pair-1", warLeaderId: "wl1" },
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

  it("movePairing cross-column onto an empty slot moves the member into the new column and clears the old one", () => {
    const rows = [
      { id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl2" },
    ];
    const result = movePairing(rows, { memberId: "wl1", column: "engineer", target: { kind: "row", rowId: "pair-2" } });
    expect(result).toEqual([
      { id: "pair-1", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl2", engineerId: "wl1" },
    ]);
    expect(result.every((row) => row.warLeaderId !== "wl1")).toBe(true);
  });

  it("movePairing cross-column onto an occupied slot pools the displaced member instead of swapping", () => {
    const rows = [
      { id: "pair-1", warLeaderId: "wl1" },
      { id: "pair-2", engineerId: "eng2" },
    ];
    const result = movePairing(rows, { memberId: "wl1", column: "engineer", target: { kind: "row", rowId: "pair-2" } });
    expect(result).toEqual([
      { id: "pair-2", engineerId: "wl1" },
    ]);
    expect(result.every((row) => row.warLeaderId !== "wl1" && row.engineerId !== "eng2")).toBe(true); // eng2 landed in neither slot (pool)
  });

  it("movePairing self-move (same row, same column) is a clean no-op", () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }];
    const result = movePairing(rows, { memberId: "wl1", column: "warLeader", target: { kind: "row", rowId: "pair-1" } });
    expect(result).toEqual(rows);
  });

  it("movePairing to the unpaired pool removes the member from their row", () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }];
    const result = movePairing(rows, { memberId: "wl1", column: "warLeader", target: { kind: "unpaired" } });
    expect(result).toEqual([{ id: "pair-1", engineerId: "eng1" }]);
  });

  it("movePairing drops a middle row once both of its members are moved out, keeping half-filled rows", () => {
    const rows = [
      { id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" },
      { id: "pair-2", warLeaderId: "wl2", engineerId: "eng2" },
      { id: "pair-3", warLeaderId: "wl3", engineerId: "eng3" },
    ];
    const halfEmpty = movePairing(rows, { memberId: "wl2", column: "warLeader", target: { kind: "unpaired" } });
    expect(halfEmpty.map((row) => row.id)).toEqual(["pair-1", "pair-2", "pair-3"]);
    const result = movePairing(halfEmpty, { memberId: "eng2", column: "engineer", target: { kind: "unpaired" } });
    expect(result).toEqual([
      { id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" },
      { id: "pair-3", warLeaderId: "wl3", engineerId: "eng3" },
    ]);
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
