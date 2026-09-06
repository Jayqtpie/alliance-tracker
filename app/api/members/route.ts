import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";
import { mergeMemberIdentities, removeMemberFromRoster } from "@/lib/tracker";

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
  try {
    const state = await getState();
    const members = parsed.data.members.map((member) => ({
      ...member,
      gameProfile: state.members.find((existing) => existing.id === member.id)?.gameProfile,
      previousNames: state.members.find((existing) => existing.id === member.id)?.previousNames,
    }));
    return NextResponse.json(await setState({ ...state, members }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save roster changes." }, { status: 409 });
  }
}

const mergeSchema = z.object({
  primaryId: z.string().min(1),
  duplicateId: z.string().min(1),
  version: z.number().int().positive(),
  keepEntries: z.record(z.string(), z.string()).optional(),
});
const renameSchema = z.object({
  action: z.literal("rename"),
  memberId: z.string().min(1),
  canonicalName: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
});

export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = z.union([renameSchema, mergeSchema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const state = await getState();
    if (parsed.data.version !== state.version) throw new StateConflictError();
    if ("action" in parsed.data) {
      const { memberId, canonicalName } = parsed.data;
      const member = state.members.find((item) => item.id === memberId);
      if (!member) return NextResponse.json({ error: "This player no longer exists. Refresh the roster." }, { status: 404 });
      const aliases = [...new Set([...member.aliases, member.canonicalName])].filter((name) => name !== canonicalName);
      const previousNames = [...new Set([...(member.previousNames ?? []), member.canonicalName])].filter((name) => name !== canonicalName);
      return NextResponse.json(await setState({ ...state, members: state.members.map((item) => item.id === memberId ? { ...item, canonicalName, aliases, previousNames } : item) }));
    }
    const merged = mergeMemberIdentities(state, parsed.data.primaryId, parsed.data.duplicateId, parsed.data.keepEntries);
    return NextResponse.json(await setState(merged));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not merge members." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const memberId = new URL(request.url).searchParams.get("id");
  if (!memberId) return NextResponse.json({ error: "Choose a member to remove." }, { status: 400 });
  try {
    const state = await getState();
    return NextResponse.json(await setState(removeMemberFromRoster(state, memberId)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove member." }, { status: 400 });
  }
}
