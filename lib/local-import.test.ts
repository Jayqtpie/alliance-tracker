import { describe, expect, it } from "vitest";
import { parseLocalExtraction, parseLocalExtractionText } from "./local-import";

describe("local Codex extraction import", () => {
  it("accepts the companion file format", () => {
    expect(parseLocalExtraction({
      version: 1,
      source: "codex-cli",
      rows: [{ rank: 4, displayName: " 구름DongJa ", points: 42716513, confidence: 0.93, isPinned: false, needsReview: false }],
    })).toEqual([{ rank: 4, displayName: "구름DongJa", points: 42716513, confidence: 0.93, isPinned: false, needsReview: false }]);
  });

  it("accepts a bare rows array and supplies optional defaults", () => {
    expect(parseLocalExtraction([{ rank: 1, displayName: "Super McNasty", points: 74831650 }]))
      .toEqual([{ rank: 1, displayName: "Super McNasty", points: 74831650, confidence: 0.9, isPinned: false, needsReview: false }]);
  });

  it("rejects malformed JSON and invalid row values", () => {
    expect(() => parseLocalExtractionText("not json")).toThrow("not a valid JSON");
    expect(() => parseLocalExtraction({ rows: [{ rank: 0, displayName: "Test", points: 1 }] })).toThrow("invalid rank");
  });
});
