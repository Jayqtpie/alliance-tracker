import { describe, expect, it } from "vitest";
import {
  canLead, defaultRallyBoard, emptyRallyBoard, mergeRallyMember, moveRallyMember, rallyBoardCsv, rallyBoardText, removeRallyMember, resolveRallyBoard,
  setSquadCount, setUnavailable, squadGap, squadTotal, suggestRallyBoard, suggestedSquadCount, togglePin,
} from "./rally-squads";
import type { Member, RallyBoard } from "./types";

const WL = "War Leader", ENG = "Engineer";
const member = (id: string, profession: string | null, heroPowerM: number, overrides: Partial<Member> = {}): Member => ({
  id, canonicalName: id, aliases: [], active: true,
  manualStats: { heroPower: heroPowerM * 1e6, profession, updatedAt: "2026-10-28" },
  ...overrides,
});

// Two squads' worth: four War Leaders and six Engineers.
const roster = [
  member("wl400", WL, 400), member("wl300", WL, 300), member("wl200", WL, 200), member("wl150", WL, 150),
  member("e290", ENG, 290), member("e280", ENG, 280), member("e250", ENG, 250), member("e220", ENG, 220), member("e180", ENG, 180), member("e160", ENG, 160),
];
const byId = (members: Member[]) => new Map(members.map((m) => [m.id, m]));
const board = (squads: (string | null)[][], extra: Partial<RallyBoard> = {}): RallyBoard => ({
  mode: "balanced", squads: squads.map((slots, index) => ({ id: `squad-${index + 1}`, slots })), pinned: [], unavailable: [], ...extra,
});

describe("rally squad count", () => {
  it("suggests one squad per five available members, capped by the War Leaders who can lead them", () => {
    expect(suggestedSquadCount(roster)).toBe(2);
    expect(suggestedSquadCount(roster, ["e160"])).toBe(1);
    const engineers = Array.from({ length: 20 }, (_, index) => member(`e${index}`, ENG, 100));
    expect(suggestedSquadCount([member("wl", WL, 300), ...engineers])).toBe(1);
    expect(suggestedSquadCount([])).toBe(1);
  });

  it("adds empty squads and, when shrinking, benches the removed squads' members and drops their pins", () => {
    const start = board([["wl400", "e290", null, null, null], ["wl300", "e280", null, null, null]], { pinned: ["e280", "e290"] });
    const grown = setSquadCount(start, 3);
    expect(grown.squads.map((squad) => squad.id)).toEqual(["squad-1", "squad-2", "squad-3"]);
    expect(grown.squads[2].slots).toEqual([null, null, null, null, null]);
    const shrunk = setSquadCount(start, 1);
    expect(shrunk.squads).toHaveLength(1);
    expect(shrunk.pinned).toEqual(["e290"]);
  });
});

describe("suggestRallyBoard", () => {
  it("only War Leaders lead, strongest in squad 1; joiners are anyone, including spare War Leaders", () => {
    const suggested = suggestRallyBoard(roster, emptyRallyBoard(2));
    expect(suggested.squads.map((squad) => squad.slots[0])).toEqual(["wl400", "wl300"]);
    const joiners = suggested.squads.flatMap((squad) => squad.slots.slice(1));
    expect(joiners).toContain("wl200");
    expect(joiners.filter(Boolean)).toHaveLength(8);
  });

  it("leaves the weakest on the bench when there are more members than slots", () => {
    const suggested = suggestRallyBoard(roster, emptyRallyBoard(1));
    expect(suggested.squads[0].slots).toEqual(["wl400", "wl300", "e290", "e280", "e250"]);
  });

  it("tiered gives squad 1 the strongest joiners", () => {
    const suggested = suggestRallyBoard(roster, emptyRallyBoard(2, "tiered"));
    expect(suggested.squads[0].slots).toEqual(["wl400", "e290", "e280", "e250", "e220"]);
    expect(suggested.squads[1].slots).toEqual(["wl300", "wl200", "e180", "e160", "wl150"]);
  });

  it("balanced gives the weaker leader stronger joiners and brings the totals close", () => {
    const suggested = suggestRallyBoard(roster, emptyRallyBoard(2));
    const members = byId(roster);
    const [first, second] = suggested.squads.map((squad) => squadTotal(squad, members));
    // 2,430M across two squads. Every figure is a multiple of 10M, so the closest split is 1,220M / 1,210M.
    expect(first + second).toBe(2_430e6);
    expect(Math.abs(first - second)).toBeLessThanOrEqual(10e6);
    expect(squadGap(suggested, members)).toBe(Math.abs(first - second));
  });

  it("leaves pinned members in place and skips unavailable ones", () => {
    const start = board([[null, null, null, null, "e160"], [null, null, null, null, null]], { pinned: ["e160"], unavailable: ["e290"] });
    const suggested = suggestRallyBoard(roster, start);
    expect(suggested.squads[0].slots[4]).toBe("e160");
    expect(suggested.squads.flatMap((squad) => squad.slots)).not.toContain("e290");
    expect(suggested.pinned).toEqual(["e160"]);
    expect(suggested.unavailable).toEqual(["e290"]);
  });

  it("does not keep a pinned leader who is no longer a War Leader", () => {
    const changed = roster.map((m) => m.id === "wl400" ? member("wl400", ENG, 400) : m);
    const suggested = suggestRallyBoard(changed, board([["wl400", null, null, null, null]], { pinned: ["wl400"] }));
    expect(suggested.squads[0].slots[0]).toBe("wl300");
    expect(suggested.squads[0].slots).toContain("wl400");
  });

  it("leaves a leader slot empty when no War Leader is left", () => {
    const suggested = suggestRallyBoard([member("wl", WL, 300), member("e1", ENG, 200)], emptyRallyBoard(2));
    expect(suggested.squads[1].slots[0]).toBeNull();
  });

  it("defaultRallyBoard uses the suggested count", () => {
    expect(defaultRallyBoard(roster).squads).toHaveLength(2);
  });
});

