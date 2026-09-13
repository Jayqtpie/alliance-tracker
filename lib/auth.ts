import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "rscl_officer";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.SESSION_SECRET;
  return value && value.length >= 32 && value !== "replace-with-a-long-random-string" ? value : null;
}

function signature(payload: string) {
  const key = secret();
  if (!key) throw new Error("Sign-in is not configured.");
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function authenticationConfigured() {
  return secret() !== null;
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
  if (!value || value.length > 1024 || !secret() || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  if (Buffer.byteLength(expected) !== Buffer.byteLength(supplied)) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !Number.isSafeInteger(parsed.exp) || parsed.exp <= Date.now()) return null;
    if (parsed.role === "admin") return "admin";
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
