import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionValue, sessionCookie } from "@/lib/auth";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { passcode?: string };
  const expected = process.env.OFFICER_PASSCODE;
  const localBypass = process.env.NODE_ENV !== "production" && !expected;
  if (!localBypass && (!body.passcode || !expected || !equal(body.passcode, expected))) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie.name, createSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionCookie.maxAge,
  });
  return response;
}
