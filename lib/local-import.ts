import type { ExtractedRow } from "@/lib/types";

export interface LocalExtractionFile {
  version?: number;
  generatedAt?: string;
  source?: string;
  sourceFiles?: string[];
  rows: ExtractedRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseLocalExtraction(value: unknown): ExtractedRow[] {
  const candidate = Array.isArray(value) ? value : isRecord(value) ? value.rows : undefined;
  if (!Array.isArray(candidate)) throw new Error("This file does not contain a Codex rows array.");
  if (!candidate.length) throw new Error("The Codex extraction file contains no rows.");

  return candidate.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Row ${index + 1} is not a valid object.`);
    const rank = Number(value.rank);
    const points = Number(value.points);
    const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
    const confidence = value.confidence === undefined ? 0.9 : Number(value.confidence);
    if (!Number.isInteger(rank) || rank < 1) throw new Error(`Row ${index + 1} has an invalid rank.`);
    if (!displayName) throw new Error(`Row ${index + 1} has no commander name.`);
    if (!Number.isInteger(points) || points < 0) throw new Error(`Row ${index + 1} has invalid points.`);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`Row ${index + 1} has invalid confidence.`);
    return {
      rank,
      displayName,
      points,
      confidence,
      isPinned: value.isPinned === true,
      needsReview: value.needsReview === true,
      sourceFile: typeof value.sourceFile === "string" ? value.sourceFile : undefined,
    };
  });
}

export function parseLocalExtractionText(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid JSON extraction file.");
  }
  return parseLocalExtraction(value);
}
