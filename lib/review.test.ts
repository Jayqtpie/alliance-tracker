import { describe, expect, it } from "vitest";
import { analyzeImport, dedupeRows } from "./tracker";
import { analyzeReview, reviewIdentity, missingRanks, requiresHumanReview, verificationBlocker, type ReviewRow } from "./review";

const members = [
  { id: "a", canonicalName: "雨", aliases: [], active: true },
  { id: "b", canonicalName: "雨", aliases: [], active: true },
  { id: "c", canonicalName: "Returner", aliases: [], active: false },
];
const row: ReviewRow = { rank: 1, displayName: "雨", points: 100, confidence: .6, needsReview: true, memberId: "a" };

describe("human review", () => {
  it("clears OCR warnings after explicit verification without changing confidence", () => {
    const verified = { ...row, reviewed: true };
    expect(requiresHumanReview(row)).toBe(true);
    expect(requiresHumanReview(verified)).toBe(false);
    expect(analyzeImport([verified], members)).toEqual([]);
    expect(verified.confidence).toBe(.6);
    expect(requiresHumanReview({ ...verified, reviewed: false })).toBe(true);
  });
  it("identifies missing ranks and removes the warning once a row is added", () => {
    const rows = [{ ...row, rank: 8 }, { ...row, rank: 10 }];
    expect(missingRanks(rows)).toContain(9);
    expect(missingRanks([...rows, { ...row, rank: 9 }])).not.toContain(9);
  });
  it("requires return confirmation and refuses verification of duplicate identities", () => {
    const departed = { ...row, memberId: "c" };
    expect(verificationBlocker(departed, [departed], members)).toContain("returned");
    const returned = { ...departed, confirmReturned: true };
    expect(verificationBlocker(returned, [returned], members)).toBeUndefined();
    expect(verificationBlocker(row, [row, { ...row, rank: 2, displayName: "Alias" }], members)).toContain("duplicate identity");
  });
  it("permits different identities with the same captured name", () => {
    const rows = [{ ...row, reviewed: true }, { ...row, rank: 2, memberId: "b", reviewed: true }];
    expect(analyzeImport(rows, members)).toEqual([]);
    expect(verificationBlocker(rows[0], rows, members)).toBeUndefined();
  });
  it("retains conflicting extraction readings as actionable review flags", () => {
    const result = dedupeRows([{ ...row, confidence: .99 }, { ...row, points: 50, confidence: .95 }]);
    expect(requiresHumanReview(result.rows[0])).toBe(true);
  });
});

 describe("indexed review validation", () => {
  it("keeps the same blockers as server verification across identity edge cases", () => {
    const roster = [
      ...members,
      { id: "d", canonicalName: "구름DongJa", aliases: ["구름DongJa", "Cloud"], active: true },
      { id: "e", canonicalName: "Other", aliases: ["Cloud"], active: true },
      { id: "f", canonicalName: "Third", aliases: ["Cloud"], active: true },
    ];
    const cases: ReviewRow[][] = [
      [{ ...row, memberId: undefined }],
      [{ ...row, displayName: "Cloud", memberId: undefined }],
      [{ ...row, displayName: "구름DongJa", memberId: undefined }],
      [{ ...row, memberId: "missing", createMember: true }],
      [{ ...row, memberId: "c" }],
      [{ ...row, memberId: "c", confirmReturned: true }],
      [{ ...row, memberId: undefined, displayName: "New", createMember: true }],
      [{ ...row }, { ...row, rank: 2, displayName: "Alias" }],
      [{ ...row }, { ...row, memberId: "b" }],
      [{ ...row }, { ...row, rank: 2, memberId: "b" }],
      [{ ...row, rank: 0 }, { ...row, points: -1 }, { ...row, displayName: "" }],
      [{ ...row, memberId: undefined, createMember: true }, { ...row, rank: 2, memberId: undefined, createMember: true }],
    ];
    for (const rows of cases) {
      const result = analyzeReview(rows, roster);
      expect(result.blockers).toEqual(rows.map((entry) => verificationBlocker(entry, rows, roster)));
      expect(result.identities).toEqual(rows.map((entry) => reviewIdentity(entry, roster)));
    }
  });
  it("validates a full board without repeatedly scanning the roster aliases", () => {
    let aliasReads = 0;
    const roster = Array.from({ length: 150 }, (_, index) => ({
      id: String(index), canonicalName: `Player ${index}`, active: true,
      get aliases() { aliasReads++; return [`Alias ${index}`, `이름 ${index}`]; },
    }));
    const rows = roster.map((member, index) => ({ rank: index + 1, displayName: `Alias ${index}`, points: 1000 - index, confidence: .8 }));
    const result = analyzeReview(rows, roster);
    expect(result.blockers.every((blocker) => !blocker)).toBe(true);
    expect(result.identities.map((member) => member?.id)).toEqual(roster.map((member) => member.id));
    expect(aliasReads).toBe(150);
  });
});
