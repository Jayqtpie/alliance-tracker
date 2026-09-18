import capture from "./data/rscl-pairings-2026-09-18.json";
import type { Member, PairingRow, TrackerState } from "./types";

export const PAIRING_IMPORT = "rscl-927-hospital-expansion-2026-09-18-v1";

function resolveSlot(members: Member[], uid: string | undefined): string | undefined {
  if (!uid) return undefined;
  const member = members.find((member) => member.gameProfile?.uid === uid);
  return member?.active ? member.id : undefined;
}

function trimTrailingEmpty(rows: PairingRow[]): PairingRow[] {
  let end = rows.length;
  while (end > 0 && !rows[end - 1].warLeaderId && !rows[end - 1].engineerId) end -= 1;
  return rows.slice(0, end);
}

/** One reconciled War Leader / Engineer pairing sheet, applied once to the freshly loaded state. */
export function applyPairingImport(state: TrackerState): TrackerState {
  if (state.pairingImport === PAIRING_IMPORT || state.alliance.tag !== "RSCL" || String(state.alliance.server) !== "927") return state;

  // An officer has already arranged the board by hand; never clobber their work.
  // Still mark the import applied so it can never overwrite them on a later load.
  if (state.pairings && state.pairings.length > 0) return { ...state, pairingImport: PAIRING_IMPORT };

  const rows: PairingRow[] = capture.rows.map((row) => ({
    id: `pair-${row.position}`,
    warLeaderId: resolveSlot(state.members, row.warLeader?.uid),
    engineerId: resolveSlot(state.members, row.engineer?.uid),
  }));

  // The roster may not be imported yet. Marking the import applied here would strand the
  // board empty forever, so leave it unmarked and let a later load retry once members exist.
  const paired = trimTrailingEmpty(rows);
  if (!paired.length) return state;

  return { ...state, pairings: paired, pairingImport: PAIRING_IMPORT };
}
