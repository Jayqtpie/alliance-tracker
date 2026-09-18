import type { Member, PairingRow } from "./types";
import { memberStats } from "./member-stats";

export type PairingColumn = "warLeader" | "engineer";

export interface ResolvedPairings {
  rows: PairingRow[];
  unpairedWarLeaders: Member[];
  unpairedEngineers: Member[];
  withoutProfession: number;
}

const PROFESSION_BY_COLUMN: Record<PairingColumn, string> = { warLeader: "War Leader", engineer: "Engineer" };
const FIELD_BY_COLUMN: Record<PairingColumn, "warLeaderId" | "engineerId"> = { warLeader: "warLeaderId", engineer: "engineerId" };

export function nextRowId(rows: PairingRow[]): string {
  const highest = rows.reduce((max, row) => {
    const match = row.id.match(/^pair-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `pair-${highest + 1}`;
}

function sortByPowerDesc(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const powerA = memberStats(a).power;
    const powerB = memberStats(b).power;
    if (powerA === powerB) return a.canonicalName.localeCompare(b.canonicalName);
    if (powerA === null) return 1;
    if (powerB === null) return -1;
    return powerB - powerA;
  });
}

function activeByProfession(members: Member[], profession: string): Member[] {
  return sortByPowerDesc(members.filter((member) => member.active && memberStats(member).profession === profession));
}

function trimTrailingEmpty(rows: PairingRow[]): PairingRow[] {
  let end = rows.length;
  while (end > 0 && !rows[end - 1].warLeaderId && !rows[end - 1].engineerId) end -= 1;
  return rows.slice(0, end);
}

export function defaultPairings(members: Member[]): PairingRow[] {
  const warLeaders = activeByProfession(members, "War Leader");
  const engineers = activeByProfession(members, "Engineer");
  const rowCount = Math.max(warLeaders.length, engineers.length);
  return Array.from({ length: rowCount }, (_, index) => ({
    id: `pair-${index + 1}`,
    warLeaderId: warLeaders[index]?.id,
    engineerId: engineers[index]?.id,
  }));
}

export function resolvePairings(members: Member[], rows: PairingRow[] | undefined): ResolvedPairings {
  const active = members.filter((member) => member.active);
  const activeIds = new Set(active.map((member) => member.id));

  const seen = new Set<string>();
  const reconciled = (rows ?? defaultPairings(members)).map((row) => {
    const next: PairingRow = { id: row.id };
    for (const column of ["warLeader", "engineer"] as const) {
      const field = FIELD_BY_COLUMN[column];
      const memberId = row[field];
      if (!memberId || seen.has(memberId) || !activeIds.has(memberId)) continue;
      next[field] = memberId;
      seen.add(memberId);
    }
    return next;
  });

  return {
    rows: trimTrailingEmpty(reconciled),
    unpairedWarLeaders: activeByProfession(active, "War Leader").filter((member) => !seen.has(member.id)),
    unpairedEngineers: activeByProfession(active, "Engineer").filter((member) => !seen.has(member.id)),
    withoutProfession: active.filter((member) => memberStats(member).profession === null && !seen.has(member.id)).length,
  };
}

export function slotMismatch(member: Member, column: PairingColumn): string | null {
  const profession = memberStats(member).profession;
  return profession === PROFESSION_BY_COLUMN[column] ? null : (profession ?? "no profession");
}

export function movePairing(
  rows: PairingRow[],
  move: { memberId: string; column: PairingColumn; target: { kind: "row"; rowId: string } | { kind: "unpaired" } },
): PairingRow[] {
  let origin: { rowId: string; column: PairingColumn } | undefined;
  let working = rows.map((row) => {
    let next = row;
    for (const column of ["warLeader", "engineer"] as const) {
      const field = FIELD_BY_COLUMN[column];
      if (next[field] === move.memberId) {
        origin = { rowId: row.id, column };
        next = { ...next, [field]: undefined };
      }
    }
    return next;
  });

  if (move.target.kind === "unpaired") return trimTrailingEmpty(working);

  const field = FIELD_BY_COLUMN[move.column];
  const targetRowId = move.target.rowId;
  let targetRow = working.find((row) => row.id === targetRowId);
  if (!targetRow) {
    targetRow = { id: targetRowId };
    working = [...working, targetRow];
  }
  const displaced = targetRow[field];

  working = working.map((row) => {
    if (row.id === targetRowId) return { ...row, [field]: move.memberId };
    if (displaced && origin !== undefined && origin.column === move.column && row.id === origin.rowId) {
      return { ...row, [field]: displaced };
    }
    return row;
  });

  return trimTrailingEmpty(working);
}
