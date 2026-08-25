import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getState, setState } from "@/lib/store";

const schema = z.object({
  members: z.array(z.object({
    id: z.string(),
    canonicalName: z.string().min(1).max(100),
    aliases: z.array(z.string().min(1).max(100)),
    active: z.boolean(),
    joinedAt: z.string().optional(),
    leftAt: z.string().optional(),
    notes: z.string().optional(),
  })).max(250),
});

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const state = await getState();
  return NextResponse.json(await setState({ ...state, members: parsed.data.members }));
}
