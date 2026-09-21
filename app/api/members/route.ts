import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";
import { mergeMemberIdentities, removeMemberFromRoster } from "@/lib/tracker";
import { memberStats, parseMemberStat, parseServerId, PROFESSIONS } from "@/lib/member-stats";

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
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const state = await getState();
    const members = parsed.data.members.map((member) => ({
      ...member,
      gameProfile: state.members.find((existing) => existing.id === member.id)?.gameProfile,
      previousNames: state.members.find((existing) => existing.id === member.id)?.previousNames,
      originServer: state.members.find((existing) => existing.id === member.id)?.originServer,
      transferredTo: state.members.find((existing) => existing.id === member.id)?.transferredTo,
      manualStats: state.members.find((existing) => existing.id === member.id)?.manualStats,
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
const editSchema = renameSchema.extend({
  action: z.literal("edit"),
  heroPower: z.string().max(40),
  kills: z.string().max(40),
  // Optional so an editor opened before power and profession existed still saves.
  power: z.string().max(40).optional(),
  profession: z.enum(["", ...PROFESSIONS]).optional(),
  // Likewise for the origin and departure servers.
  originServer: z.string().max(10).optional(),
  transferredTo: z.string().max(10).optional(),
});
const setActiveSchema = z.object({
  action: z.literal("set-active"),
  memberId: z.string().min(1),
  active: z.boolean(),
  version: z.number().int().positive(),
});

export async function PATCH(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = z.union([setActiveSchema, editSchema, renameSchema, mergeSchema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const state = await getState();
    if (parsed.data.version !== state.version) throw new StateConflictError();
    if ("action" in parsed.data && parsed.data.action === "set-active") {
      const { memberId, active } = parsed.data;
      if (!state.members.some((item) => item.id === memberId)) return NextResponse.json({ error: "This player no longer exists. Refresh the roster." }, { status: 404 });
      return NextResponse.json(await setState({ ...state, members: state.members.map((item) => item.id === memberId ? { ...item, active, leftAt: active ? undefined : item.leftAt } : item) }));
    }
    if ("action" in parsed.data) {
      const { memberId, canonicalName } = parsed.data;
      const member = state.members.find((item) => item.id === memberId);
      if (!member) return NextResponse.json({ error: "This player no longer exists. Refresh the roster." }, { status: 404 });
      const aliases = [...new Set([...member.aliases, member.canonicalName])].filter((name) => name !== canonicalName);
      const previousNames = [...new Set([...(member.previousNames ?? []), member.canonicalName])].filter((name) => name !== canonicalName);
      const changes: Partial<typeof member> = { canonicalName, aliases, previousNames };
      if (parsed.data.action === "edit") {
        if (parsed.data.originServer !== undefined) {
          const entered = parseServerId(parsed.data.originServer);
          // Saving the captured value unchanged leaves the capture in charge; any
          // other value, blank included, is an officer correction that outranks it.
          changes.originServer = entered === (member.gameProfile?.originServer ?? null) ? undefined : entered;
        }
        if (parsed.data.transferredTo !== undefined) changes.transferredTo = parseServerId(parsed.data.transferredTo) ?? undefined;
        const heroPower = parseMemberStat(parsed.data.heroPower);
        const kills = parseMemberStat(parsed.data.kills);
        const current = memberStats(member);
        const power = parsed.data.power === undefined ? current.power : parseMemberStat(parsed.data.power);
        const profession = parsed.data.profession === undefined ? current.profession : parsed.data.profession || null;
        if (heroPower !== current.heroPower || kills !== current.kills || power !== current.power || profession !== current.profession) {
          changes.manualStats = {
            ...member.manualStats,
            ...(power !== current.power ? { power } : {}),
            ...(heroPower !== current.heroPower ? { heroPower } : {}),
            ...(kills !== current.kills ? { kills } : {}),
            ...(profession !== current.profession ? { profession } : {}),
            updatedAt: new Date().toISOString(),
          };
        }
      }
      return NextResponse.json(await setState({ ...state, members: state.members.map((item) => item.id === memberId ? { ...item, ...changes } : item) }));
    }
    const merged = mergeMemberIdentities(state, parsed.data.primaryId, parsed.data.duplicateId, parsed.data.keepEntries);
    return NextResponse.json(await setState(merged));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save player changes." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const memberId = new URL(request.url).searchParams.get("id");
  if (!memberId) return NextResponse.json({ error: "Choose a member to remove." }, { status: 400 });
  const parsed = z.object({ version: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Refresh the roster before deleting a player." }, { status: 400 });
  try {
    const state = await getState();
    if (parsed.data.version !== state.version) throw new StateConflictError();
    if (!state.members.some((member) => member.id === memberId)) return NextResponse.json({ error: "This player no longer exists. Refresh the roster." }, { status: 404 });
    return NextResponse.json(await setState(removeMemberFromRoster(state, memberId)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove member." }, { status: error instanceof StateConflictError ? 409 : 400 });
  }
}
