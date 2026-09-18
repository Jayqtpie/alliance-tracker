import { describe, expect, it } from "vitest";
import { INITIAL_STATE } from "./seed";
import { importCapturedRoster } from "./roster-import";
import { applyPairingImport, PAIRING_IMPORT } from "./pairings-import";
import capture from "./data/rscl-pairings-2026-09-18.json";

// The sheet's UIDs are resolved against the 18 September roster capture.
const baseline = () => importCapturedRoster(structuredClone(INITIAL_STATE));

describe("captured RSCL pairing sheet", () => {
  it("applies to an RSCL/927 state with no pairings", () => {
    const state = baseline();
    const after = applyPairingImport(state);
    expect(after.pairingImport).toBe(PAIRING_IMPORT);
    expect(after.pairings).toBeDefined();
    expect(after.pairings!.length).toBeGreaterThan(0);
    const first = capture.rows[0];
    const warLeader = after.members.find((member) => member.gameProfile?.uid === first.warLeader!.uid)!;
    const engineer = after.members.find((member) => member.gameProfile?.uid === first.engineer!.uid)!;
    expect(after.pairings![0]).toEqual({ id: "pair-1", warLeaderId: warLeader.id, engineerId: engineer.id });
  });

  it("is idempotent", () => {
    const state = baseline();
    const first = applyPairingImport(state);
    const second = applyPairingImport(first);
    expect(second).toBe(first);
  });

  it("no-ops for a different alliance", () => {
    const state = { ...baseline(), alliance: { name: "Virtue", tag: "VRTU", server: "931" } };
    expect(applyPairingImport(state)).toBe(state);
  });

  it("does not clobber existing pairings but still sets the marker", () => {
    const state = baseline();
    const existing = [{ id: "pair-1", warLeaderId: state.members[0].id }];
    const withPairings = { ...state, pairings: existing };
    const after = applyPairingImport(withPairings);
    expect(after.pairings).toBe(existing);
    expect(after.pairingImport).toBe(PAIRING_IMPORT);
  });

  it("skips a slot whose uid is not in the roster, and one whose member is inactive", () => {
    const state = baseline();
    const first = capture.rows[0];
    const warLeader = state.members.find((member) => member.gameProfile?.uid === first.warLeader!.uid)!;
    warLeader.active = false;
    const engineer = state.members.find((member) => member.gameProfile?.uid === first.engineer!.uid)!;
    engineer.gameProfile = { ...engineer.gameProfile!, uid: "no-such-uid" };
    const after = applyPairingImport(state);
    expect(after.pairings![0]).toEqual({ id: "pair-1" });
  });

  it("retains a member whose profession does not match their column", () => {
    const state = baseline();
    const first = capture.rows[0];
    const warLeader = state.members.find((member) => member.gameProfile?.uid === first.warLeader!.uid)!;
    warLeader.gameProfile = { ...warLeader.gameProfile!, profession: "Engineer" };
    const after = applyPairingImport(state);
    expect(after.pairings![0].warLeaderId).toBe(warLeader.id);
  });
});
