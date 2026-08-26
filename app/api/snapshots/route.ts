import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { dayLabelFor, matchMember, normalizeName, weekStartFor } from "@/lib/tracker";
import type { Member, RankingEntry, Snapshot } from "@/lib/types";

const schema = z.object({
  snapshotId: z.string().optional(),
  capturedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["live", "final"]),
  sourceType: z.enum(["screenshots", "video", "manual"]).default("screenshots"),
  notes: z.string().max(600).optional(),
  rows: z.array(z.object({
    id: z.string().optional(),
    memberId: z.string().optional(),
    rank: z.number().int().positive(),
    displayName: z.string().min(1).max(100),
    points: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).default(1),
    sourceFile: z.string().optional(),
    needsReview: z.boolean().optional(),
  })).min(1).max(150),
});

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const ranks = parsed.data.rows.map((row) => row.rank);
  if (new Set(ranks).size !== ranks.length) {
    return NextResponse.json({ error: "Every row must have a unique rank." }, { status: 400 });
  }

  try {
    const state = await getState();
    const members = [...state.members];
    const entries: RankingEntry[] = parsed.data.rows
      .sort((a, b) => a.rank - b.rank)
      .map((row) => {
        let member = row.memberId ? members.find((item) => item.id === row.memberId) : matchMember(row.displayName, members);
        if (!member) {
          member = {
            id: crypto.randomUUID(),
            canonicalName: row.displayName,
            aliases: [],
            active: true,
            joinedAt: parsed.data.capturedDate,
          } satisfies Member;
          members.push(member);
        } else if (
          normalizeName(member.canonicalName) !== normalizeName(row.displayName) &&
          !member.aliases.some((alias) => normalizeName(alias) === normalizeName(row.displayName))
        ) {
          member.aliases.push(row.displayName);
        }
        return {
          id: row.id || crypto.randomUUID(),
          memberId: member.id,
          rank: row.rank,
          displayName: row.displayName,
          points: row.points,
          confidence: row.confidence,
          sourceFile: row.sourceFile,
          needsReview: row.needsReview,
        };
      });

    const existing = parsed.data.snapshotId
      ? state.snapshots.find((snapshot) => snapshot.id === parsed.data.snapshotId)
      : undefined;
    const snapshot: Snapshot = {
      id: existing?.id || crypto.randomUUID(),
      capturedAt: `${parsed.data.capturedDate}T12:00:00.000Z`,
      weekStart: weekStartFor(parsed.data.capturedDate),
      dayLabel: dayLabelFor(parsed.data.capturedDate),
      status: parsed.data.status,
      sourceType: parsed.data.sourceType,
      notes: parsed.data.notes,
      entries,
    };
    const snapshots = existing
      ? state.snapshots.map((item) => (item.id === snapshot.id ? snapshot : item))
      : [...state.snapshots, snapshot];
    const next = await setState({ ...state, members, snapshots });
    return NextResponse.json({ state: next, snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not publish this snapshot." }, { status: 409 });
  }
}
