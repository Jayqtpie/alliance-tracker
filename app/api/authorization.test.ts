import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn(), getAccessRole: vi.fn() }));
vi.mock("@/lib/bridge-auth", () => ({ isBridgeWorker: vi.fn() }));
vi.mock("@/lib/store", () => ({ getState: vi.fn(), setState: vi.fn(), StateConflictError: class extends Error {} }));
vi.mock("@/lib/bridge-store", () => ({ getBridgeQueue: vi.fn(), mutateBridgeQueue: vi.fn(), removeExpiredBridgeJobs: vi.fn() }));
import { isAdmin, getAccessRole } from "@/lib/auth";
import { isBridgeWorker } from "@/lib/bridge-auth";
import { getState, setState } from "@/lib/store";
import { getBridgeQueue, mutateBridgeQueue } from "@/lib/bridge-store";
import * as members from "./members/route";
import * as snapshots from "./snapshots/route";
import * as alliance from "./alliance/route";
import * as operations from "./operations/route";
import * as extract from "./extract/route";
import * as jobs from "./bridge/jobs/route";
import * as worker from "./bridge/worker/route";
import * as file from "./bridge/file/route";
import * as cleanup from "./cleanup/route";
import * as svs from "./svs/route";

beforeEach(() => { vi.resetAllMocks(); vi.mocked(isAdmin).mockResolvedValue(false); vi.mocked(getAccessRole).mockResolvedValue("viewer"); vi.mocked(isBridgeWorker).mockReturnValue(false); });
const routes = [
  ["members", "PUT", members.PUT], ["members", "PATCH", members.PATCH], ["members", "DELETE", members.DELETE],
  ["snapshots", "POST", snapshots.POST], ["snapshots", "PATCH", snapshots.PATCH], ["snapshots", "DELETE", snapshots.DELETE],
  ["alliance", "PUT", alliance.PUT], ["operations", "PUT", operations.PUT], ["extract", "POST", extract.POST],
  ["bridge/jobs", "GET", jobs.GET], ["bridge/jobs", "POST", jobs.POST], ["bridge/jobs", "PATCH", jobs.PATCH], ["bridge/jobs", "DELETE", jobs.DELETE],
  ["bridge/worker", "POST", worker.POST], ["bridge/file", "GET", file.GET], ["cleanup", "GET", cleanup.GET],
  ["svs", "PUT", svs.PUT],
] as const;
describe("API server-side authorization", () => {
  it.each(routes)("blocks viewer requests to %s %s before data access", async (route, method, handler) => {
    const response = await handler(new Request(`http://localhost/api/${route}`, { method }));
    expect(response.status).toBe(401);
    expect(getState).not.toHaveBeenCalled(); expect(setState).not.toHaveBeenCalled();
    expect(getBridgeQueue).not.toHaveBeenCalled(); expect(mutateBridgeQueue).not.toHaveBeenCalled();
  });
});
