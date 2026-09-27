import { describe, expect, it } from "vitest";
import { createEmptyState } from "./alliance";
import { ALIAS_CORRECTION, applyAliasCorrections } from "./alias-corrections";
import type { Member, TrackerState } from "./types";

const profile = (uid: string) => ({ uid, rank: "R3", avatarPath: "", heroPower: 1, heroPowerDisplay: "1", heroPowerLegacy: false, kills: 1, killsDisplay: "1", capturedOn: "2026-09-27", source: "test" });
const aka: Member = { id: "aka", canonicalName: "Baby Bee aka FAFO", aliases: ["Baby Bee ie FAFO", "Baby Bee"], active: true, gameProfile: profile("1136632270000866") };
const ie: Member = { id: "ie", canonicalName: "Baby Bee ie FAFO", aliases: ["ABU BADDA"], active: true, gameProfile: profile("1426415525000863") };

function rscl(members: Member[]): TrackerState {
  return { ...createEmptyState(), alliance: { name: "The Rascals", tag: "RSCL", server: "927" }, members };
}

describe("alias corrections", () => {
  it("removes the other player's name from Baby Bee aka FAFO once, leaving that player alone", () => {
    const after = applyAliasCorrections(rscl([structuredClone(aka), structuredClone(ie)]));
    expect(after.members.find((member) => member.id === "aka")?.aliases).toEqual(["Baby Bee"]);
    expect(after.members.find((member) => member.id === "ie")).toEqual(ie);
    expect(after.memberProfileUpdates).toContain(ALIAS_CORRECTION);
    // Applied once: a later deliberate re-link is not undone on the next load.
    const relinked = { ...after, members: after.members.map((member) => member.id === "aka" ? { ...member, aliases: [...member.aliases, "Baby Bee ie FAFO"] } : member) };
    expect(applyAliasCorrections(relinked)).toBe(relinked);
  });

  it("changes nothing for another alliance or a duplicated game UID", () => {
    const other = { ...rscl([structuredClone(aka)]), alliance: { name: "Other", tag: "VRTU", server: "931" } };
    expect(applyAliasCorrections(other)).toBe(other);
    const duplicated = rscl([structuredClone(aka), { ...structuredClone(aka), id: "copy" }]);
    expect(applyAliasCorrections(duplicated)).toBe(duplicated);
    // Nothing to remove: no marker and no rewrite.
    const clean = rscl([{ ...structuredClone(aka), aliases: ["Baby Bee"] }, structuredClone(ie)]);
    expect(applyAliasCorrections(clean)).toBe(clean);
  });
});
