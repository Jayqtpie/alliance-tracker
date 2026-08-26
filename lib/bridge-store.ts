import "server-only";
import { del, get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobEnabled, blobToken } from "@/lib/blob";
import type { BridgeJob, BridgeQueue } from "@/lib/bridge-types";

const queuePath = "app-data/bridge-queue.json";
const queueFile = path.join(process.cwd(), ".data", "bridge-queue.json");
const emptyQueue = (): BridgeQueue => ({ version: 1, jobs: [], updatedAt: new Date(0).toISOString() });

async function getBlobQueue() {
  const result = await get(queuePath, { access: "private", useCache: false, token: blobToken() });
  if (!result || result.statusCode !== 200) return null;
  return {
    payload: JSON.parse(await new Response(result.stream).text()) as BridgeQueue,
    etag: result.blob.etag,
  };
}

async function getLocalQueue() {
  try {
    return JSON.parse(await readFile(queueFile, "utf8")) as BridgeQueue;
  } catch {
    return emptyQueue();
  }
}

export async function getBridgeQueue(): Promise<BridgeQueue> {
  if (blobEnabled()) return (await getBlobQueue())?.payload || emptyQueue();
  return getLocalQueue();
}

export async function mutateBridgeQueue<T>(mutator: (jobs: BridgeJob[]) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = blobEnabled() ? await getBlobQueue() : null;
    const queue = current?.payload || (blobEnabled() ? emptyQueue() : await getLocalQueue());
    const jobs = structuredClone(queue.jobs);
    const value = mutator(jobs);
    const next: BridgeQueue = {
      version: queue.version + 1,
      jobs,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (blobEnabled()) {
        await put(queuePath, JSON.stringify(next), {
          access: "private",
          token: blobToken(),
          contentType: "application/json",
          cacheControlMaxAge: 60,
          addRandomSuffix: false,
          allowOverwrite: Boolean(current),
          ...(current ? { ifMatch: current.etag } : {}),
        });
      } else {
        await mkdir(path.dirname(queueFile), { recursive: true });
        await writeFile(queueFile, JSON.stringify(next, null, 2), "utf8");
      }
      return value;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Could not update the bridge queue.");
}

export async function removeExpiredBridgeJobs(now = Date.now()) {
  const queue = await getBridgeQueue();
  const expired = queue.jobs.filter((job) => new Date(job.expiresAt).getTime() <= now);
  const pathnames = expired.flatMap((job) => job.files.map((file) => file.pathname));
  if (pathnames.length && blobEnabled()) await del(pathnames, { token: blobToken() });
  if (expired.length) {
    const ids = new Set(expired.map((job) => job.id));
    await mutateBridgeQueue((jobs) => {
      for (let index = jobs.length - 1; index >= 0; index -= 1) {
        if (ids.has(jobs[index].id)) jobs.splice(index, 1);
      }
    });
  }
  return expired.length;
}