describe("resolveRallyBoard", () => {
  it("drops members who left or are duplicated, and lists the bench and the unavailable strongest first", () => {
    const members = [...roster, member("gone", ENG, 500, { active: false })];
    const resolved = resolveRallyBoard(members, board([["wl400", "gone", "e290", "e290", null]], { pinned: ["gone", "e290"], unavailable: ["e180", "wl400"] }));
    expect(resolved.board.squads[0].slots).toEqual(["wl400", null, "e290", null, null]);
    expect(resolved.board.pinned).toEqual(["e290"]);
    expect(resolved.board.unavailable).toEqual(["e180"]); // placed beats unavailable
    expect(resolved.bench[0].id).toBe("wl300");
    expect(resolved.bench.map((m) => m.id)).not.toContain("e180");
    expect(resolved.unavailable.map((m) => m.id)).toEqual(["e180"]);
  });
});

describe("moveRallyMember", () => {
  const start = board([["wl400", "e290", null, null, null], ["wl300", "e280", null, null, null]], { pinned: ["e280"] });

  it("refuses a non-War Leader in a leader slot", () => {
    expect(moveRallyMember(start, roster, "e290", { kind: "slot", squadId: "squad-2", slot: 0 })).toBe(start);
    expect(canLead(roster[0])).toBe(true);
  });

  it("swaps two placed members", () => {
    const moved = moveRallyMember(start, roster, "e290", { kind: "slot", squadId: "squad-2", slot: 1 });
    expect(moved.squads[0].slots[1]).toBe("e280");
    expect(moved.squads[1].slots[1]).toBe("e290");
    expect(moved.pinned).toEqual(["e280"]);
  });

  it("benches the displaced member when they cannot take the mover's leader slot", () => {
    const moved = moveRallyMember(start, roster, "wl400", { kind: "slot", squadId: "squad-2", slot: 1 });
    expect(moved.squads[0].slots[0]).toBeNull();
    expect(moved.squads[1].slots[1]).toBe("wl400");
    expect(moved.squads.flatMap((squad) => squad.slots)).not.toContain("e280");
    expect(moved.pinned).toEqual([]);
  });

  it("benches whoever a bench member displaces, and swaps two leaders", () => {
    const fromBench = moveRallyMember(start, roster, "e250", { kind: "slot", squadId: "squad-1", slot: 1 });
    expect(fromBench.squads[0].slots[1]).toBe("e250");
    expect(fromBench.squads.flatMap((squad) => squad.slots)).not.toContain("e290");
    const leaders = moveRallyMember(start, roster, "wl400", { kind: "slot", squadId: "squad-2", slot: 0 });
    expect(leaders.squads.map((squad) => squad.slots[0])).toEqual(["wl300", "wl400"]);
  });

  it("moves to the bench and unpins", () => {
    const moved = moveRallyMember(start, roster, "e280", { kind: "bench" });
    expect(moved.squads[1].slots).toEqual(["wl300", null, null, null, null]);
    expect(moved.pinned).toEqual([]);
  });

  it("placing an unavailable member makes them available", () => {
    const away = { ...start, unavailable: ["e250"] };
    expect(moveRallyMember(away, roster, "e250", { kind: "slot", squadId: "squad-1", slot: 2 }).unavailable).toEqual([]);
  });
});

describe("pins, availability, text and roster changes", () => {
  const start = board([["wl400", "e290", null, null, null]]);

  it("pins only placed members and toggles off", () => {
    expect(togglePin(start, "e290").pinned).toEqual(["e290"]);
    expect(togglePin(togglePin(start, "e290"), "e290").pinned).toEqual([]);
    expect(togglePin(start, "e250")).toBe(start);
  });

  it("marking someone unavailable takes them out of their squad", () => {
    const away = setUnavailable({ ...start, pinned: ["e290"] }, "e290", true);
    expect(away.squads[0].slots[1]).toBeNull();
    expect(away.pinned).toEqual([]);
    expect(setUnavailable(away, "e290", false).unavailable).toEqual([]);
  });

  it("writes each squad as plain text", () => {
    expect(rallyBoardText(start, byId(roster))).toBe("Squad 1 · 690M\nLeader: wl400 (400M)\nJoiners: e290 (290M)");
    expect(rallyBoardText(board([[null, null, null, null, null]]), byId(roster))).toBe("Squad 1 · 0\nLeader: —\nJoiners: —");
  });

  it("exports one CSV row per filled slot with raw hero power and the squad total", () => {
    const withName = [...roster, member("=SUM(A1)", ENG, 100)];
    const csv = rallyBoardCsv(board([["wl400", null, "=SUM(A1)", null, null]]), byId(withName)).split("\r\n");
    expect(csv).toEqual([
      '"Squad","Role","Name","Profession","Hero power","Squad total"',
      '1,"Leader","wl400","War Leader",400000000,500000000',
      `1,"Joiner","'=SUM(A1)","Engineer",100000000,500000000`,
    ]);
  });

  it("a merge moves the duplicate's slot to the kept identity unless it already has one; a removal clears it", () => {
    expect(mergeRallyMember(start, "e290", "e250").squads[0].slots[1]).toBe("e250");
    expect(mergeRallyMember(start, "e290", "wl400").squads[0].slots).toEqual(["wl400", null, null, null, null]);
    expect(removeRallyMember({ ...start, pinned: ["e290"] }, "e290")).toEqual({ ...start, squads: [{ id: "squad-1", slots: ["wl400", null, null, null, null] }] });
  });
});
