import { describe, expect, it } from "vitest";
import { bridgeJobView, claimNextBridgeJob, retryBridgeJob } from "./bridge";
import type { BridgeJob } from "./bridge-types";

function job(patch: Partial<BridgeJob> = {}): BridgeJob {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "pending",
    files: [{ id: "file-1", name: "frame.jpg", pathname: "bridge-uploads/job/frame.jpg", contentType: "image/jpeg", size: 100 }],
    createdAt: "2026-08-26T01:00:00.000Z",
    updatedAt: "2026-08-26T01:00:00.000Z",
    expiresAt: "2026-08-31T01:00:00.000Z",
    attempts: 0,
    ...patch,
  };
}

describe("bridge queue", () => {
  it("claims the oldest pending job", () => {
    const newer = job({ id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-08-26T02:00:00.000Z" });
    const older = job();
    const claimed = claimNextBridgeJob([newer, older], "worker-1", new Date("2026-08-26T03:00:00.000Z"));
    expect(claimed?.id).toBe(older.id);
    expect(claimed?.status).toBe("processing");
    expect(claimed?.attempts).toBe(1);
  });

  it("reclaims an expired lease but leaves an active lease alone", () => {
    const active = job({ status: "processing", leaseExpiresAt: "2026-08-26T04:00:00.000Z" });
    expect(claimNextBridgeJob([active], "worker-2", new Date("2026-08-26T03:00:00.000Z"))).toBeUndefined();
    const reclaimed = claimNextBridgeJob([active], "worker-2", new Date("2026-08-26T05:00:00.000Z"));
    expect(reclaimed?.workerId).toBe("worker-2");
  });

  it("does not expose private blob paths to officers", () => {
    expect(bridgeJobView(job())).not.toHaveProperty("files");
    expect(bridgeJobView(job()).fileNames).toEqual(["frame.jpg"]);
  });

  it("requeues a failed job without discarding its retained files", () => {
    const failed = job({ status: "failed", attempts: 1, workerId: "worker-1", error: "No rows", leaseExpiresAt: "2026-08-26T04:00:00.000Z" });
    const retried = retryBridgeJob([failed], failed.id, new Date("2026-08-26T05:00:00.000Z"));
    expect(retried.status).toBe("pending");
    expect(retried.files).toHaveLength(1);
    expect(retried.attempts).toBe(1);
    expect(retried.error).toBeUndefined();
    expect(retried.workerId).toBeUndefined();
    expect(retried.leaseExpiresAt).toBeUndefined();
  });
});
