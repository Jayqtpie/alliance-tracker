import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";
import type { StormWeek } from "@/lib/types";

vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn(), StateConflictError: class extends Error {} }));
import { isAdmin } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { PUT } from "./route";

const members = [
  { id: "a", canonicalName: "Alpha", active: true, aliases: [] },
  { id: "b", canonicalName: "Bravo", active: false, aliases: [] },
];
const week = (extra: Partial<StormWeek> = {}): StormWeek => ({ id: "w", kind: "desert", date: "2026-10-02", slots: [{ memberId: "a", team: "A", role: "starter", result: "played" }], ...extra });

function request(body: unknown) {
  return new Request("http://localhost/api/storms", { method: "PUT", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members, version: 1 });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("Storm lineup API", () => {
  it("requires officer access and never reads state for a non-admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect((await PUT(request({ weeks: [], version: 1 }))).status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
  });

  it("rejects a stale version", async () => {
    expect((await PUT(request({ weeks: [week()], version: 2 }))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });

  it("saves a valid week", async () => {
    const response = await PUT(request({ weeks: [week()], version: 1 }));
    expect(response.status).toBe(200);
    expect(vi.mocked(setState).mock.calls[0][0].stormWeeks).toEqual([week()]);
  });

  it("saves each team's result, trimming the opponent, and refuses an unknown result", async () => {
    const outcomes = { A: { result: "win" as const, opponent: " [XYZ] Rivals " }, B: { result: "loss" as const } };
    expect((await PUT(request({ weeks: [week({ outcomes })], version: 1 }))).status).toBe(200);
    expect(vi.mocked(setState).mock.calls[0][0].stormWeeks![0].outcomes).toEqual({ A: { result: "win", opponent: "[XYZ] Rivals" }, B: { result: "loss" } });
    expect((await PUT(request({ weeks: [week({ outcomes: { A: { result: "draw" } } as never })], version: 1 }))).status).toBe(400);
  });

  it("refuses an over-full group, a duplicate member and an unknown member", async () => {
    const subs = Array.from({ length: 11 }, () => ({ memberId: "a", team: "A", role: "sub" }));
    expect((await PUT(request({ weeks: [week({ slots: subs as StormWeek["slots"] })], version: 1 }))).status).toBe(400);
    const twice = week({ slots: [{ memberId: "a", team: "A", role: "starter" }, { memberId: "a", team: "B", role: "sub" }] });
    expect(await (await PUT(request({ weeks: [twice], version: 1 }))).json()).toEqual({ error: "A member is in a lineup twice." });
    const ghost = week({ slots: [{ memberId: "ghost", team: "A", role: "starter" }] });
    expect((await PUT(request({ weeks: [ghost], version: 1 }))).status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("refuses to change or delete a locked week but lets it be unlocked", async () => {
    vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members, version: 1, stormWeeks: [week({ locked: true })] });
    expect((await PUT(request({ weeks: [], version: 1 }))).status).toBe(400);
    expect((await PUT(request({ weeks: [week({ locked: true, slots: [] })], version: 1 }))).status).toBe(400);
    expect((await PUT(request({ weeks: [week({ locked: false })], version: 1 }))).status).toBe(200);
  });
});
