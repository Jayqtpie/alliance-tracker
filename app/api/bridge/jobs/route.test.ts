import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/bridge-store", () => ({ getBridgeQueue: vi.fn(), mutateBridgeQueue: vi.fn() }));
vi.mock("@/lib/github-dispatch", () => ({ triggerBridgeExtraction: vi.fn() }));
vi.mock("@vercel/blob", () => ({ head: vi.fn(), del: vi.fn() }));
import { head } from "@vercel/blob";
import { isAdmin } from "@/lib/auth";
import { getBridgeQueue, mutateBridgeQueue } from "@/lib/bridge-store";
import { triggerBridgeExtraction } from "@/lib/github-dispatch";
import type { BridgeJob } from "@/lib/bridge-types";
import { GET, PATCH, POST } from "./route";

const id = "5f02ca6a-70e0-407a-8789-55bc2c9a3254";
const file = { id: "frame-01", name: "IMG_6170.png", pathname: `bridge-uploads/${id}/frame-01-IMG_6170.png`, contentType: "image/png" as const, size: 1000 };
const job = (status: BridgeJob["status"]): BridgeJob => ({ id, status, files: [file], createdAt: "2026-10-18T23:10:42.537Z", updatedAt: "2026-10-18T23:10:42.537Z", expiresAt: "2026-10-23T23:10:42.537Z", attempts: 0 });
const request = (method: string, body: unknown) => new Request("http://localhost/api/bridge/jobs", { method, body: JSON.stringify(body) });
const rejected = { started: false, error: "GitHub rejected the extraction trigger (HTTP 401). The dispatch token may have expired or been revoked." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("bridge job dispatch reporting", () => {
  it("queues the job and reports why GitHub did not start the worker", async () => {
    vi.mocked(head).mockResolvedValue({ size: file.size, contentType: file.contentType } as Awaited<ReturnType<typeof head>>);
    const jobs: BridgeJob[] = [];
    vi.mocked(mutateBridgeQueue).mockImplementation(async (change) => change(jobs));
    vi.mocked(triggerBridgeExtraction).mockResolvedValue(rejected);
    const body = await (await POST(request("POST", { id, files: [file] }))).json();
    expect(jobs.map((item) => [item.id, item.status])).toEqual([[id, "pending"]]);
    expect(body).toMatchObject({ job: { id, status: "pending" }, dispatchError: rejected.error });
  });

  it("starts a waiting job again without changing it", async () => {
    vi.mocked(getBridgeQueue).mockResolvedValue({ jobs: [job("pending")] } as Awaited<ReturnType<typeof getBridgeQueue>>);
    vi.mocked(triggerBridgeExtraction).mockResolvedValue({ started: true });
    const response = await PATCH(request("PATCH", { id }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.job).toMatchObject({ id, status: "pending" });
    expect(body.dispatchError).toBeUndefined();
    expect(mutateBridgeQueue).not.toHaveBeenCalled();
    expect(triggerBridgeExtraction).toHaveBeenCalledOnce();
  });

  it("still requeues a failed job and reports a failed trigger", async () => {
    const jobs = [job("failed")];
    vi.mocked(getBridgeQueue).mockResolvedValue({ jobs } as Awaited<ReturnType<typeof getBridgeQueue>>);
    vi.mocked(mutateBridgeQueue).mockImplementation(async (change) => change(jobs));
    vi.mocked(triggerBridgeExtraction).mockResolvedValue(rejected);
    const body = await (await PATCH(request("PATCH", { id }))).json();
    expect(jobs[0].status).toBe("pending");
    expect(body.dispatchError).toBe(rejected.error);
  });
});

describe("storm import jobs", () => {
  const storm = { weekId: "week-1", team: "B" };

  it("keeps the kind and the week and team it belongs to", async () => {
    vi.mocked(head).mockResolvedValue({ size: file.size, contentType: file.contentType } as Awaited<ReturnType<typeof head>>);
    const jobs: BridgeJob[] = [];
    vi.mocked(mutateBridgeQueue).mockImplementation(async (change) => change(jobs));
    vi.mocked(triggerBridgeExtraction).mockResolvedValue({ started: true });
    const body = await (await POST(request("POST", { id, files: [file], kind: "storm", storm }))).json();
    expect(jobs[0]).toMatchObject({ kind: "storm", storm });
    expect(body.job).toMatchObject({ kind: "storm", storm });
  });

  it("refuses a storm job without its target, and a target without the storm kind", async () => {
    for (const body of [{ id, files: [file], kind: "storm" }, { id, files: [file], storm }]) {
      expect((await POST(request("POST", body))).status).toBe(400);
    }
    expect(mutateBridgeQueue).not.toHaveBeenCalled();
  });

  it("shows a job saved before kinds existed as a duel ranking", async () => {
    vi.mocked(getBridgeQueue).mockResolvedValue({ jobs: [job("pending")] } as Awaited<ReturnType<typeof getBridgeQueue>>);
    const body = await (await GET(new Request(`http://localhost/api/bridge/jobs?id=${id}`))).json();
    expect(body.job.kind).toBe("duel");
  });
});
