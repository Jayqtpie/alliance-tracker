import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";

vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn(), StateConflictError: class extends Error {} }));
import { isAdmin } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { PUT } from "./route";

const members = [
  { id: "a", canonicalName: "Alpha", active: true, aliases: [] },
  { id: "b", canonicalName: "Bravo", active: false, aliases: [] },
];

function request(body: unknown) {
  return new Request("http://localhost/api/svs", { method: "PUT", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members, version: 1 });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("SvS attendance API", () => {
  it("requires officer access and never reads state for a non-admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    const response = await PUT(request({ events: [], version: 1 }));
    expect(response.status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
  });

  it("rejects a stale version", async () => {
    const response = await PUT(request({ events: [], version: 2 }));
    expect(response.status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });

  it("saves valid events, including members who have since left", async () => {
    const events = [{ id: "e1", date: "2026-09-19", label: "vs #931", attendance: { a: "present", b: "excused" } }];
    const response = await PUT(request({ events, version: 1 }));
    expect(response.status).toBe(200);
    expect((await response.json()).svsEvents).toEqual(events);
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ svsEvents: events }));
  });

  it("rejects a member id that no longer exists", async () => {
    const response = await PUT(request({ events: [{ id: "e1", date: "2026-09-19", attendance: { ghost: "present" } }], version: 1 }));
    expect(response.status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects duplicate event ids, bad dates and unknown states", async () => {
    const bad = [
      [{ id: "e1", date: "2026-09-19", attendance: {} }, { id: "e1", date: "2026-09-20", attendance: {} }],
      [{ id: "e1", date: "19/09/2026", attendance: {} }],
      [{ id: "e1", date: "2026-09-19", attendance: { a: "late" } }],
    ];
    for (const events of bad) expect((await PUT(request({ events, version: 1 }))).status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });
});
