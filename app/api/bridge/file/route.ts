import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { isBridgeWorker } from "@/lib/bridge-auth";
import { blobToken } from "@/lib/blob";
import { getBridgeQueue } from "@/lib/bridge-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isBridgeWorker(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const fileId = url.searchParams.get("fileId");
  const queue = await getBridgeQueue();
  const job = queue.jobs.find((item) => item.id === jobId);
  const file = job?.files.find((item) => item.id === fileId);
  if (!job || !file) return NextResponse.json({ error: "Bridge file not found" }, { status: 404 });
  const result = await get(file.pathname, { access: "private", useCache: false, token: blobToken() });
  if (!result || result.statusCode !== 200) return NextResponse.json({ error: "Bridge file is unavailable" }, { status: 404 });
  return new Response(result.stream, {
    headers: {
      "content-type": result.blob.contentType,
      "content-length": String(result.blob.size),
      "cache-control": "private, no-store",
    },
  });
}
