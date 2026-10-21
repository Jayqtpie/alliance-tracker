import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_STATE } from "./seed";
import type { TrackerState } from "./types";
import type { BridgeQueue } from "./bridge-types";

const redis = vi.hoisted(() => ({ docs: new Map<string, string>(), strings: new Map<string, string>() }));
const blob = vi.hoisted(() => ({ enabled: true, documents: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/blob", () => ({ blobEnabled: () => blob.enabled, blobToken: () => "test-token" }));
vi.mock("@vercel/blob", () => ({
  get: vi.fn(async (pathname: string) => blob.documents.has(pathname)
    ? { statusCode: 200, stream: new Response(blob.documents.get(pathname)).body!, blob: { etag: "delivery" } }
    : null),
  head: vi.fn(), put: vi.fn(), del: vi.fn(),
  BlobPreconditionFailedError: class extends Error {},
}));
// Same contract as the Lua script in lib/redis.ts: write only when the stored version is the expected one.
vi.mock("@/lib/redis", () => ({
  redisEnabled: () => true,
  readDocument: vi.fn(async (key: string) => redis.docs.has(key) ? JSON.parse(redis.docs.get(key)!) : null),
  writeDocumentIfVersion: vi.fn(async (key: string, expected: number | null, value: { version: number }) => {
    const current = redis.docs.get(key);
    if ((current ? JSON.parse(current).version : null) !== expected) return false;
    redis.docs.set(key, JSON.stringify(value));
    return true;
  }),
  setString: vi.fn(async (key: string, value: string) => { redis.strings.set(key, value); }),
}));

import { get, put } from "@vercel/blob";
import { applyDataImports, getState, setState, storageMode, StateConflictError } from "./store";
import { getBridgeQueue, mutateBridgeQueue } from "./bridge-store";

// Imports already applied, so a load reads without writing.
const settled = (): TrackerState => applyDataImports(structuredClone(INITIAL_STATE));

beforeEach(() => {
  vi.clearAllMocks();
  redis.docs.clear(); redis.strings.clear();
  blob.enabled = true; blob.documents.clear();
});

describe("Redis state storage", () => {
  it("carries the Blob state over on the first read, then stops reading Blob", async () => {
    const existing = { ...settled(), version: 42 };
    blob.documents.set("app-data/tracker-state.json", JSON.stringify(existing));
    expect(storageMode()).toBe("redis");

    const first = await getState();
    expect(first.version).toBe(42);
    expect(first.members.length).toBe(existing.members.length);
    expect(JSON.parse(redis.docs.get("tracker-state")!).version).toBe(42);

    vi.mocked(get).mockClear();
    expect((await getState()).version).toBe(42);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("starts empty when there is no Blob state to carry over", async () => {
    blob.enabled = false;
    const fresh = await getState();
    expect(fresh.members).toEqual([]);
    expect(redis.docs.has("tracker-state")).toBe(true);
  });

  it("saves against the version read and refuses a stale save", async () => {
    redis.docs.set("tracker-state", JSON.stringify({ ...settled(), version: 7 }));
    const loaded = await getState();
    const saved = await setState({ ...loaded, alliance: { ...loaded.alliance, name: "Renamed" } });
    expect(saved.version).toBe(8);
    expect((await getState()).alliance.name).toBe("Renamed");

    await expect(setState({ ...loaded, alliance: { ...loaded.alliance, name: "Stale tab" } })).rejects.toBeInstanceOf(StateConflictError);
    expect((await getState()).alliance.name).toBe("Renamed");
    expect(put).not.toHaveBeenCalled();
  });

  it("backs the state up to Redis before a data import replaces it", async () => {
    const unimported = { ...structuredClone(INITIAL_STATE), version: 3 };
    expect(applyDataImports(unimported)).not.toBe(unimported);
    redis.docs.set("tracker-state", JSON.stringify(unimported));
    await getState();
    const backups = [...redis.strings.keys()];
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^tracker-state:backup:tracker-state-v3-before-/);
    expect(JSON.parse(redis.strings.get(backups[0])!).version).toBe(3);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("Redis bridge queue", () => {
  const job = (id: string) => ({ id, status: "pending", files: [], createdAt: "", updatedAt: "", expiresAt: "", attempts: 0 }) as BridgeQueue["jobs"][number];

  it("carries a queued Blob job over and writes the queue only when it changes", async () => {
    blob.documents.set("app-data/bridge-queue.json", JSON.stringify({ version: 4, jobs: [job("in-flight")], updatedAt: "" }));
    expect((await getBridgeQueue()).jobs.map((item) => item.id)).toEqual(["in-flight"]);

    await mutateBridgeQueue(() => undefined);
    expect(redis.docs.has("bridge-queue")).toBe(false);

    await mutateBridgeQueue((jobs) => { jobs.push(job("new")); });
    const stored = JSON.parse(redis.docs.get("bridge-queue")!) as BridgeQueue;
    expect(stored.version).toBe(5);
    expect(stored.jobs.map((item) => item.id)).toEqual(["in-flight", "new"]);
  });

  it("retries on a concurrent write instead of overwriting it", async () => {
    redis.docs.set("bridge-queue", JSON.stringify({ version: 1, jobs: [], updatedAt: "" }));
    let raced = false;
    await mutateBridgeQueue((jobs) => {
      if (!raced) { raced = true; redis.docs.set("bridge-queue", JSON.stringify({ version: 2, jobs: [job("other")], updatedAt: "" })); }
      jobs.push(job("mine"));
    });
    const stored = JSON.parse(redis.docs.get("bridge-queue")!) as BridgeQueue;
    expect(stored.jobs.map((item) => item.id)).toEqual(["other", "mine"]);
    expect(stored.version).toBe(3);
  });
});
