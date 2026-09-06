import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";

vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn(), StateConflictError: class extends Error {} }));
import { isAuthenticated } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";
import { PATCH } from "./route";

function request(body: unknown = { primaryId: "keep", duplicateId: "duplicate", version: 1 }) {
  return new Request("http://localhost/api/members", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAuthenticated).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members: [
    { id: "keep", canonicalName: "Alpha", active: true, aliases: [] },
    { id: "duplicate", canonicalName: "A1pha", active: true, aliases: [] },
  ] });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("member merge API", () => {
  it("requires officer access before any state access", async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false);
    expect((await PATCH(request())).status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });
  it("persists the merged roster and returns fresh state", async () => {
    const response = await PATCH(request());
    expect(response.status).toBe(200);
    expect((await response.json()).members).toEqual([{ id: "keep", canonicalName: "Alpha", active: true, aliases: ["A1pha"] }]);
    expect(setState).toHaveBeenCalledOnce();
  });
  it("rejects invalid or stale previews without writing", async () => {
    for (const body of [{ primaryId: "keep", duplicateId: "duplicate" }, { primaryId: "keep", duplicateId: "keep", version: 1 }, { primaryId: "keep", duplicateId: "missing", version: 1 }]) {
      expect((await PATCH(request(body))).status).toBe(400);
    }
    expect((await PATCH(request({ primaryId: "keep", duplicateId: "duplicate", version: 2 }))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });
  it("reports concurrent storage conflicts", async () => {
    vi.mocked(setState).mockRejectedValue(new StateConflictError());
    expect((await PATCH(request())).status).toBe(409);
  });
});
