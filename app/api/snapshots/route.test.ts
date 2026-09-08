import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";
import { mergeMemberIdentities } from "@/lib/tracker";

vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn() }));
import { isAdmin } from "@/lib/auth";
import { getState, setState } from "@/lib/store";
import { DELETE, PATCH, POST } from "./route";

const row = { rank: 1, displayName: "구름빚", points: 250, confidence: .7 };
function request(rows: unknown[] = [row]) {
  return new Request("http://localhost/api/snapshots", { method: "POST", body: JSON.stringify({ capturedDate: "2026-09-06", status: "final", rows }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members: [{ id: "keep", canonicalName: "구름빛", active: true, aliases: [] }] });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("snapshot identity review", () => {
  it("persists human verification separately from OCR confidence and confirms a return", async () => {
    const state = await getState();
    state.members[0].active = false;
    state.members[0].leftAt = "2026-09-01";
    const response = await POST(request([{ ...row, memberId: "keep", reviewed: true, needsReview: true, confirmReturned: true }]));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.snapshot.entries[0]).toMatchObject({ reviewed: true, needsReview: false, confidence: .7 });
    expect(saved.state.members[0].active).toBe(true);
    expect(saved.state.members[0].leftAt).toBeUndefined();
  });
  it("does not let verification dismiss duplicate or unconfirmed departed identities", async () => {
    expect((await POST(request([{ ...row, memberId: "keep", reviewed: true }, { ...row, rank: 2, memberId: "keep", reviewed: true }]))).status).toBe(409);
    const state = await getState();
    state.members[0].active = false;
    expect((await POST(request([{ ...row, memberId: "keep", reviewed: true }]))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });
  it("allows fixing a different player's link in a legacy capture with existing duplicates", async () => {
    const state = await getState();
    state.members.push({ id: "legacy", canonicalName: "Old name", active: false, aliases: [] }, { id: "other", canonicalName: "Other player", active: true, aliases: [] });
    const entries = [
      { ...row, id: "old-row", memberId: "legacy" },
      { ...row, id: "other-row-1", memberId: "other", displayName: "Other player", rank: 2 },
      { ...row, id: "other-row-2", memberId: "other", displayName: "Other player", rank: 3 },
    ];
    state.snapshots.push({ id: "existing", capturedAt: "2026-09-06T12:00:00.000Z", weekStart: "2026-08-31", dayLabel: "Sunday", status: "final", sourceType: "manual", entries });
    const corrected = entries.map((entry) => entry.id === "old-row" ? { ...entry, memberId: "keep" } : entry);
    const edit = (rows: unknown[], snapshotId = "existing") => new Request("http://localhost/api/snapshots", { method: "POST", body: JSON.stringify({ snapshotId, capturedDate: "2026-09-06", status: "final", sourceType: "manual", rows }) });
    const response = await POST(edit(corrected));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.snapshot.entries).toEqual(corrected);
    expect(saved.state.snapshots).toHaveLength(1);
    expect(saved.state.members).toHaveLength(3);
    vi.mocked(setState).mockClear();
    expect((await POST(edit(entries.map((entry) => ({ ...entry, memberId: "other" }))))).status).toBe(400);
    expect((await POST(edit([...corrected, { ...corrected[1], rank: 4 }]))).status).toBe(400);
    expect((await POST(edit(corrected, "deleted-snapshot"))).status).toBe(404);
    expect(setState).not.toHaveBeenCalled();
  });

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
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect((await POST(request())).status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
  });
});


describe("report deletion locks", () => {
  async function capture(deletionLocked?: boolean) {
    const state = await getState();
    state.snapshots.push({ id: "report", deletionLocked, capturedAt: "2026-09-06T12:00:00Z", weekStart: "2026-08-31", dayLabel: "Sunday", status: "final", sourceType: "manual", entries: [{ ...row, id: "entry", memberId: "keep" }] });
    return state;
  }
  const remove = () => DELETE(new Request("http://localhost/api/snapshots?id=report", { method: "DELETE" }));
  const lock = (deletionLocked: boolean, version = 1, id = "report") => PATCH(new Request("http://localhost/api/snapshots", { method: "PATCH", body: JSON.stringify({ id, deletionLocked, version }) }));

  it.each([undefined, true])("blocks deletion of protected captures (%s)", async (setting) => {
    await capture(setting);
    expect((await remove()).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });
  it("persists an explicit unlock and permits deletion without changing members", async () => {
    const original = structuredClone(await capture());
    const unlocked = await lock(false);
    expect(unlocked.status).toBe(200);
    const { state } = await unlocked.json();
    expect(state.snapshots[0]).toEqual({ ...original.snapshots[0], deletionLocked: false });
    vi.mocked(getState).mockResolvedValue(state);
    const deleted = await remove();
    expect(deleted.status).toBe(200);
    const body = await deleted.json();
    expect(body.state.snapshots).toEqual([]);
    expect(body.state.members).toEqual(original.members);
  });
  it("relocking prevents later deletion", async () => {
    await capture(false);
    const response = await lock(true);
    const { state } = await response.json();
    vi.mocked(getState).mockResolvedValue(state);
    vi.mocked(setState).mockClear();
    expect((await remove()).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });
  it("rejects stale lock changes, missing reports, invalid bodies and non-admins", async () => {
    await capture();
    expect((await lock(false, 999)).status).toBe(409);
    expect((await lock(false, 1, "missing")).status).toBe(404);
    expect((await PATCH(new Request("http://localhost/api/snapshots", { method: "PATCH", body: "{}" }))).status).toBe(400);
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect((await lock(false)).status).toBe(401);
    expect((await remove()).status).toBe(401);
    expect(setState).not.toHaveBeenCalled();
  });
  it.each([undefined, true, false])("keeps the lock setting when correcting a capture (%s)", async (setting) => {
    await capture(setting);
    const response = await POST(new Request("http://localhost/api/snapshots", { method: "POST", body: JSON.stringify({ snapshotId: "report", capturedDate: "2026-09-06", status: "final", rows: [{ ...row, id: "entry", memberId: "keep", points: 300 }] }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.deletionLocked).toBe(setting ?? true);
  });
  it("protects newly published captures", async () => {
    const response = await POST(request([{ ...row, memberId: "keep" }]));
    expect((await response.json()).snapshot.deletionLocked).toBe(true);
  });
});
