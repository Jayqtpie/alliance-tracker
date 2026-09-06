import { describe, expect, it } from "vitest";
import { analyzeImport, dedupeRows } from "./tracker";
import { missingRanks, requiresHumanReview, verificationBlocker, type ReviewRow } from "./review";

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
