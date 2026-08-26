import { NextResponse } from "next/server";
import { z } from "zod";
import { isBridgeWorker } from "@/lib/bridge-auth";
import { claimNextBridgeJob } from "@/lib/bridge";
import { mutateBridgeQueue } from "@/lib/bridge-store";
import { dedupeRows } from "@/lib/tracker";

export const runtime = "nodejs";

const rowSchema = z.object({
  rank: z.number().int().positive(),
  displayName: z.string().min(1).max(100),
  points: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  isPinned: z.boolean().optional(),
  sourceFile: z.string().max(180).optional(),
  needsReview: z.boolean().optional(),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), workerId: z.string().min(1).max(100) }),
  z.object({ action: z.literal("complete"), jobId: z.string().uuid(), workerId: z.string().min(1).max(100), rows: z.array(rowSchema).min(1).max(300) }),
  z.object({ action: z.literal("fail"), jobId: z.string().uuid(), workerId: z.string().min(1).max(100), error: z.string().min(1).max(500) }),
]);

export async function POST(request: Request) {
  if (!isBridgeWorker(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  try {
    const action = parsed.data;
    if (action.action === "claim") {
      const claimed = await mutateBridgeQueue((jobs) => claimNextBridgeJob(jobs, action.workerId));
      return claimed ? NextResponse.json({ job: claimed }) : new NextResponse(null, { status: 204 });
    }

    if (action.action === "complete") {
      const rows = dedupeRows(action.rows).rows;
      const job = await mutateBridgeQueue((jobs) => {
        const current = jobs.find((item) => item.id === action.jobId);
        if (!current) throw new Error("Bridge job not found.");
        if (current.status !== "processing" || current.workerId !== action.workerId) throw new Error("This worker no longer owns the job.");
        current.status = "completed";
        current.updatedAt = new Date().toISOString();
        current.leaseExpiresAt = undefined;
        current.completedAt = current.updatedAt;
        current.rows = rows;
        current.error = undefined;
        return current;
      });
      return NextResponse.json({ job });
    }

    const job = await mutateBridgeQueue((jobs) => {
      const current = jobs.find((item) => item.id === action.jobId);
      if (!current) throw new Error("Bridge job not found.");
      if (current.status !== "processing" || current.workerId !== action.workerId) throw new Error("This worker no longer owns the job.");
      current.status = "failed";
      current.updatedAt = new Date().toISOString();
      current.leaseExpiresAt = undefined;
      current.error = action.error;
      return current;
    });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the bridge job." }, { status: 409 });
  }
}
