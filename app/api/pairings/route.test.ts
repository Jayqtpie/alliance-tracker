import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";

vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn(), StateConflictError: class extends Error {} }));
import { isAdmin } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { PUT } from "./route";

const statAt = "2026-01-01T00:00:00Z";
const members = [
  { id: "wl1", canonicalName: "WL One", active: true, aliases: [], manualStats: { profession: "War Leader", updatedAt: statAt } },
  { id: "eng1", canonicalName: "Eng One", active: true, aliases: [], manualStats: { profession: "Engineer", updatedAt: statAt } },
  { id: "eng2", canonicalName: "Eng Two", active: true, aliases: [], manualStats: { profession: "Engineer", updatedAt: statAt } },
  { id: "inactive-wl", canonicalName: "Inactive WL", active: false, aliases: [], manualStats: { profession: "War Leader", updatedAt: statAt } },
];

function request(body: unknown) {
  return new Request("http://localhost/api/pairings", { method: "PUT", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members, version: 1 });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("pairings API", () => {
  it("requires officer access and never reads state for a non-admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    const response = await PUT(request({ rows: [], version: 1 }));
    expect(response.status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects a stale version", async () => {
    const response = await PUT(request({ rows: [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }], version: 2 }));
    expect(response.status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });

  it("saves a valid payload and returns the full state", async () => {
    const rows = [{ id: "pair-1", warLeaderId: "wl1", engineerId: "eng1" }, { id: "pair-2", engineerId: "eng2" }];
    const response = await PUT(request({ rows, version: 1 }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.pairings).toEqual(rows);
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ pairings: rows }));
  });

  it("accepts a warLeaderId that points at an Engineer (intended role may differ from profession)", async () => {
    const response = await PUT(request({ rows: [{ id: "pair-1", warLeaderId: "eng1" }], version: 1 }));
    expect(response.status).toBe(200);
    expect(setState).toHaveBeenCalled();
  });

  it("rejects an id pointing at an inactive member", async () => {
    const response = await PUT(request({ rows: [{ id: "pair-1", warLeaderId: "inactive-wl" }], version: 1 }));
    expect(response.status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects an id that does not exist", async () => {
    const response = await PUT(request({ rows: [{ id: "pair-1", warLeaderId: "ghost" }], version: 1 }));
    expect(response.status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects the same member id used in two different rows", async () => {
    const response = await PUT(request({ rows: [{ id: "pair-1", engineerId: "eng1" }, { id: "pair-2", engineerId: "eng1" }], version: 1 }));
    expect(response.status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects duplicate row ids", async () => {
    const response = await PUT(request({ rows: [{ id: "pair-1", engineerId: "eng1" }, { id: "pair-1", engineerId: "eng2" }], version: 1 }));
    expect(response.status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await PUT(request({ rows: [] }));
    expect(response.status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });
});
