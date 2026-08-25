import type { ExtractedRow, Member, RankingEntry, Snapshot } from "@/lib/types";

export function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\[RSCL\]/gi, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function weekStartFor(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function dayLabelFor(isoDate: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
}

export function dedupeRows(rows: ExtractedRow[]) {
  const warnings: string[] = [];
  const byRank = new Map<number, ExtractedRow>();

  for (const row of rows) {
    if (row.isPinned || !Number.isInteger(row.rank) || row.rank < 1 || row.points < 0) continue;
    const existing = byRank.get(row.rank);
    if (!existing) {
      byRank.set(row.rank, row);
      continue;
    }
    const same =
      normalizeName(existing.displayName) === normalizeName(row.displayName) &&
      existing.points === row.points;
    if (!same) warnings.push(`Rank ${row.rank} has conflicting readings and needs review.`);
    if (row.confidence > existing.confidence) byRank.set(row.rank, row);
  }

  const deduped = [...byRank.values()].sort((a, b) => a.rank - b.rank);
  if (deduped.length) {
    const ranks = new Set(deduped.map((row) => row.rank));
    for (let rank = 1; rank <= Math.max(...ranks); rank += 1) {
      if (!ranks.has(rank)) warnings.push(`Rank ${rank} is missing from this import.`);
    }
  }
  return { rows: deduped, warnings: [...new Set(warnings)] };
}

export function matchMember(name: string, members: Member[]) {
  const normalized = normalizeName(name);
  return members.find((member) =>
    [member.canonicalName, ...member.aliases].some((alias) => normalizeName(alias) === normalized),
  );
}

export function snapshotComparison(current: Snapshot, snapshots: Snapshot[]) {
  const previous = snapshots
    .filter(
      (snapshot) =>
        snapshot.id !== current.id &&
        snapshot.weekStart < current.weekStart &&
        snapshot.status === current.status &&
        (current.status === "final" || snapshot.dayLabel === current.dayLabel),
    )
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];

  const priorByMember = new Map(previous?.entries.map((entry) => [entry.memberId, entry]));
  return {
    previous,
    rows: current.entries.map((entry) => {
      const prior = entry.memberId ? priorByMember.get(entry.memberId) : undefined;
      return {
        ...entry,
        priorPoints: prior?.points,
        priorRank: prior?.rank,
        pointChange: prior ? entry.points - prior.points : undefined,
        percentChange: prior && prior.points ? ((entry.points - prior.points) / prior.points) * 100 : undefined,
        rankChange: prior ? prior.rank - entry.rank : undefined,
      };
    }),
  };
}

export function toRankingEntries(rows: ExtractedRow[], members: Member[]): RankingEntry[] {
  return rows.map((row) => {
    const member = matchMember(row.displayName, members);
    return {
      id: crypto.randomUUID(),
      memberId: member?.id,
      rank: row.rank,
      displayName: row.displayName,
      points: row.points,
      confidence: row.confidence,
      sourceFile: row.sourceFile,
      needsReview: row.needsReview || !member || row.confidence < 0.86,
    };
  });
}
