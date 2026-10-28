import type { Member, RallyBoard, RallyMode, RallySquad } from "./types";
import { memberStats, statDisplay } from "./member-stats";

/** A rally is its leader plus four joiners. */
export const RALLY_SIZE = 5;
export const LEADER_SLOT = 0;
export const MAX_SQUADS = 50;

export type RallyTarget = { kind: "slot"; squadId: string; slot: number } | { kind: "bench" };

export interface ResolvedRallyBoard {
  board: RallyBoard;
  /** Available and not in a squad, strongest first. */
  bench: Member[];
  unavailable: Member[];
}

// Hero power, not total power: total power swings with the troops a player has trained.
const heroPower = (member: Member) => memberStats(member).heroPower ?? 0;
const byHeroPower = (a: Member, b: Member) => heroPower(b) - heroPower(a) || a.canonicalName.localeCompare(b.canonicalName);

export function canLead(member: Member) {
  return memberStats(member).profession === "War Leader";
}

function emptySquad(index: number): RallySquad {
  return { id: `squad-${index}`, slots: Array.from({ length: RALLY_SIZE }, () => null) };
}

function nextSquadIndex(squads: RallySquad[]) {
  return squads.reduce((max, squad) => {
    const match = squad.id.match(/^squad-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

/** One squad per five available members, but never more squads than there are War Leaders to lead them. */
export function suggestedSquadCount(members: Member[], unavailable: string[] = []) {
  const away = new Set(unavailable);
  const available = members.filter((member) => member.active && !away.has(member.id));
  const leaders = available.filter(canLead).length;
  return Math.max(1, Math.min(Math.floor(available.length / RALLY_SIZE), leaders, MAX_SQUADS));
}

export function emptyRallyBoard(count: number, mode: RallyMode = "balanced"): RallyBoard {
  return { mode, squads: Array.from({ length: count }, (_, index) => emptySquad(index + 1)), pinned: [], unavailable: [] };
}

/** Squads past the new count go, and their members return to the bench unpinned. */
export function setSquadCount(board: RallyBoard, count: number): RallyBoard {
  const target = Math.max(1, Math.min(MAX_SQUADS, Math.floor(count)));
  if (target <= board.squads.length) {
    const kept = board.squads.slice(0, target);
    const placed = new Set(kept.flatMap((squad) => squad.slots).filter((id): id is string => Boolean(id)));
    return { ...board, squads: kept, pinned: board.pinned.filter((id) => placed.has(id)) };
  }
  const squads = [...board.squads];
  while (squads.length < target) squads.push(emptySquad(nextSquadIndex(squads)));
  return { ...board, squads };
}

/**
 * Drops anyone who left, duplicates and stray ids, so the board always matches the roster. A leader
 * who is no longer a War Leader stays put, flagged, so an officer sees why the save is refused.
 */
export function resolveRallyBoard(members: Member[], board: RallyBoard): ResolvedRallyBoard {
  const activeById = new Map(members.filter((member) => member.active).map((member) => [member.id, member]));
  const seen = new Set<string>();
  const squads = board.squads.map((squad) => ({
    id: squad.id,
    slots: Array.from({ length: RALLY_SIZE }, (_, index) => {
      const id = squad.slots[index] ?? null;
      if (!id || seen.has(id) || !activeById.has(id)) return null;
      seen.add(id);
      return id;
    }),
  }));
  const pinned = [...new Set(board.pinned)].filter((id) => seen.has(id));
  const unavailable = [...new Set(board.unavailable)].filter((id) => activeById.has(id) && !seen.has(id));
  const away = new Set(unavailable);
  const active = [...activeById.values()];
  return {
    board: { mode: board.mode, squads, pinned, unavailable },
    bench: active.filter((member) => !seen.has(member.id) && !away.has(member.id)).sort(byHeroPower),
    unavailable: active.filter((member) => away.has(member.id)).sort(byHeroPower),
  };
}

/**
 * Fills the squads again, leaving pinned members where they are. Each open leader slot takes the
 * strongest War Leader left, squad 1 first. The open joiner slots then take the strongest members left,
 * of any profession. Tiered fills squad 1 first, then squad 2, so squad 1 is the main hitter. Balanced
 * gives each joiner to the lightest squad with room, strongest first, then trades joiners between squads
 * while a trade evens out the totals.
 */
export function suggestRallyBoard(members: Member[], board: RallyBoard): RallyBoard {
  const { board: current, bench } = resolveRallyBoard(members, board);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const pinned = new Set(current.pinned);
  const keep = (id: string | null, slot: number) => {
    const member = id ? memberById.get(id) : undefined;
    return member && pinned.has(member.id) && (slot !== LEADER_SLOT || canLead(member)) ? member.id : null;
  };
  const squads = current.squads.map((squad) => ({ id: squad.id, slots: squad.slots.map(keep) }));
  const kept = new Set(squads.flatMap((squad) => squad.slots).filter((id): id is string => Boolean(id)));
  // The bench plus everyone unpinned, strongest first.
  const pool = [...bench, ...current.squads.flatMap((squad) => squad.slots)
    .filter((id): id is string => Boolean(id) && !kept.has(id!)).map((id) => memberById.get(id)!)].sort(byHeroPower);
  const take = (member: Member) => pool.splice(pool.indexOf(member), 1);

  for (const squad of squads) {
    if (squad.slots[LEADER_SLOT]) continue;
    const leader = pool.find(canLead);
    if (!leader) break;
    squad.slots[LEADER_SLOT] = leader.id;
    take(leader);
  }

  const open = squads.reduce((sum, squad) => sum + squad.slots.filter((id, slot) => slot !== LEADER_SLOT && !id).length, 0);
  const joiners = pool.slice(0, open);
  // Millions, so the trade arithmetic below stays exact in a double.
  const power = (id: string | null) => (id ? heroPower(memberById.get(id)!) : 0) / 1e6;
  const total = squads.map((squad) => squad.slots.reduce((sum, id) => sum + power(id), 0));
  const openSlot = (index: number) => squads[index].slots.findIndex((id, slot) => slot !== LEADER_SLOT && !id);

  if (current.mode === "tiered") {
    let index = 0;
    for (const joiner of joiners) {
      while (openSlot(index) < 0) index += 1;
      squads[index].slots[openSlot(index)] = joiner.id;
    }
    return { ...current, squads };
  }

  const placed: { id: string; squad: number; slot: number }[] = [];
  for (const joiner of joiners) {
    let lightest = -1;
    squads.forEach((_, index) => {
      if (openSlot(index) >= 0 && (lightest < 0 || total[index] < total[lightest])) lightest = index;
    });
    const slot = openSlot(lightest);
    squads[lightest].slots[slot] = joiner.id;
    total[lightest] += power(joiner.id);
    placed.push({ id: joiner.id, squad: lightest, slot });
  }

  // Each trade strictly lowers the sum of squared squad totals, so this ends.
  for (;;) {
    let best: [number, number] | undefined, bestChange = -1e-6;
    for (let a = 0; a < placed.length; a += 1) for (let b = a + 1; b < placed.length; b += 1) {
      const from = placed[a], to = placed[b];
      if (from.squad === to.squad) continue;
      const shift = power(to.id) - power(from.id);
      const change = 2 * shift * (total[from.squad] - total[to.squad]) + 2 * shift * shift;
      if (change < bestChange) { bestChange = change; best = [a, b]; }
    }
    if (!best) break;
    const from = placed[best[0]], to = placed[best[1]];
    const shift = power(to.id) - power(from.id);
    total[from.squad] += shift; total[to.squad] -= shift;
    squads[from.squad].slots[from.slot] = to.id;
    squads[to.squad].slots[to.slot] = from.id;
    placed[best[0]] = { ...to, squad: from.squad, slot: from.slot };
    placed[best[1]] = { ...from, squad: to.squad, slot: to.slot };
  }
  return { ...current, squads };
}

/** The board an officer starts from when none has been saved. */
export function defaultRallyBoard(members: Member[]): RallyBoard {
  return suggestRallyBoard(members, emptyRallyBoard(suggestedSquadCount(members)));
}

function findSlot(board: RallyBoard, memberId: string) {
  for (const squad of board.squads) {
    const slot = squad.slots.indexOf(memberId);
    if (slot >= 0) return { squadId: squad.id, slot };
  }
  return undefined;
}

/**
 * Moves a member onto a slot or back to the bench. Only a War Leader may take a leader slot. Moving
 * onto a taken slot swaps the two, unless the one displaced would land in a leader slot they cannot
 * hold, or came from the bench; then they go to the bench.
 */
export function moveRallyMember(board: RallyBoard, members: Member[], memberId: string, target: RallyTarget): RallyBoard {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const member = memberById.get(memberId);
  if (!member) return board;
  const origin = findSlot(board, memberId);
  const unpin = (ids: string[], id: string) => ids.filter((pinned) => pinned !== id);

  if (target.kind === "bench") {
    if (!origin) return board;
    return {
      ...board,
      squads: board.squads.map((squad) => ({ ...squad, slots: squad.slots.map((id) => id === memberId ? null : id) })),
      pinned: unpin(board.pinned, memberId),
    };
  }

  const squad = board.squads.find((candidate) => candidate.id === target.squadId);
  if (!squad || target.slot < 0 || target.slot >= RALLY_SIZE) return board;
  if (target.slot === LEADER_SLOT && !canLead(member)) return board;
  if (origin && origin.squadId === target.squadId && origin.slot === target.slot) return board;

  const displaced = squad.slots[target.slot];
  const displacedMember = displaced ? memberById.get(displaced) : undefined;
  const swaps = Boolean(origin && displacedMember && (origin.slot !== LEADER_SLOT || canLead(displacedMember)));
  let pinned = board.pinned;
  if (displaced && !swaps) pinned = unpin(pinned, displaced);

  return {
    ...board,
    squads: board.squads.map((candidate) => ({
      ...candidate,
      slots: candidate.slots.map((id, slot) => {
        if (candidate.id === target.squadId && slot === target.slot) return memberId;
        if (origin && candidate.id === origin.squadId && slot === origin.slot) return swaps ? displaced : null;
        return id;
      }),
    })),
    pinned,
    unavailable: board.unavailable.filter((id) => id !== memberId),
  };
}

export function togglePin(board: RallyBoard, memberId: string): RallyBoard {
  if (board.pinned.includes(memberId)) return { ...board, pinned: board.pinned.filter((id) => id !== memberId) };
  return findSlot(board, memberId) ? { ...board, pinned: [...board.pinned, memberId] } : board;
}

/** Marking someone unavailable takes them out of their squad. */
export function setUnavailable(board: RallyBoard, memberId: string, unavailable: boolean): RallyBoard {
  if (!unavailable) return { ...board, unavailable: board.unavailable.filter((id) => id !== memberId) };
  if (board.unavailable.includes(memberId)) return board;
  return {
    ...board,
    squads: board.squads.map((squad) => ({ ...squad, slots: squad.slots.map((id) => id === memberId ? null : id) })),
    pinned: board.pinned.filter((id) => id !== memberId),
    unavailable: [...board.unavailable, memberId],
  };
}

export function squadTotal(squad: RallySquad, memberById: Map<string, Member>) {
  return squad.slots.reduce((sum, id) => sum + (id && memberById.has(id) ? heroPower(memberById.get(id)!) : 0), 0);
}

/** Strongest against weakest squad, counting only squads with someone in them. */
export function squadGap(board: RallyBoard, memberById: Map<string, Member>): number | null {
  const totals = board.squads.filter((squad) => squad.slots.some(Boolean)).map((squad) => squadTotal(squad, memberById));
  return totals.length ? Math.max(...totals) - Math.min(...totals) : null;
}

/** Plain text for pasting into alliance chat or Discord. */
export function rallyBoardText(board: RallyBoard, memberById: Map<string, Member>): string {
  const label = (id: string) => {
    const member = memberById.get(id)!;
    return `${member.canonicalName} (${memberStats(member).heroPowerDisplay})`;
  };
  return board.squads.map((squad, index) => {
    const [leader, ...joiners] = squad.slots;
    const filled = joiners.filter((id): id is string => Boolean(id) && memberById.has(id!));
    return [
      `Squad ${index + 1} · ${statDisplay(squadTotal(squad, memberById))}`,
      `Leader: ${leader && memberById.has(leader) ? label(leader) : "—"}`,
      `Joiners: ${filled.length ? filled.map(label).join(", ") : "—"}`,
    ].join("\n");
  }).join("\n\n");
}

/** The kept identity takes the duplicate's slot, pin and availability, unless it already has a place. */
export function mergeRallyMember(board: RallyBoard, duplicateId: string, primaryId: string): RallyBoard {
  const primaryPlaced = Boolean(findSlot(board, primaryId));
  const swap = (id: string) => id === duplicateId ? primaryPlaced ? null : primaryId : id;
  const ids = (list: string[]) => [...new Set(list.map((id) => id === duplicateId ? primaryId : id))];
  return {
    ...board,
    squads: board.squads.map((squad) => ({ ...squad, slots: squad.slots.map((id) => id && swap(id)) })),
    pinned: ids(board.pinned),
    unavailable: ids(board.unavailable),
  };
}

export function removeRallyMember(board: RallyBoard, memberId: string): RallyBoard {
  return {
    ...board,
    squads: board.squads.map((squad) => ({ ...squad, slots: squad.slots.map((id) => id === memberId ? null : id) })),
    pinned: board.pinned.filter((id) => id !== memberId),
    unavailable: board.unavailable.filter((id) => id !== memberId),
  };
}
