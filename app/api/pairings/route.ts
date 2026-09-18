import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";

const schema = z.object({
  rows: z.array(z.object({
    id: z.string().min(1),
    warLeaderId: z.string().min(1).optional(),
    engineerId: z.string().min(1).optional(),
  })).max(250),
  version: z.number().int().positive(),
});

export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid pairings data." }, { status: 400 });
  if (new Set(parsed.data.rows.map((row) => row.id)).size !== parsed.data.rows.length) {
    return NextResponse.json({ error: "Each pairing row must have a unique id." }, { status: 400 });
  }
  try {
    const state = await getState();
    if (parsed.data.version !== state.version) throw new StateConflictError();
    const memberById = new Map(state.members.map((member) => [member.id, member]));
    const seen = new Set<string>();
    for (const row of parsed.data.rows) {
      for (const field of ["warLeaderId", "engineerId"] as const) {
        const memberId = row[field];
        if (!memberId) continue;
        const member = memberById.get(memberId);
        if (!member || !member.active || seen.has(memberId)) {
          return NextResponse.json({ error: "That roster changed. Refresh the pairings before saving." }, { status: 400 });
        }
        seen.add(memberId);
      }
    }
    return NextResponse.json(await setState({ ...state, pairings: parsed.data.rows }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save pairings." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}
