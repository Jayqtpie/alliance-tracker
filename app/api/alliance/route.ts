import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { allianceSchema } from "@/lib/alliance";
import { getState, setState, StateConflictError } from "@/lib/store";

export const runtime = "nodejs";
const schema = z.object({ alliance: allianceSchema, version: z.number().int().positive() });

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const state = await getState();
    if (state.version !== parsed.data.version) throw new StateConflictError();
    return NextResponse.json(await setState({ ...state, alliance: parsed.data.alliance }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save alliance settings." }, { status: error instanceof StateConflictError ? 409 : 500 });
  }
}
