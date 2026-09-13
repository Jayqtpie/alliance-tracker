import { describe, expect, it } from "vitest";
import { INITIAL_STATE } from "./seed";
import { importCapturedRoster } from "./roster-import";
import { applyMemberProfileUpdates } from "./member-profile-updates";
import update from "./data/rscl-profile-updates-2026-09-10.json";

describe("targeted LastRank identity updates", () => {
  it("retains merged identities, manual stats and history and applies only once", () => {
    const before = importCapturedRoster(structuredClone(INITIAL_STATE));
    before.memberProfileUpdates = undefined;
    for (const row of update.members) {
      const member = before.members.find((member) => member.gameProfile?.uid === row.uid)!;
      member.id = `merged-${row.uid}`;
      member.canonicalName = row.previousName;
      member.notes = "Officer correction";
      member.manualStats = { kills: 123, updatedAt: "2026-09-10" };
      member.previousNames = ["Earlier name"];
    }
    const after = applyMemberProfileUpdates(before);
    expect(after.snapshots).toBe(before.snapshots);
    expect(after.operations).toBe(before.operations);
    expect(after.members).toHaveLength(before.members.length);
    for (const member of before.members) {
      const row = update.members.find((row) => row.uid === member.gameProfile?.uid);
      const changed = after.members.find((candidate) => candidate.id === member.id)!;
      if (!row) { expect(changed).toBe(member); continue; }
      expect(changed).toEqual({ ...member, canonicalName: row.name,
        aliases: [...new Set([...member.aliases, member.canonicalName, row.previousName])],
        previousNames: [...new Set([...member.previousNames!, member.canonicalName, row.previousName])],
        gameProfile: { ...member.gameProfile, avatarPath: row.avatarPath } });
      changed.canonicalName = "Later officer edit";
    }
    expect(applyMemberProfileUpdates(after)).toBe(after);
  });
  it("does not guess missing or duplicate UIDs or touch other installations", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    state.memberProfileUpdates = undefined;
    expect(applyMemberProfileUpdates({ ...state, alliance: { ...state.alliance, tag: "OTHER" } }).memberProfileUpdates).toBeUndefined();
    const custom = { ...state, rosterImport: "custom-alliance" };
    expect(applyMemberProfileUpdates(custom)).toBe(custom);
    const target = state.members.find((member) => member.gameProfile?.uid === update.members[0].uid)!;
    const missing = { ...state, members: state.members.filter((member) => member !== target) };
    expect(applyMemberProfileUpdates(missing)).toBe(missing);
    const duplicate = { ...state, members: [...state.members, { ...target, id: "duplicate" }] };
    expect(applyMemberProfileUpdates(duplicate)).toBe(duplicate);
  });
  it("does not replay the older names or avatars after a newer roster capture", () => {
    const state = importCapturedRoster(structuredClone(INITIAL_STATE));
    expect(applyMemberProfileUpdates(state)).toBe(state);
    expect(state.members.find((member) => member.gameProfile?.uid === "1543620585000927")?.canonicalName).toBe("The Legend of Jocco");
  });

});
