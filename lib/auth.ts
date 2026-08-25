import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "rscl_officer";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  return process.env.SESSION_SECRET || "local-development-only-secret";
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionValue() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifySessionValue(value?: string) {
  if (!value) return false;
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) return false;
  const expected = signature(payload);
  if (expected.length !== supplied.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export async function isAuthenticated() {
  if (process.env.NODE_ENV !== "production" && !process.env.OFFICER_PASSCODE) return true;
  const jar = await cookies();
  return verifySessionValue(jar.get(COOKIE_NAME)?.value);
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_SECONDS,
};
