import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { removeExpiredBridgeJobs } from "@/lib/bridge-store";
import { getState, setState } from "@/lib/store";
import { removeUploads } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorised = secret ? request.headers.get("authorization") === `Bearer ${secret}` : await isAdmin();
  if (!authorised) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const state = await getState();
  const now = Date.now();
  const expired = state.uploads.filter((upload) => new Date(upload.expiresAt).getTime() <= now);
  await removeUploads(expired);
  // Most days nothing has expired; skip the write rather than spend a storage operation on it.
  const next = expired.length ? await setState({
    ...state,
    uploads: state.uploads.filter((upload) => !expired.some((item) => item.id === upload.id)),
  }) : state;
  const bridgeJobsDeleted = await removeExpiredBridgeJobs(now);
  return NextResponse.json({ deleted: expired.length, remaining: next.uploads.length, bridgeJobsDeleted });
}
