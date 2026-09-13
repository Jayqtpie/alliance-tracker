import { NextResponse } from "next/server";
import { getAccessRole } from "@/lib/auth";
import { getState } from "@/lib/store";

import { stateForRole } from "@/lib/state-view";

export const runtime = "nodejs";

export async function GET() {
  const role = await getAccessRole();
  if (!role) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json(stateForRole(await getState(), role), { headers: { "Cache-Control": "private, no-store" } });
}
