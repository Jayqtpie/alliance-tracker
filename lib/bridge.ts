import type { BridgeJob, BridgeJobView } from "@/lib/bridge-types";

const LEASE_MS = 30 * 60 * 1000;

export function bridgeJobView(job: BridgeJob): BridgeJobView {
  return {
    id: job.id,
    status: job.status,
    fileCount: job.files.length,
    fileNames: job.files.map((file) => file.name),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    attempts: job.attempts,
    error: job.error,
    rows: job.status === "completed" ? job.rows : undefined,
  };
}

export function claimNextBridgeJob(jobs: BridgeJob[], workerId: string, now = new Date()) {
  const nowMs = now.getTime();
  const candidate = [...jobs]
    .filter((job) => job.status === "pending" || (
      job.status === "processing" &&
      job.leaseExpiresAt &&
      new Date(job.leaseExpiresAt).getTime() <= nowMs
    ))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!candidate) return undefined;
  const timestamp = now.toISOString();
  candidate.status = "processing";
  candidate.workerId = workerId;
  candidate.leaseExpiresAt = new Date(nowMs + LEASE_MS).toISOString();
  candidate.updatedAt = timestamp;
  candidate.attempts += 1;
  candidate.error = undefined;
  return candidate;
}
