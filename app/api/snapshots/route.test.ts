import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";
import { mergeMemberIdentities } from "@/lib/tracker";

vi.mock("@/lib/auth", () => ({ isAuthenticated: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn() }));
import { isAuthenticated } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { POST } from "./route";

const row = { rank: 1, displayName: "구름빚", points: 250, confidence: .7 };
function request(rows: unknown[] = [row]) {
  return new Request("http://localhost/api/snapshots", { method: "POST", body: JSON.stringify({ capturedDate: "2026-09-06", status: "final", rows }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAuthenticated).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members: [{ id: "keep", canonicalName: "구름빛", active: true, aliases: [] }] });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("snapshot identity review", () => {
  it("requires explicit confirmation before creating an unmatched member", async () => {
    expect((await POST(request())).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
    const response = await POST(request([{ ...row, createMember: true }]));
    expect(response.status).toBe(200);
    expect((await response.json()).state.members).toHaveLength(2);
  });
  it("links a corrected reading and remembers its exact Unicode alias", async () => {
    const response = await POST(request([{ ...row, memberId: "keep" }]));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.state.members).toHaveLength(1);
    expect(body.state.members[0].aliases).toEqual(["구름빚"]);
    expect(body.snapshot.entries[0]).toMatchObject({ memberId: "keep", displayName: "구름빚", points: 250 });
  });
  it("reuses the merged alias on the next import without recreating the duplicate", async () => {
    const state = await getState();
    state.members.push({ id: "duplicate", canonicalName: row.displayName, aliases: [], active: true });
    vi.mocked(getState).mockResolvedValue(mergeMemberIdentities(state, "keep", "duplicate"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).state.members).toHaveLength(1);
  });
  it("rejects stale identities and duplicate rankings without mutating state", async () => {
    const state = await getState();
    const before = structuredClone(state);
    expect((await POST(request([{ ...row, memberId: "removed", createMember: true }]))).status).toBe(409);
    expect((await POST(request([{ ...row, memberId: "keep" }, { ...row, rank: 2, memberId: "keep" }]))).status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
  it("requires officer access", async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
  });
});
