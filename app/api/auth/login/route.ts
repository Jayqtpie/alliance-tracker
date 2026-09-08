import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionValue, sessionCookie } from "@/lib/auth";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { passcode?: unknown } | null;
  const expected = process.env.OFFICER_PASSCODE || (process.env.NODE_ENV !== "production" ? "test1" : undefined);
  const viewerPasscode = process.env.VIEWER_PASSCODE || "rscl1";
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";
  const role = passcode && expected && equal(passcode, expected) ? "admin" : passcode && equal(passcode, viewerPasscode) ? "viewer" : null;
  if (!role) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(sessionCookie.name, createSessionValue(role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionCookie.maxAge,
  });
  return response;
}
