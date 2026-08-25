import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getState } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json(await getState());
}
