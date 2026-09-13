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

// Build the roster index and duplicate counts once per review update.
export function analyzeReview(rows: ReviewRow[], members: Member[]) {
  const byId = new Map(members.map((member) => [member.id, member]));
  const byName = new Map<string, Member | undefined>();
  for (const member of members) {
    for (const name of new Set([member.canonicalName, ...member.aliases].map(normalizeName))) {
      if (!name) continue;
      byName.set(name, byName.has(name) && byName.get(name)?.id !== member.id ? undefined : member);
    }
  }
  const identities = rows.map((row) => row.memberId ? byId.get(row.memberId) : row.createMember ? undefined : byName.get(normalizeName(row.displayName)));
  const keys = rows.map((row, index) => identities[index] ? `member:${identities[index]!.id}` : `name:${normalizeName(row.displayName)}`);
  const ranks = new Map<number, number>();
  const counts = new Map<string, number>();
  rows.forEach((row, index) => {
    ranks.set(row.rank, (ranks.get(row.rank) || 0) + 1);
    counts.set(keys[index], (counts.get(keys[index]) || 0) + 1);
  });
  const blockers = rows.map((row, index) => {
    if (!Number.isInteger(row.rank) || row.rank < 1 || !row.displayName.trim() || !Number.isInteger(row.points) || row.points < 0) return "Enter a valid rank, name and points.";
    if (ranks.get(row.rank)! > 1) return "Correct the duplicate rank.";
    const member = identities[index];
    if (!member && (!row.createMember || row.memberId)) return "Choose an identity or confirm a new member.";
    if (member && !member.active && !row.confirmReturned) return "Confirm this member has returned, or choose another identity.";
    if (counts.get(keys[index])! > 1) return "Correct the duplicate identity or remove the extra row.";
    return undefined;
  });
  return { identities, blockers };
}
