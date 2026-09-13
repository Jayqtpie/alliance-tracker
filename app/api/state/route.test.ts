import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyState } from "@/lib/alliance";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAccessRole: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn() }));
import { getAccessRole } from "@/lib/auth";
import { getState } from "@/lib/store";
import { GET } from "./route";

beforeEach(() => vi.resetAllMocks());
it("rejects unauthenticated state reads before touching storage", async () => {
  vi.mocked(getAccessRole).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(getState).not.toHaveBeenCalled();
});
it.each(["viewer", "admin"] as const)("enforces the %s projection on the real route", async (role) => {
  vi.mocked(getAccessRole).mockResolvedValue(role);
  const state = createEmptyState();
  state.members = [{ id: "a", canonicalName: "Alpha", aliases: [], active: true, notes: "private" }];
  vi.mocked(getState).mockResolvedValue(state);
  const response = await GET();
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await response.json()).members[0].notes).toBe(role === "admin" ? "private" : undefined);
});
