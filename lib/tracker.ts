import type { ExtractedRow, Member, RankingEntry, Snapshot, TrackerState } from "@/lib/types";

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

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function suggestMember(name: string, members: Member[]) {
  const target = normalizeName(name);
  if (target.length < 3) return undefined;
  return members
    .flatMap((member) => [member.canonicalName, ...member.aliases].map((alias) => {
      const candidate = normalizeName(alias);
      const score = 1 - editDistance(target, candidate) / Math.max(target.length, candidate.length, 1);
      return { member, score };
    }))
    .filter(({ score }) => score >= 0.62)
    .sort((a, b) => b.score - a.score)[0];
}

export function analyzeImport(rows: ExtractedRow[], members: Member[]) {
  const warnings: string[] = [];
  const normalizedNames = new Map<string, number[]>();
  const rankCounts = new Map<number, number>();
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);

  for (const row of sorted) {
    rankCounts.set(row.rank, (rankCounts.get(row.rank) || 0) + 1);
    const normalized = normalizeName(row.displayName);
    normalizedNames.set(normalized, [...(normalizedNames.get(normalized) || []), row.rank]);
    const member = matchMember(row.displayName, members);
    if (!member) {
      const suggestion = suggestMember(row.displayName, members);
      warnings.push(
        suggestion
          ? `Rank ${row.rank} (${row.displayName}) is unmatched. Possible name change: ${suggestion.member.canonicalName}.`
          : `Rank ${row.rank} (${row.displayName}) is not linked to a known member.`,
      );
    } else if (!member.active) {
      warnings.push(`Rank ${row.rank} matches departed member ${member.canonicalName}; confirm they returned.`);
    }
  }

  for (const [name, ranks] of normalizedNames) {
    if (name && ranks.length > 1) warnings.push(`The same commander appears at ranks ${ranks.join(", ")}.`);
  }

  for (const [rank, count] of rankCounts) {
    if (count > 1) warnings.push(`Rank ${rank} appears ${count} times.`);
  }
  if (sorted.length) {
    const maxRank = Math.max(...sorted.map((row) => row.rank));
    const missing = Array.from({ length: maxRank }, (_, index) => index + 1).filter((rank) => !rankCounts.has(rank));
    if (missing.length) warnings.push(`Missing rank${missing.length === 1 ? "" : "s"}: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}.`);
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.rank > previous.rank && current.points > previous.points) {
      warnings.push(`Points increase between ranks ${previous.rank} and ${current.rank}; check both readings.`);
    }
  }

  const lowConfidence = rows.filter((row) => row.confidence < 0.86).length;
  if (lowConfidence) warnings.push(`${lowConfidence} row${lowConfidence === 1 ? " has" : "s have"} low OCR confidence.`);
  return [...new Set(warnings)];
}

export function mergeMemberIdentities(state: TrackerState, primaryId: string, duplicateId: string): TrackerState {
  if (primaryId === duplicateId) throw new Error("Choose two different members to merge.");
  const primary = state.members.find((member) => member.id === primaryId);
  const duplicate = state.members.find((member) => member.id === duplicateId);
  if (!primary || !duplicate) throw new Error("One of the selected members no longer exists.");

  const aliases = [...primary.aliases, duplicate.canonicalName, ...duplicate.aliases].filter((alias, index, all) =>
    normalizeName(alias) !== normalizeName(primary.canonicalName) &&
    all.findIndex((candidate) => normalizeName(candidate) === normalizeName(alias)) === index,
  );
  const merged: Member = {
    ...primary,
    aliases,
    active: primary.active || duplicate.active,
    joinedAt: [primary.joinedAt, duplicate.joinedAt].filter((date): date is string => Boolean(date)).sort()[0],
    leftAt: primary.active || duplicate.active ? undefined : primary.leftAt || duplicate.leftAt,
    notes: [primary.notes, duplicate.notes].filter(Boolean).join(" · ") || undefined,
  };

  return {
    ...state,
    members: state.members.filter((member) => member.id !== duplicateId).map((member) => member.id === primaryId ? merged : member),
    snapshots: state.snapshots.map((snapshot) => ({
      ...snapshot,
      entries: snapshot.entries.map((entry) => entry.memberId === duplicateId ? { ...entry, memberId: primaryId } : entry),
    })),
    operations: state.operations ? {
      ...state.operations,
      guardianPool: [...new Set(state.operations.guardianPool.map((id) => id === duplicateId ? primaryId : id))].slice(0, 7),
      stormEvents: state.operations.stormEvents.map((event) => ({
        ...event,
        participants: event.participants.map((participant) => participant.memberId === duplicateId ? { ...participant, memberId: primaryId } : participant)
          .filter((participant, index, all) => all.findIndex((item) => item.memberId === participant.memberId) === index),
      })),
      trainAssignments: state.operations.trainAssignments.map((assignment) => ({
        ...assignment,
        conductorMemberId: assignment.conductorMemberId === duplicateId ? primaryId : assignment.conductorMemberId,
        vipMemberId: assignment.vipMemberId === duplicateId ? primaryId : assignment.vipMemberId,
        backupMemberId: assignment.backupMemberId === duplicateId ? primaryId : assignment.backupMemberId,
      })),
    } : undefined,
  };
}

