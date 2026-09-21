import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { INITIAL_STATE } from "./seed";
import { applyCapturedRoster, importCapturedRoster, parseDisplayedPower, ROSTER_IMPORT } from "./roster-import";
import capture from "./data/rscl-roster-2026-09-21.json";
import { mergeMemberIdentities } from "./tracker";

describe("captured RSCL roster", () => {
  it("refreshes an older capture by UID while preserving corrections, history and previous names", () => {
    const before = importCapturedRoster(structuredClone(INITIAL_STATE));
    before.rosterImport = "lwservers-rscl-927-2026-09-05-v1";
    const parrot = before.members.find((member) => member.gameProfile?.uid === "1601085524000862")!;
    parrot.id = "officer-retained-identity";
    parrot.canonicalName = "war parrot";
    parrot.aliases = ["An OCR alias"];
    parrot.previousNames = ["A verified earlier name"];
    parrot.notes = "Preserve this note";
    before.snapshots[0].entries[0] = { ...before.snapshots[0].entries[0], memberId: parrot.id, reviewed: true, needsReview: false };
    const after = importCapturedRoster(before);
    const refreshed = after.members.find((member) => member.id === parrot.id)!;
    expect(refreshed.canonicalName).toBe("dr parrot");
    expect(refreshed.aliases).toContain("war parrot");
    expect(refreshed.previousNames).toEqual(expect.arrayContaining(["war parrot", "A verified earlier name"]));
    expect(refreshed.previousNames).not.toContain("An OCR alias");
    expect(refreshed.notes).toBe(parrot.notes);
    expect(refreshed.gameProfile).toMatchObject({ capturedOn: "2026-09-21", lastRankPublicId: "1186935", refreshStatus: "fresh" });
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.operations).toEqual(before.operations);
    expect(after.members.map((member) => member.id).sort()).toEqual(before.members.map((member) => member.id).sort());
    expect(after.members.filter((member) => member.active)).toHaveLength(100);
    expect(after.rosterImport).toBe(ROSTER_IMPORT);
    expect(importCapturedRoster(after)).toBe(after);
  });
  it("does not downgrade a newer roster capture", () => {
    const state = { ...structuredClone(INITIAL_STATE), rosterImport: "lwservers-rscl-927-2026-09-22-v1" };
    expect(importCapturedRoster(state)).toBe(state);
  });
  it("imports 100 active members and local avatars without treating missing stats as zero", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    const active = state.members.filter((member) => member.active);
    expect(active).toHaveLength(100);
    expect(new Set(active.map((member) => member.gameProfile?.uid)).size).toBe(100);
    expect(active.filter((member) => member.gameProfile?.heroPower !== null)).toHaveLength(90);
    expect(active.filter((member) => member.gameProfile?.kills !== null)).toHaveLength(100);
    expect(active.filter((member) => member.gameProfile?.heroPowerLegacy)).toHaveLength(0);
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
    expect(importedJay.gameProfile?.heroPower).toBe(199_172_385);
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
    const historical = state.members.find((member) => !member.active && !member.gameProfile)!;
    const merged = mergeMemberIdentities(state, historical.id, imported.id);
    expect(merged.members.find((member) => member.id === historical.id)?.gameProfile).toEqual(imported.gameProfile);
  });
  it.each([
    "lastrank-rscl-927-2026-09-22-v1",
    "lwservers-rscl-927-2026-09-21-v10",
    "lastrank-rscl-927-2026-09-21-v2",
    "lastrank-rscl-927-2026-09-21-v1",
  ])("retains an equal or newer capture across sources: %s", (rosterImport) => {
    const state = { ...structuredClone(INITIAL_STATE), rosterImport };
    expect(importCapturedRoster(state)).toBe(state);
  });

  // A row is "retained" for two reasons: the profile was too stale to refresh, or the player was
  // absent from the source alliance list. The importer sees only freshness.status, so both take the
  // same path. A real capture may contain neither, so the retained row is built here instead.
  it.each([
    ["a source profile cannot refresh", "stale-profile"],
    ["the player is absent from the source alliance list", "not-in-source-alliance-list"],
  ])("preserves live stats, dates and active status when %s", (_reason, refreshResult) => {
    const source = structuredClone(capture);
    const row = source.members.find((entry) => entry.lastRankPublicId === "1187353")!;
    row.freshness.status = "retained";
    row.freshness.refreshResult = refreshResult;
    row.active = true;

    const before = importCapturedRoster(structuredClone(INITIAL_STATE));
    before.rosterImport = "lwservers-rscl-927-2026-09-10-v1";
    const member = before.members.find((entry) => entry.gameProfile?.lastRankPublicId === "1187353")!;
    member.gameProfile = { ...member.gameProfile!, heroPower: 0, heroPowerDisplay: "0", kills: 42, killsDisplay: "42", capturedOn: "2026-09-12", sourceActivityDate: "2026-09-11" };
    member.manualStats = { kills: 77, updatedAt: "2026-09-13" };
    before.snapshots[0].entries[0].memberId = member.id;
    const expected = structuredClone(member);

    const after = applyCapturedRoster(before, source, "lwservers-rscl-927-2026-09-21-v2");
    const retained = after.members.find((entry) => entry.id === member.id)!;
    expect(retained.active).toBe(true);
    expect(retained.canonicalName).toBe(expected.canonicalName);
    // Every live value survives byte-for-byte; only the refresh marker moves.
    expect(retained.gameProfile).toEqual({ ...expected.gameProfile, refreshStatus: "retained" });
    expect(retained.manualStats).toEqual(expected.manualStats);
    expect(retained.gameProfile?.capturedOn).toBe("2026-09-12");
    expect(after.snapshots).toBe(before.snapshots);
    expect(after.operations).toBe(before.operations);
    expect(new Set(after.members.filter((entry) => entry.gameProfile?.lastRankPublicId).map((entry) => entry.gameProfile!.lastRankPublicId)).size).toBe(100);
  });

  it("stops on duplicate game UIDs or conflicting verified LastRank mappings", () => {
    const before = importCapturedRoster(structuredClone(INITIAL_STATE));
    before.rosterImport = "lwservers-rscl-927-2026-09-10-v1";
    const duplicate = { ...before, members: [...before.members, { ...before.members[0], id: "duplicate-uid" }] };
    expect(importCapturedRoster(duplicate)).toBe(duplicate);
    const conflicting = structuredClone(before);
    conflicting.members[1].gameProfile!.lastRankPublicId = conflicting.members[0].gameProfile!.lastRankPublicId;
    expect(importCapturedRoster(conflicting)).toBe(conflicting);
  });

});
