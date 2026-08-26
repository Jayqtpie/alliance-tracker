import { del, head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { blobToken } from "@/lib/blob";
import { bridgeJobView, retryBridgeJob } from "@/lib/bridge";
import { getBridgeQueue, mutateBridgeQueue } from "@/lib/bridge-store";
import type { BridgeJob } from "@/lib/bridge-types";

export const runtime = "nodejs";

const fileSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(180),
  pathname: z.string().min(1).max(500),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(4 * 1024 * 1024),
});
const createSchema = z.object({
  id: z.string().uuid(),
  files: z.array(fileSchema).min(1).max(25),
});
const retrySchema = z.object({ id: z.string().uuid() });

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const queue = await getBridgeQueue();
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const job = queue.jobs.find((item) => item.id === id);
    return job ? NextResponse.json({ job: bridgeJobView(job) }) : NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const jobs = [...queue.jobs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map(bridgeJobView);
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  if (parsed.data.files.some((file) => !file.pathname.startsWith(`bridge-uploads/${parsed.data.id}/`))) {
    return NextResponse.json({ error: "One or more files do not belong to this job." }, { status: 400 });
  }

  try {
    await Promise.all(parsed.data.files.map(async (file) => {
      const metadata = await head(file.pathname, { token: blobToken() });
      if (metadata.size !== file.size || metadata.contentType !== file.contentType) throw new Error(`Uploaded file verification failed for ${file.name}.`);
    }));
    const now = new Date();
    const job: BridgeJob = {
      id: parsed.data.id,
      status: "pending",
      files: parsed.data.files,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      attempts: 0,
    };
    await mutateBridgeQueue((jobs) => {
      if (jobs.some((item) => item.id === job.id)) throw new Error("This bridge job already exists.");
      jobs.push(job);
    });
    return NextResponse.json({ job: bridgeJobView(job) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not queue this capture." }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const parsed = retrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const job = await mutateBridgeQueue((jobs) => retryBridgeJob(jobs, parsed.data.id));
    return NextResponse.json({ job: bridgeJobView(job) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not retry this bridge job." }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  try {
    const files = await mutateBridgeQueue((jobs) => {
      const index = jobs.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Bridge job not found.");
      if (jobs[index].status === "processing") throw new Error("A processing job cannot be removed.");
      return jobs.splice(index, 1)[0].files;
    });
    if (files.length) await del(files.map((file) => file.pathname), { token: blobToken() });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove this bridge job." }, { status: 409 });
  }
}