export function removeMemberFromRoster(state: TrackerState, memberId: string): TrackerState {
  if (!state.members.some((member) => member.id === memberId)) throw new Error("Member no longer exists.");
  return {
    ...state,
    members: state.members.filter((member) => member.id !== memberId),
    operations: state.operations ? { ...state.operations, guardianPool: state.operations.guardianPool.filter((id) => id !== memberId) } : undefined,
  };
}

export function analyzeLargeChanges(
  rows: Array<ExtractedRow & { memberId?: string }>,
  members: Member[],
  snapshots: Snapshot[],
  capturedDate: string,
  status: Snapshot["status"],
) {
  const draft: Snapshot = {
    id: "draft",
    capturedAt: `${capturedDate}T12:00:00.000Z`,
    weekStart: weekStartFor(capturedDate),
    dayLabel: dayLabelFor(capturedDate),
    status,
    sourceType: "manual",
    entries: rows.map((row) => ({
      id: `draft-${row.rank}`,
      memberId: row.memberId || matchMember(row.displayName, members)?.id,
      rank: row.rank,
      displayName: row.displayName,
      points: row.points,
      confidence: row.confidence,
    })),
  };
  const comparison = snapshotComparison(draft, snapshots);
  return comparison.rows
    .filter((row) => row.percentChange !== undefined && Math.abs(row.percentChange) >= 75 && Math.abs(row.pointChange || 0) >= 5_000_000)
    .map((row) => `${row.displayName} differs by ${Math.round(row.percentChange || 0)}% from the matching prior capture.`);
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

export function memberPerformance(member: Member, snapshots: Snapshot[]) {
  const eligibleSnapshots = [...snapshots]
    .filter((snapshot) => {
      const capturedDate = snapshot.capturedAt.slice(0, 10);
      return (!member.joinedAt || capturedDate >= member.joinedAt) && (!member.leftAt || capturedDate <= member.leftAt);
    })
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const history = eligibleSnapshots.flatMap((snapshot) => {
    const entry = snapshot.entries.find((candidate) => candidate.memberId === member.id);
    if (!entry) return [];
    const comparison = snapshotComparison(snapshot, snapshots).rows.find((candidate) => candidate.memberId === member.id);
    return [{
      snapshotId: snapshot.id,
      capturedAt: snapshot.capturedAt,
      dayLabel: snapshot.dayLabel,
      status: snapshot.status,
      rank: entry.rank,
      points: entry.points,
      displayName: entry.displayName,
      pointChange: comparison?.pointChange,
      rankChange: comparison?.rankChange,
    }];
  });

  return {
    history,
    appearances: history.length,
    eligibleCaptures: eligibleSnapshots.length,
    participationRate: eligibleSnapshots.length ? history.length / eligibleSnapshots.length * 100 : 0,
    averagePoints: history.length ? history.reduce((sum, point) => sum + point.points, 0) / history.length : 0,
    bestPoints: history.length ? Math.max(...history.map((point) => point.points)) : 0,
    bestRank: history.length ? Math.min(...history.map((point) => point.rank)) : undefined,
    latest: history.at(-1),
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
