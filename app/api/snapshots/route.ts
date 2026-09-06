import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { dayLabelFor, matchMember, normalizeName, weekStartFor } from "@/lib/tracker";
import type { Member, RankingEntry, Snapshot } from "@/lib/types";
import { verificationBlocker } from "@/lib/review";

const schema = z.object({
  snapshotId: z.string().optional(),
  capturedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["live", "final"]),
  sourceType: z.enum(["screenshots", "video", "local-codex", "manual"]).default("screenshots"),
  notes: z.string().max(600).optional(),
  rows: z.array(z.object({
    id: z.string().optional(),
    memberId: z.string().optional(),
    createMember: z.boolean().optional(),
    rank: z.number().int().positive(),
    displayName: z.string().min(1).max(100),
    points: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).default(1),
    sourceFile: z.string().optional(),
    needsReview: z.boolean().optional(),
    reviewed: z.boolean().optional(),
    confirmReturned: z.boolean().optional(),
  })).min(1).max(150),
});

const snapshotIdSchema = z.string().min(1).max(100);

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
    const existing = parsed.data.snapshotId
      ? state.snapshots.find((snapshot) => snapshot.id === parsed.data.snapshotId)
      : undefined;
    if (parsed.data.snapshotId && !existing) {
      return NextResponse.json({ error: "This snapshot no longer exists. Refresh before making corrections." }, { status: 404 });
    }
    const members = state.members.map((member) => ({ ...member, aliases: [...member.aliases] }));
    for (const row of parsed.data.rows) {
      if (row.reviewed) {
        const blocker = verificationBlocker(row, parsed.data.rows, members);
        if (blocker) throw new Error(`Rank ${row.rank}: ${blocker}`);
      }
    }
    const entries: RankingEntry[] = parsed.data.rows
      .sort((a, b) => a.rank - b.rank)
      .map((row) => {
        let member = row.memberId ? members.find((item) => item.id === row.memberId) : row.createMember ? undefined : matchMember(row.displayName, members);
        if (row.memberId && !member) throw new Error(`Rank ${row.rank}: the selected member no longer exists. Refresh and choose their roster identity again.`);
        if (!member) {
          if (!row.createMember) throw new Error(`Rank ${row.rank} (${row.displayName}): choose an existing roster member or explicitly confirm a new member.`);
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
        if (row.confirmReturned) {
          member.active = true;
          delete member.leftAt;
        }
        return {
          id: row.id || crypto.randomUUID(),
          memberId: member.id,
          rank: row.rank,
          displayName: row.displayName,
          points: row.points,
          confidence: row.confidence,
          sourceFile: row.sourceFile,
          needsReview: row.reviewed ? false : row.needsReview,
          ...(row.reviewed !== undefined ? { reviewed: row.reviewed } : {}),
        };
      });

    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      return NextResponse.json({ error: "Every row must have a unique entry ID." }, { status: 400 });
    }
    const duplicateEntries = entries.filter((entry) => entries.some((other) => other !== entry && other.memberId === entry.memberId));
    // Legacy captures may already contain duplicated identities. Permit a
    // correction elsewhere, but never introduce a new row into such a group.
    if (duplicateEntries.some((entry) => !existing?.entries.some((prior) => prior.id === entry.id && prior.memberId === entry.memberId))) {
      return NextResponse.json({ error: "The same member is linked to more than one rank. Correct or remove the duplicate row before publishing." }, { status: 400 });
    }

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

export async function DELETE(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsedId = snapshotIdSchema.safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsedId.success) return NextResponse.json({ error: "A valid snapshot ID is required." }, { status: 400 });

  try {
    const state = await getState();
    const snapshot = state.snapshots.find((item) => item.id === parsedId.data);
    if (!snapshot) return NextResponse.json({ error: "This snapshot no longer exists." }, { status: 404 });

    const next = await setState({
      ...state,
      snapshots: state.snapshots.filter((item) => item.id !== snapshot.id),
    });
    return NextResponse.json({ state: next, deletedSnapshot: snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete this snapshot." }, { status: 409 });
  }
}
