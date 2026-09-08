import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_STATE } from "@/lib/seed";

vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/store", () => ({
  getState: vi.fn(), setState: vi.fn(),
  StateConflictError: class extends Error {},
}));
import { isAdmin } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { PUT } from "./route";

const alliance = { name: "Phoenix Guard", tag: "PHNX", server: "1234" };
function request(body: unknown = { alliance, version: 1 }) {
  return new Request("http://localhost/api/alliance", { method: "PUT", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue(structuredClone(INITIAL_STATE));
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("alliance settings access and preservation", () => {
  it("saves a custom emblem and permits restoring the default", async () => {
    const emblem = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
    const custom = await PUT(request({ alliance: { ...alliance, emblem }, version: 1 }));
    expect(custom.status).toBe(200);
    expect((await custom.json()).alliance.emblem).toBe(emblem);
    const reset = await PUT(request({ alliance: { ...alliance, emblem: null }, version: 1 }));
    expect(reset.status).toBe(200);
    expect((await reset.json()).alliance.emblem).toBeNull();
  });

  it("rejects remote images, SVGs and oversized emblems", async () => {
    for (const emblem of ["https://example.com/badge.png", "data:image/svg+xml;base64,PHN2Zz4=", `data:image/png;base64,iVBORw0KGgo${"A".repeat(260_000)}`]) {
      expect((await PUT(request({ alliance: { ...alliance, emblem }, version: 1 }))).status).toBe(400);
    }
    expect(setState).not.toHaveBeenCalled();
  });

  it("requires officer access before reading or writing state", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect((await PUT(request())).status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });

  it("rejects invalid identity and stale edits without writing", async () => {
    expect((await PUT(request({ alliance: { ...alliance, server: "wrong" }, version: 1 }))).status).toBe(400);
    expect((await PUT(request({ alliance, version: 2 }))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });

  it("changes only identity and preserves member IDs, history and operations", async () => {
    const response = await PUT(request());
    expect(response.status).toBe(200);
    expect(setState).toHaveBeenCalledWith({ ...INITIAL_STATE, alliance });
    const saved = await response.json();
    expect(saved.members).toEqual(INITIAL_STATE.members);
    expect(saved.snapshots).toEqual(INITIAL_STATE.snapshots);
    expect(saved.operations).toEqual(INITIAL_STATE.operations);
    expect(saved.alliance).toEqual(alliance);
  });
});
