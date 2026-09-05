import { describe, expect, it } from "vitest";
import { allianceFilePrefix, allianceNeedsSetup, allianceSchema, createEmptyState } from "./alliance";
import { importCapturedRoster } from "./roster-import";
import { matchMember } from "./tracker";

describe("new alliance installations", () => {
  it("starts empty and never imports the legacy roster, even for the same tag and server", () => {
    const state = createEmptyState();
    expect(allianceNeedsSetup(state.alliance)).toBe(true);
    expect(state.members).toEqual([]);
    expect(state.snapshots).toEqual([]);
    expect(state.uploads).toEqual([]);
    state.alliance = { name: "The Rascals", tag: "RSCL", server: "927" };
    expect(allianceNeedsSetup(state.alliance)).toBe(false);
    expect(importCapturedRoster(state)).toBe(state);
    expect(state.members).toEqual([]);
  });

  it("validates identity and server numbers for branding and exports", () => {
    expect(allianceSchema.parse({ name: " Phoenix Guard ", tag: " PHNX ", server: " 1234 " })).toEqual({ name: "Phoenix Guard", tag: "PHNX", server: "1234" });
    for (const server of ["0", "-1", "1.2", "abc", "1234567", ""]) {
      expect(allianceSchema.safeParse({ name: "Phoenix Guard", tag: "PHNX", server }).success).toBe(false);
    }
    expect(allianceSchema.safeParse({ name: " ", tag: "PHNX", server: "1234" }).success).toBe(false);
    expect(allianceFilePrefix({ name: "Phoenix Guard", tag: "PHNX", server: "1234" })).toBe("phnx-1234");
  });

  it("matches a commander with another alliance tag in a capture", () => {
    const member = { id: "commander-1", canonicalName: "Phoenix One", aliases: [], active: true };
    expect(matchMember("[PHNX] Phoenix One", [member])?.id).toBe(member.id);
  });
});
