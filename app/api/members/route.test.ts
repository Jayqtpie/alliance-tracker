import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";

vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn(), StateConflictError: class extends Error {} }));
import { isAdmin } from "@/lib/auth";
import { getState, setState, StateConflictError } from "@/lib/store";
import { DELETE, PATCH } from "./route";

function request(body: unknown = { primaryId: "keep", duplicateId: "duplicate", version: 1 }) {
  return new Request("http://localhost/api/members", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(getState).mockResolvedValue({ ...createEmptyState(), members: [
    { id: "keep", canonicalName: "Alpha", active: true, aliases: [] },
    { id: "duplicate", canonicalName: "A1pha", active: true, aliases: [] },
  ] });
  vi.mocked(setState).mockImplementation(async (state) => ({ ...state, version: state.version + 1 }));
});

describe("player edits and deletion", () => {
  it("saves name and statistics for a missing profile without inventing a profile", async () => {
    const state = await getState();
    state.snapshots.push({ id: "history", capturedAt: "2026-09-05T12:00:00Z", weekStart: "2026-08-31", dayLabel: "Saturday", status: "final", sourceType: "manual", entries: [{ id: "row", memberId: "keep", displayName: "Alpha", rank: 1, points: 123, confidence: 1 }] });
    const original = structuredClone(state);
    const response = await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "雨の女王", heroPower: "125.5M", kills: "0", version: 1 }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.members[0]).toMatchObject({ id: "keep", canonicalName: "雨の女王", aliases: ["Alpha"], previousNames: ["Alpha"], manualStats: { heroPower: 125500000, kills: 0 } });
    expect(saved.members[0].gameProfile).toBeUndefined();
    expect(saved.snapshots).toEqual(original.snapshots);
    expect(state).toEqual(original);
  });

  it("saves power and profession corrections and clears them to unavailable", async () => {
    const saved = await (await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Alpha", power: "450.5M", heroPower: "", kills: "", profession: "War Leader", version: 1 }))).json();
    expect(saved.members[0].manualStats).toMatchObject({ power: 450500000, profession: "War Leader" });
    expect(saved.members[0].manualStats).not.toHaveProperty("heroPower");
    const profiled = { id: "keep", canonicalName: "Alpha", active: true, aliases: [], gameProfile: { uid: "1", rank: "R3", avatarPath: "", heroPower: 5, heroPowerDisplay: "5", heroPowerLegacy: false, kills: 6, killsDisplay: "6", power: 7, powerDisplay: "7", profession: "Engineer", capturedOn: "2026-09-14", source: "test" } };
    vi.mocked(getState).mockResolvedValueOnce({ ...createEmptyState(), members: [profiled] });
    const cleared = await (await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Alpha", power: "", heroPower: "5", kills: "6", profession: "", version: 1 }))).json();
    expect(cleared.members[0].manualStats).toEqual({ power: null, profession: null, updatedAt: expect.any(String) });
    expect(cleared.members[0].gameProfile).toEqual(profiled.gameProfile);
    // An editor opened before these fields existed leaves them unchanged.
    const legacy = await (await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Renamed", heroPower: "", kills: "", version: 1 }))).json();
    expect(legacy.members[0].manualStats).toBeUndefined();
    expect((await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Alpha", power: "lots", heroPower: "", kills: "", version: 1 }))).status).toBe(400);
    expect((await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Alpha", heroPower: "", kills: "", profession: "Wizard", version: 1 }))).status).toBe(400);
  });

  it("records origin and departure servers, letting a correction outrank the captured value", async () => {
    const profiled = { id: "keep", canonicalName: "Alpha", active: true, aliases: [], gameProfile: { uid: "1", rank: "R3", avatarPath: "", heroPower: 5, heroPowerDisplay: "5", heroPowerLegacy: false, kills: 6, killsDisplay: "6", originServer: 856, capturedOn: "2026-09-14", source: "test" } };
    const edit = (body: Record<string, unknown>) => {
      vi.mocked(getState).mockResolvedValueOnce({ ...createEmptyState(), members: [structuredClone(profiled)] });
      return PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Alpha", heroPower: "5", kills: "6", version: 1, ...body })).then((response) => response.json());
    };
    // Saving the captured value back leaves the capture in charge of the field.
    expect((await edit({ originServer: "856" })).members[0].originServer).toBeUndefined();
    expect((await edit({ originServer: "900" })).members[0].originServer).toBe(900);
    // Clearing it is a correction too, so a later refresh cannot reinstate 856.
    expect((await edit({ originServer: "" })).members[0].originServer).toBeNull();
    expect((await edit({ transferredTo: "931" })).members[0].transferredTo).toBe(931);
    expect((await edit({ transferredTo: "" })).members[0].transferredTo).toBeUndefined();
    // Neither edit disturbs the captured profile or the statistics.
    const saved = await edit({ originServer: "900", transferredTo: "931" });
    expect(saved.members[0].gameProfile).toEqual(profiled.gameProfile);
    expect(saved.members[0].manualStats).toBeUndefined();
    // An editor opened before these fields existed leaves both untouched.
    const legacy = await edit({});
    expect(legacy.members[0]).not.toHaveProperty("transferredTo");
    for (const invalid of ["92", "12345", "nine"]) {
      vi.mocked(getState).mockResolvedValueOnce({ ...createEmptyState(), members: [structuredClone(profiled)] });
      expect((await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Alpha", heroPower: "", kills: "", originServer: invalid, version: 1 }))).status).toBe(400);
    }
  });

  it("rejects invalid stats and stale edits without partially saving the name", async () => {
    expect((await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Changed", heroPower: "-12", kills: "2M", version: 1 }))).status).toBe(400);
    expect((await PATCH(request({ action: "edit", memberId: "keep", canonicalName: "Changed", heroPower: "12M", kills: "2M", version: 2 }))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });

  it("restores a previous record to the roster and can move it back", async () => {
    const state = await getState();
    state.members[1] = { ...state.members[1], active: false, leftAt: "2026-09-10" };
    const original = structuredClone(state);
    const restored = await PATCH(request({ action: "set-active", memberId: "duplicate", active: true, version: 1 }));
    expect(restored.status).toBe(200);
    const saved = await restored.json();
    expect(saved.members[1]).toEqual({ id: "duplicate", canonicalName: "A1pha", active: true, aliases: [] });
    expect(saved.members[0]).toEqual(original.members[0]);
    expect(state).toEqual(original);
    const moved = await PATCH(request({ action: "set-active", memberId: "keep", active: false, version: 1 }));
    expect((await moved.json()).members[0]).toMatchObject({ id: "keep", active: false });
  });

  it("rejects missing players and stale roster membership changes", async () => {
    expect((await PATCH(request({ action: "set-active", memberId: "missing", active: true, version: 1 }))).status).toBe(404);
    expect((await PATCH(request({ action: "set-active", memberId: "keep", active: true, version: 2 }))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });

  function deleteRequest(id = "keep", version = 1) {
    return new Request(`http://localhost/api/members?id=${id}`, { method: "DELETE", body: JSON.stringify({ version }) });
  }

  it("deletes a roster entry while preserving saved ranking rows", async () => {
    const state = await getState();
    state.snapshots.push({ id: "history", capturedAt: "2026-09-05T12:00:00Z", weekStart: "2026-08-31", dayLabel: "Saturday", status: "final", sourceType: "manual", entries: [{ id: "row", memberId: "keep", displayName: "Alpha", rank: 1, points: 123, confidence: 1 }] });
    const original = structuredClone(state);
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.members.map((member: { id: string }) => member.id)).toEqual(["duplicate"]);
    expect(saved.snapshots).toEqual(original.snapshots);
    expect(state).toEqual(original);
  });

  it("rejects missing, invalid and stale deletion requests", async () => {
    expect((await DELETE(deleteRequest("missing"))).status).toBe(404);
    expect((await DELETE(deleteRequest("keep", 2))).status).toBe(409);
    expect((await DELETE(deleteRequest("", 1))).status).toBe(400);
    expect((await DELETE(new Request("http://localhost/api/members?id=keep", { method: "DELETE" }))).status).toBe(400);
    expect(setState).not.toHaveBeenCalled();
  });

  it("requires officer access for deletion and handles a concurrent save", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect((await DELETE(deleteRequest())).status).toBe(401);
    expect(getState).not.toHaveBeenCalled();
    vi.mocked(isAdmin).mockResolvedValue(true);
    vi.mocked(setState).mockRejectedValue(new StateConflictError());
    expect((await DELETE(deleteRequest())).status).toBe(409);
  });
});

describe("member merge API", () => {
  it("renames a player without replacing their identity, profile or historical scores", async () => {
    const state = await getState();
    state.members[0].gameProfile = { uid: "qa", rank: "R5", avatarPath: "/qa.svg", heroPower: 100, heroPowerDisplay: "100", heroPowerLegacy: false, kills: 10, killsDisplay: "10", capturedOn: "2026-09-05", source: "test" };
    state.snapshots.push({ id: "qa", capturedAt: "2026-09-06T12:00:00Z", weekStart: "2026-08-31", dayLabel: "Sunday", status: "final", sourceType: "manual", entries: [{ id: "row", memberId: "keep", displayName: "Alpha", rank: 1, points: 123, confidence: 1 }] });
    const before = structuredClone(state);
    const response = await PATCH(request({ action: "rename", memberId: "keep", canonicalName: "  雨の女王  ", version: state.version }));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.members[0]).toEqual({ ...before.members[0], canonicalName: "雨の女王", aliases: ["Alpha"], previousNames: ["Alpha"] });
    expect(saved.members[1]).toEqual(before.members[1]);
    expect(saved.snapshots).toEqual(before.snapshots);
    expect(state).toEqual(before);
  });
  it("rejects blank names, missing players and stale rename requests", async () => {
    expect((await PATCH(request({ action: "rename", memberId: "keep", canonicalName: "  ", version: 1 }))).status).toBe(400);
    expect((await PATCH(request({ action: "rename", memberId: "missing", canonicalName: "Name", version: 1 }))).status).toBe(404);
    expect((await PATCH(request({ action: "rename", memberId: "keep", canonicalName: "Name", version: 2 }))).status).toBe(409);
    expect(setState).not.toHaveBeenCalled();
  });
  it("requires officer access before any state access", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
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
