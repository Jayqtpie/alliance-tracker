import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";

const schema = z.object({
  events: z.array(z.object({
    id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid fight date."),
    label: z.string().trim().max(80).optional(),
    attendance: z.record(z.string().min(1), z.enum(["present", "absent", "excused"])),
  })).max(1000),
  version: z.number().int().positive(),
});

export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid attendance data." }, { status: 400 });
  if (new Set(parsed.data.events.map((event) => event.id)).size !== parsed.data.events.length) {
    return NextResponse.json({ error: "Each fight must have a unique id." }, { status: 400 });
  }
  try {
    const state = await getState();
    if (parsed.data.version !== state.version) throw new StateConflictError();
    const memberIds = new Set(state.members.map((member) => member.id));
    if (parsed.data.events.some((event) => Object.keys(event.attendance).some((id) => !memberIds.has(id)))) {
      return NextResponse.json({ error: "That roster changed. Refresh before saving." }, { status: 400 });
    }
    return NextResponse.json(await setState({ ...state, svsEvents: parsed.data.events }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save attendance." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}
