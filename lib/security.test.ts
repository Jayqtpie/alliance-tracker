import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "./alliance";
import { csvCell } from "./csv";
import { rankGaps } from "./rank-gaps";
import { dedupeRows, analyzeImport } from "./tracker";
import { allowedRequestOrigin } from "./request-security";
vi.mock("server-only", () => ({}));
import { stateForRole } from "./state-view";
import { loginRetryAfter } from "./login-rate-limit";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());

describe("security boundaries", () => {
  it("keeps officer data out of viewer JSON and preserves source/history", () => {
    const state = createEmptyState();
    state.members = [{ id: "a", canonicalName: "雨", aliases: ["Cloud"], active: true, notes: "PRIVATE NOTE" }];
    state.uploads = [{ id: "f", name: "PRIVATE FILE", storagePath: "PRIVATE PATH", uploadedAt: "now", expiresAt: "later" }];
    state.operations!.guardianPool = ["PRIVATE OPERATION"];
    state.snapshots = [{ id: "s", capturedAt: "date", weekStart: "week", dayLabel: "day", status: "live", sourceType: "manual", notes: "PRIVATE SNAPSHOT", createdBy: "PRIVATE AUTHOR", entries: [{ id: "r", memberId: "a", rank: 1, displayName: "雨", points: 0, confidence: 1, sourceFile: "PRIVATE SOURCE" }] }];
    const before = structuredClone(state);
    const viewer = stateForRole(state, "viewer");
    expect(JSON.stringify(viewer)).not.toContain("PRIVATE");
    expect(viewer.members[0].canonicalName).toBe("雨");
    expect(viewer.snapshots[0].entries[0].points).toBe(0);
    expect(stateForRole({ ...state, svsEvents: [{ id: "e", date: "2026-09-19", attendance: { a: "present" } }] }, "viewer").svsEvents)
      .toEqual([{ id: "e", date: "2026-09-19", attendance: { a: "present" } }]);
    expect(state).toEqual(before);
    expect(stateForRole(state, "admin")).toBe(state);
  });
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "  =1", "\t=1", "\r=1", "\n=1", "\u0000=1"])("exports literal text for %s", (text) => {
    expect(csvCell(text)).toBe(`"'${text.replaceAll('"', '""')}"`);
  });
  it("preserves Unicode, CSV quoting and numeric deltas", () => {
    expect(csvCell('雨, "Cloud"')).toBe('"雨, ""Cloud"""');
    expect(csvCell(-12)).toBe("-12");
  });
  it.each([1_000_000_000, Number.MAX_SAFE_INTEGER])("bounds both processing paths at rank %s", (rank) => {
    const rows = [{ rank, displayName: "Alpha", points: 1, confidence: 1 }];
    expect(dedupeRows(rows).rows).toEqual(rows);
    expect(dedupeRows(rows).warnings.length).toBeLessThanOrEqual(151);
    expect(analyzeImport(rows, []).join("").length).toBeLessThan(500);
    expect(rankGaps([rank], 12).total).toBe(rank - 1);
  });
  it("keeps ordinary gap warnings", () => {
    expect(rankGaps([1, 3, 3, 5], 12)).toEqual({ missing: [2, 4], total: 2 });
    expect(dedupeRows([{ rank: 2, displayName: "Alpha", points: 1, confidence: 1 }]).warnings).toEqual(["Rank 1 is missing from this import."]);
    expect(() => dedupeRows([{ rank: Infinity, displayName: "Alpha", points: 1, confidence: 1 }])).toThrow();
  });
  it("rejects foreign and same-site sibling origins; keeps normal browser and worker calls", () => {
    const req = (headers: HeadersInit) => new Request("https://tracker.example/api/members", { headers });
    expect(allowedRequestOrigin(req({ origin: "https://attacker.example" }))).toBe(false);
    expect(allowedRequestOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(allowedRequestOrigin(req({ origin: "null" }))).toBe(false);
    expect(allowedRequestOrigin(req({ origin: "https://tracker.example", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(allowedRequestOrigin(req({ authorization: "Bearer test-worker" }))).toBe(true);
    expect(allowedRequestOrigin(new Request("http://localhost:3219/api/auth/login", { headers: { host: "127.0.0.1:3219", origin: "http://127.0.0.1:3219" } }))).toBe(true);
    expect(allowedRequestOrigin(req({ host: "tracker.example", origin: "https://attacker.example", "x-forwarded-host": "attacker.example" }))).toBe(false);
  });
  it("limits attempts despite spoofed local forwarding headers, then resets after the window", () => {
    vi.stubEnv("VERCEL", "");
    const req = (i: number) => new Request("http://localhost/api/auth/login", { headers: { "x-forwarded-for": `192.0.2.${i}`, "x-vercel-forwarded-for": `192.0.2.${i}` } });
    for (let i = 0; i < 10; i++) expect(loginRetryAfter(req(i), 1000)).toBe(0);
    expect(loginRetryAfter(req(11), 1000)).toBe(300);
    expect(loginRetryAfter(req(12), 301000)).toBe(0);
  });
  it("sets a fresh script nonce and blocks cross-origin API requests", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("https://tracker.example/login"));
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("'nonce-");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(proxy(new NextRequest("https://tracker.example/login")).headers.get("Content-Security-Policy")).not.toBe(csp);
    expect(proxy(new NextRequest("https://tracker.example/api/members", { method: "PUT", headers: { origin: "https://attacker.example" } })).status).toBe(403);
  });
});
