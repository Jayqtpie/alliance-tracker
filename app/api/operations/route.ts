import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getState, setState } from "@/lib/store";

const participantSchema = z.object({
  memberId: z.string().min(1),
  availability: z.enum(["no-response", "available", "maybe", "unavailable"]),
  role: z.enum(["unassigned", "starter", "substitute", "reserve"]),
  confirmed: z.boolean(),
  assignment: z.string().max(120).optional(),
  attendance: z.enum(["unknown", "attended", "no-show", "late-cancel", "substitute-used"]),
  score: z.number().int().nonnegative().optional(),
  notes: z.string().max(300).optional(),
});

const stormSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["desert", "canyon"]),
  team: z.enum(["A", "B"]),
  battleAt: z.string().min(1),
  registrationDeadline: z.string().optional(),
  status: z.enum(["draft", "registration-open", "locked", "completed", "cancelled"]),
  starterLimit: z.number().int().min(1).max(50),
  substituteLimit: z.number().int().min(0).max(50),
  officerNotes: z.string().max(1000).optional(),
  opponent: z.string().max(100).optional(),
  result: z.enum(["unknown", "win", "loss", "draw"]).optional(),
  allianceScore: z.number().int().nonnegative().optional(),
  opponentScore: z.number().int().nonnegative().optional(),
  participants: z.array(participantSchema).max(150),
});

const trainSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conductorMemberId: z.string().optional(),
  vipType: z.enum(["none", "guardian-defender", "special-guest"]),
  vipMemberId: z.string().optional(),
  backupMemberId: z.string().optional(),
  invitationStatus: z.enum(["not-sent", "pending", "accepted", "declined", "expired"]),
  status: z.enum(["planned", "completed", "reassigned", "skipped"]),
  notes: z.string().max(500).optional(),
});

const schema = z.object({
  stormEvents: z.array(stormSchema).max(250),
  guardianPool: z.array(z.string().min(1)).max(7),
  trainAssignments: z.array(trainSchema).max(1000),
});

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid operations data." }, { status: 400 });
  if (new Set(parsed.data.guardianPool).size !== parsed.data.guardianPool.length) {
    return NextResponse.json({ error: "Each Guardian Pool position must use a different member." }, { status: 400 });
  }
  try {
    const state = await getState();
    return NextResponse.json(await setState({ ...state, operations: parsed.data }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save operations." }, { status: 409 });
  }
}
