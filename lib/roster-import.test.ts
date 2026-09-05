import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { INITIAL_STATE } from "./seed";
import { importCapturedRoster, parseDisplayedPower } from "./roster-import";
import { mergeMemberIdentities } from "./tracker";

describe("captured RSCL roster", () => {
  it("imports 100 members and local avatars without treating missing stats as zero", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    const active = state.members.filter((member) => member.active);
    expect(active).toHaveLength(100);
    expect(new Set(active.map((member) => member.gameProfile?.uid)).size).toBe(100);
    expect(active.filter((member) => member.gameProfile?.heroPower !== null)).toHaveLength(90);
    expect(active.filter((member) => member.gameProfile?.kills !== null)).toHaveLength(60);
    expect(active.filter((member) => member.gameProfile?.heroPowerLegacy)).toHaveLength(8);
    for (const member of active) expect(existsSync(path.join(process.cwd(), "public", member.gameProfile!.avatarPath))).toBe(true);
    expect(active.find((member) => member.canonicalName === "Newsshooter")?.gameProfile?.heroPower).toBeNull();
    expect(parseDisplayedPower("168MLEGACY")).toBe(168_000_000);
    expect(parseDisplayedPower("—")).toBeNull();
  });

  it("preserves linked history, aliases, notes and operations and only applies once", () => {
    const before = structuredClone(INITIAL_STATE);
    const jay = before.members.find((member) => member.canonicalName === "JayQT")!;
    jay.notes = "Keep this officer note";
    jay.aliases = ["Previous Jay"];
    const after = importCapturedRoster(before);
    const importedJay = after.members.find((member) => member.gameProfile?.uid === "1666146601000931")!;
    expect(importedJay.id).toBe(jay.id);
    expect(importedJay.notes).toBe(jay.notes);
    expect(importedJay.aliases).toContain("Previous Jay");
    expect(importedJay.gameProfile?.heroPower).toBe(196_000_000);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.operations).toEqual(before.operations);
    expect(before.members.every((member) => after.members.some((entry) => entry.id === member.id))).toBe(true);
    importedJay.canonicalName = "A later officer edit";
    importedJay.active = false;
    expect(importCapturedRoster(after)).toBe(after);
    expect(importCapturedRoster(after).members.find((member) => member.id === jay.id)?.active).toBe(false);
  });

  it("does not attach a profile to ambiguous names or a different game UID", () => {
    const before = structuredClone(INITIAL_STATE);
    const jay = before.members.find((member) => member.canonicalName === "JayQT")!;
    before.members.push({ ...jay, id: "duplicate-jay" });
    const after = importCapturedRoster(before);
    expect(after.members.find((member) => member.gameProfile?.uid === "1666146601000931")?.id).toBe("lw-1666146601000931");
    expect(after.members.find((member) => member.id === jay.id)?.active).toBe(false);
    const otherAlliance = { ...before, alliance: { ...before.alliance, tag: "OTHER" } };
    expect(importCapturedRoster(otherAlliance)).toBe(otherAlliance);
  });

  it("retains an imported profile when an officer merges a historical identity", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    const imported = state.members.find((member) => member.gameProfile?.uid === "1644943893000856")!;
    const historical = state.members.find((member) => !member.active)!;
    const merged = mergeMemberIdentities(state, historical.id, imported.id);
    expect(merged.members.find((member) => member.id === historical.id)?.gameProfile).toEqual(imported.gameProfile);
  });
});
