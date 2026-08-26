import { NextResponse } from "next/server";
import { removeExpiredBridgeJobs } from "@/lib/bridge-store";
import { getState, setState } from "@/lib/store";
import { removeUploads } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const state = await getState();
  const now = Date.now();
  const expired = state.uploads.filter((upload) => new Date(upload.expiresAt).getTime() <= now);
  await removeUploads(expired);
  const next = await setState({
    ...state,
    uploads: state.uploads.filter((upload) => !expired.some((item) => item.id === upload.id)),
  });
  const bridgeJobsDeleted = await removeExpiredBridgeJobs(now);
  return NextResponse.json({ deleted: expired.length, remaining: next.uploads.length, bridgeJobsDeleted });
}
