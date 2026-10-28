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

const board = (slots: (string | null)[], extra: Record<string, unknown> = {}) => ({
  mode: "balanced", squads: [{ id: "squad-1", slots }], pinned: [], unavailable: [], ...extra,
});

function request(body: unknown) {
  return new Request("http://localhost/api/rally-squads", { method: "PUT", body: JSON.stringify(body) });
}

async function expectRejected(body: unknown, status = 400) {
  const response = await PUT(request(body));
  expect(response.status).toBe(status);
  expect(setState).not.toHaveBeenCalled();
  return response;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members, version: 1 });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("rally squads API", () => {
  it("requires officer access and never reads state for a non-admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expectRejected({ board: board(["wl1", null, null, null, null]), version: 1 }, 401);
    expect(getState).not.toHaveBeenCalled();
  });

  it("rejects a stale version", async () => {
    await expectRejected({ board: board(["wl1", null, null, null, null]), version: 2 }, 409);
  });

  it("saves a valid board and returns the full state", async () => {
    const saved = board(["wl1", "eng1", null, null, null], { pinned: ["eng1"], unavailable: ["eng2"] });
    const response = await PUT(request({ board: saved, version: 1 }));
    expect(response.status).toBe(200);
    expect((await response.json()).rallyBoard).toEqual(saved);
  });

  it("refuses a leader who is not a War Leader, naming them", async () => {
    const response = await expectRejected({ board: board(["eng1", null, null, null, null]), version: 1 });
    expect((await response.json()).error).toContain("Eng One");
  });

  it("rejects inactive, unknown or repeated members", async () => {
    await expectRejected({ board: board(["inactive-wl", null, null, null, null]), version: 1 });
    await expectRejected({ board: board(["wl1", "ghost", null, null, null]), version: 1 });
    await expectRejected({ board: board(["wl1", "eng1", "eng1", null, null]), version: 1 });
  });

  it("rejects a pin on someone not placed, or an unavailable member who is placed", async () => {
    await expectRejected({ board: board(["wl1", null, null, null, null], { pinned: ["eng1"] }), version: 1 });
    await expectRejected({ board: board(["wl1", "eng1", null, null, null], { unavailable: ["eng1"] }), version: 1 });
  });

  it("rejects duplicate squad ids, the wrong number of slots and a malformed body", async () => {
    await expectRejected({ board: { ...board(["wl1", null, null, null, null]), squads: [{ id: "squad-1", slots: [null, null, null, null, null] }, { id: "squad-1", slots: [null, null, null, null, null] }] }, version: 1 });
    await expectRejected({ board: board(["wl1", null, null, null]), version: 1 });
    await expectRejected({ board: board(["wl1", null, null, null, null]) });
  });
});
