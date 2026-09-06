import { matchMember, normalizeName } from "./tracker";
import type { ExtractedRow, Member } from "./types";

export type ReviewRow = ExtractedRow & { id?: string; memberId?: string; createMember?: boolean; confirmReturned?: boolean };

export function reviewIdentity(row: ReviewRow, members: Member[]) {
  return row.memberId ? members.find((member) => member.id === row.memberId) : row.createMember ? undefined : matchMember(row.displayName, members);
}

export function verificationBlocker(row: ReviewRow, rows: ReviewRow[], members: Member[]) {
  if (!Number.isInteger(row.rank) || row.rank < 1 || !row.displayName.trim() || !Number.isInteger(row.points) || row.points < 0) return "Enter a valid rank, name and points.";
  if (rows.some((other) => other !== row && other.rank === row.rank)) return "Correct the duplicate rank.";
  const member = reviewIdentity(row, members);
  if (!member && (!row.createMember || row.memberId)) return "Choose an identity or confirm a new member.";
  if (member && !member.active && !row.confirmReturned) return "Confirm this member has returned, or choose another identity.";
  if (rows.some((other) => other !== row && (member ? reviewIdentity(other, members)?.id === member.id : !reviewIdentity(other, members) && normalizeName(other.displayName) === normalizeName(row.displayName)))) return "Correct the duplicate identity or remove the extra row.";
  return undefined;
}

export function requiresHumanReview(row: ExtractedRow) {
  return !row.reviewed && (Boolean(row.needsReview) || row.confidence < .86);
}

export function missingRanks(rows: ReviewRow[]) {
  const ranks = new Set(rows.map((row) => row.rank));
  const max = Math.min(150, Math.max(0, ...ranks));
  return Array.from({ length: max }, (_, index) => index + 1).filter((rank) => !ranks.has(rank));
}
