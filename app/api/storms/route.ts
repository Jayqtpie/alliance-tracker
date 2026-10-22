import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";
import { lineupProblem, lockedWeekViolation } from "@/lib/storms";

const schema = z.object({
  weeks: z.array(z.object({
    id: z.string().min(1),
    kind: z.enum(["desert", "canyon"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid battle date."),
    locked: z.boolean().optional(),
    confirmed: z.array(z.enum(["A", "B"])).max(2).optional(),
    times: z.object({ A: z.string().max(80).optional(), B: z.string().max(80).optional() }).optional(),
    slots: z.array(z.object({
      memberId: z.string().min(1),
      team: z.enum(["A", "B"]),
      role: z.enum(["starter", "sub"]),
      result: z.enum(["played", "missed", "excused"]).optional(),
      park: z.boolean().optional(),
    })).max(60),
  })).max(1000),
  version: z.number().int().positive(),
});

export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid lineup data." }, { status: 400 });
  const { weeks } = parsed.data;
  if (new Set(weeks.map((week) => week.id)).size !== weeks.length) {
    return NextResponse.json({ error: "Each week must have a unique id." }, { status: 400 });
  }
  const problem = weeks.map(lineupProblem).find(Boolean);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  try {
    const state = await getState();
    if (parsed.data.version !== state.version) throw new StateConflictError();
    if (lockedWeekViolation(state.stormWeeks ?? [], weeks)) return NextResponse.json({ error: "That week is locked. Unlock it before changing it." }, { status: 400 });
    const memberIds = new Set(state.members.map((member) => member.id));
    if (weeks.some((week) => week.slots.some((slot) => !memberIds.has(slot.memberId)))) {
      return NextResponse.json({ error: "That roster changed. Refresh before saving." }, { status: 400 });
    }
    return NextResponse.json(await setState({ ...state, stormWeeks: weeks }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the lineup." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}
