import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { authenticationConfigured, createSessionValue, sessionCookie } from "@/lib/auth";
import { loginRetryAfter } from "@/lib/login-rate-limit";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function configuredPasscode(value?: string) {
  return value && value.length <= 256 ? value : undefined;
}

async function readPasscode(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof body?.passcode === "string" && body.passcode.length <= 256 ? body.passcode : "";
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const retryAfter = loginRetryAfter(request);
  if (retryAfter) return NextResponse.json({ error: "Too many sign-in attempts. Please try again later." }, {
    status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
  const expected = configuredPasscode(process.env.OFFICER_PASSCODE);
  const viewerPasscode = configuredPasscode(process.env.VIEWER_PASSCODE);
  if (!authenticationConfigured() || (!expected && !viewerPasscode) || (expected && expected === viewerPasscode)) {
    return NextResponse.json({ error: "Sign-in is not configured. Contact your administrator." }, { status: 503 });
  }
  const passcode = await readPasscode(request);
  if (passcode === null) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  const role = passcode && expected && equal(passcode, expected) ? "admin" : passcode && viewerPasscode && equal(passcode, viewerPasscode) ? "viewer" : null;
  if (!role) return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  const response = NextResponse.json({ ok: true, role }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(sessionCookie.name, createSessionValue(role), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: sessionCookie.maxAge,
  });
  return response;
}
