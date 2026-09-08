import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { cookies } from "next/headers";
import { createSessionValue, getAccessRole, isAdmin, isAuthenticated, sessionRole } from "./auth";
import { POST } from "@/app/api/auth/login/route";

beforeEach(() => {
  vi.stubEnv("OFFICER_PASSCODE", "test1");
  vi.stubEnv("VIEWER_PASSCODE", "rscl1");
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("password-based access", () => {
  it.each([["test1", "admin"], ["rscl1", "viewer"]] as const)("assigns the signed role for %s", async (passcode, role) => {
    const response = await POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ passcode, role: "admin" }) }));
    expect(response.status).toBe(200);
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
      const signed = createHmac("sha256", "test-session-secret").update(encoded).digest("base64url");
      expect(sessionRole(`${encoded}.${signed}`)).toBeNull();
    }
  });
});
