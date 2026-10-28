import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { canLead, MAX_SQUADS, RALLY_SIZE } from "@/lib/rally-squads";
import { getState, setState, StateConflictError } from "@/lib/store";

const memberIds = z.array(z.string().min(1)).max(500);
const schema = z.object({
  board: z.object({
    mode: z.enum(["balanced", "tiered"]),
    squads: z.array(z.object({
      id: z.string().min(1),
      slots: z.array(z.string().min(1).nullable()).length(RALLY_SIZE),
    })).min(1).max(MAX_SQUADS),
    pinned: memberIds,
    unavailable: memberIds,
  }),
  version: z.number().int().positive(),
});

export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid rally squads." }, { status: 400 });
  const { board, version } = parsed.data;
  if (new Set(board.squads.map((squad) => squad.id)).size !== board.squads.length) {
    return NextResponse.json({ error: "Each squad must have a unique id." }, { status: 400 });
  }
  try {
    const state = await getState();
    if (version !== state.version) throw new StateConflictError();
    const memberById = new Map(state.members.map((member) => [member.id, member]));
    const placed = new Set<string>();
    for (const squad of board.squads) {
      for (const [slot, memberId] of squad.slots.entries()) {
        if (!memberId) continue;
        const member = memberById.get(memberId);
        if (!member || !member.active || placed.has(memberId)) {
          return NextResponse.json({ error: "That roster changed. Refresh the squads before saving." }, { status: 400 });
        }
        if (slot === 0 && !canLead(member)) {
          return NextResponse.json({ error: `${member.canonicalName} is not a War Leader, so cannot lead a rally.` }, { status: 400 });
        }
        placed.add(memberId);
      }
    }
    const known = (id: string) => memberById.get(id)?.active;
    if (!board.pinned.every((id) => placed.has(id)) || !board.unavailable.every((id) => known(id) && !placed.has(id))) {
      return NextResponse.json({ error: "That roster changed. Refresh the squads before saving." }, { status: 400 });
    }
    return NextResponse.json(await setState({ ...state, rallyBoard: board }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the squads." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}
