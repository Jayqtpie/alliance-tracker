import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/login-rate-limit", () => ({ loginRetryAfter: vi.fn(() => 0) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { loginRetryAfter } from "@/lib/login-rate-limit";
import { cookies } from "next/headers";
import { createSessionValue, getAccessRole, isAdmin, isAuthenticated, sessionRole } from "./auth";
import { POST } from "@/app/api/auth/login/route";

beforeEach(() => {
  vi.stubEnv("OFFICER_PASSCODE", "test1");
  vi.stubEnv("VIEWER_PASSCODE", "rscl1");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("password-based access", () => {
  it.each([["test1", "admin"], ["rscl1", "viewer"]] as const)("assigns the signed role for %s", async (passcode, role) => {
    const response = await POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ passcode, role: "admin" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, role });
    expect(sessionRole(response.cookies.get("rscl_officer")?.value)).toBe(role);
  });
  it.each(["wrong", 123, null])("rejects invalid passwords (%s)", async (passcode) => {
    const response = await POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ passcode }) }));
    expect(response.status).toBe(401);
    expect(response.cookies.get("rscl_officer")).toBeUndefined();
  });
  it.each(["admin", "viewer"] as const)("enforces %s permissions from the cookie", async (role) => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: createSessionValue(role) }) } as unknown as Awaited<ReturnType<typeof cookies>>);
    expect(await getAccessRole()).toBe(role);
    expect(await isAuthenticated()).toBe(true);
    expect(await isAdmin()).toBe(role === "admin");
  });
  it("rejects missing, expired, invalid-role and tampered sessions", () => {
    expect(sessionRole()).toBeNull();
    const token = createSessionValue("viewer");
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), role: "admin" })).toString("base64url");
    expect(sessionRole(`${forged}.${signature}`)).toBeNull();
    for (const fields of [{ exp: 1, role: "admin" }, { exp: Date.now() + 10000, role: "unknown" }]) {
      const encoded = Buffer.from(JSON.stringify(fields)).toString("base64url");
      const signed = createHmac("sha256", "test-session-secret-at-least-32-characters").update(encoded).digest("base64url");
      expect(sessionRole(`${encoded}.${signed}`)).toBeNull();
    }
  });
});

function login(passcode: unknown) {
  return POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ passcode }) }));
}

describe("authentication security regressions", () => {
  it.each(["", "short", "replace-with-a-long-random-string"])("fails closed with invalid signing configuration (%s)", async (key) => {
    vi.stubEnv("SESSION_SECRET", key);
    expect(sessionRole("forged.signature")).toBeNull();
    expect(() => createSessionValue()).toThrow("not configured");
    expect((await login("test1")).status).toBe(503);
  });
  it("disables an absent viewer password and rejects built-in defaults", async () => {
    vi.stubEnv("VIEWER_PASSCODE", "");
    expect((await login("rscl1")).status).toBe(401);
    vi.stubEnv("OFFICER_PASSCODE", "");
    expect((await login("test1")).status).toBe(503);
  });
  it("rejects oversized or identical role passwords", async () => {
    vi.stubEnv("OFFICER_PASSCODE", "x".repeat(257));
    expect((await login("x".repeat(257))).status).toBe(401);
    vi.stubEnv("OFFICER_PASSCODE", "rscl1");
    expect((await login("rscl1")).status).toBe(503);
  });
  it("rejects extra segments, malformed payloads, missing roles, and non-finite expiry", () => {
    const token = createSessionValue("admin");
    expect(sessionRole(`${token}.extra`)).toBeNull();
    for (const raw of ['null', '[]', '{"exp":1e999,"role":"admin"}', JSON.stringify({ exp: Date.now() + 10000 })]) {
      const payload = Buffer.from(raw).toString("base64url");
      const signature = createHmac("sha256", "test-session-secret-at-least-32-characters").update(payload).digest("base64url");
      expect(sessionRole(`${payload}.${signature}`)).toBeNull();
    }
  });
  it("bounds actual body bytes even without Content-Length", async () => {
    const response = await login("x".repeat(3000));
    expect(response.status).toBe(413);
    expect(response.cookies.get("rscl_officer")).toBeUndefined();
  });
});

it("returns a rate-limit response without creating a session", async () => {
  vi.mocked(loginRetryAfter).mockReturnValue(42);
  const response = await login("test1");
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("42");
  expect(response.cookies.get("rscl_officer")).toBeUndefined();
});
