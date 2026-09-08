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

export type AccessRole = "admin" | "viewer";

export function createSessionValue(role: AccessRole = "admin") {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_SECONDS * 1000, role })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifySessionValue(value?: string) {
  return sessionRole(value) !== null;
}

export function sessionRole(value?: string): AccessRole | null {
  if (!value) return null;
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  if (Buffer.byteLength(expected) !== Buffer.byteLength(supplied)) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp <= Date.now()) return null;
    // Existing signed officer sessions retain admin access.
    if (parsed.role === undefined || parsed.role === "admin") return "admin";
    return parsed.role === "viewer" ? "viewer" : null;
  } catch {
    return null;
  }
}

export async function getAccessRole() {
  const jar = await cookies();
  return sessionRole(jar.get(COOKIE_NAME)?.value);
}

export async function isAuthenticated() {
  return (await getAccessRole()) !== null;
}

export async function isAdmin() {
  return (await getAccessRole()) === "admin";
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_SECONDS,
};
