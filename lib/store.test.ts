import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_STATE } from "./seed";
import type { TrackerState } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/blob", () => ({ blobEnabled: () => true, blobToken: () => "test-token" }));
vi.mock("@vercel/blob", () => ({
  get: vi.fn(), head: vi.fn(), put: vi.fn(),
  BlobPreconditionFailedError: class extends Error {},
}));

import { BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import { applyDataImports, getState, setState } from "./store";

type PutOptions = Parameters<typeof put>[2];
type StateWrite = (body: string, options: PutOptions) => Promise<void>;

const statePath = "app-data/tracker-state.json";
let stored: TrackerState;
let revision: number;
let backups: Map<string, string>;
// One-shot overrides for the next state writes; backup writes never consume them.
let stateWrites: StateWrite[];
let backupWrite: StateWrite | undefined;
const statePuts = () => vi.mocked(put).mock.calls.filter(([pathname]) => pathname === statePath);

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  stored = structuredClone(INITIAL_STATE);
  revision = 1;
  backups = new Map();
  stateWrites = [];
  backupWrite = undefined;
  vi.mocked(head).mockImplementation(async () => ({ etag: `metadata-${revision}` }) as Awaited<ReturnType<typeof head>>);
  vi.mocked(get).mockImplementation(async () => ({
    statusCode: 200, stream: new Response(JSON.stringify(stored)).body!,
    headers: new Headers(), blob: {
      etag: `delivery-${revision}`, url: "https://example.invalid/state.json",
      downloadUrl: "https://example.invalid/state.json", pathname: statePath,
      contentDisposition: "inline", cacheControl: "no-cache", uploadedAt: new Date(0),
      contentType: "application/json", size: JSON.stringify(stored).length,
    },
  }));
  vi.mocked(put).mockImplementation(async (pathname, body, options) => {
    if (pathname !== statePath) {
      if (backupWrite) await backupWrite(String(body), options);
      backups.set(pathname, String(body));
    } else {
      const override = stateWrites.shift();
      if (override) await override(String(body), options);
      else {
        if (options?.ifMatch !== `metadata-${revision}`) throw new BlobPreconditionFailedError();
        stored = JSON.parse(String(body));
        revision += 1;
      }
    }
    return {} as Awaited<ReturnType<typeof put>>;
  });
});

describe("private Blob state writes", () => {
  it("initialises a new store empty and keeps it empty after setup and reload", async () => {
    vi.mocked(get).mockResolvedValueOnce(null);
    stateWrites.push(async (body) => {
      stored = JSON.parse(body);
    });
    const fresh = await getState();
    expect(fresh.alliance).toEqual({ name: "", tag: "", server: "" });
    expect(fresh.members).toEqual([]);
    expect(fresh.snapshots).toEqual([]);
    await setState({ ...fresh, alliance: { name: "The Rascals", tag: "RSCL", server: "927" } });
    const reloaded = await getState();
    expect(reloaded.alliance.server).toBe("927");
    expect(reloaded.members).toEqual([]);
    expect(reloaded.snapshots).toEqual([]);
    expect(statePuts()).toHaveLength(2);
  });

  it("loads and persists the roster using the metadata ETag, not the delivery ETag", async () => {
    const result = await getState();
    expect(result.members.filter((member) => member.active)).toHaveLength(92);
    expect(stored.rosterImport).toBe(result.rosterImport);
    expect(put).toHaveBeenCalledWith(statePath, expect.any(String), expect.objectContaining({ ifMatch: "metadata-1" }));
    expect(vi.mocked(head).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(get).mock.invocationCallOrder[1]);
    await getState();
    expect(statePuts()).toHaveLength(1);
  });

  it("rejects a stale officer save without overwriting newer content", async () => {
    const stale = structuredClone(stored);
    stored.version += 1;
    await expect(setState(stale)).rejects.toThrow("another officer session");
    expect(put).not.toHaveBeenCalled();
  });

  it("retries the migration on fresh content after a concurrent write", async () => {
    stateWrites.push(async () => {
      stored.members[0].notes = "Concurrent officer note";
      stored.version += 1;
      revision += 1;
      throw new BlobPreconditionFailedError();
    });
    const result = await getState();
    expect(result.members.find((member) => member.id === INITIAL_STATE.members[0].id)?.notes).toBe("Concurrent officer note");
    expect(statePuts()).toHaveLength(2);
  });

  it("returns a migration completed by another request without rewriting it", async () => {
    stateWrites.push(async () => {
      stored = applyDataImports(stored);
      stored.version += 1;
      revision += 1;
      throw new BlobPreconditionFailedError();
    });
    expect((await getState()).members.filter((member) => member.active)).toHaveLength(92);
    expect(statePuts()).toHaveLength(1);
  });

  it("does not retry unrelated storage failures or report a failed import as saved", async () => {
    stateWrites.push(async () => {
      throw new Error("Blob access denied");
    });
    await expect(getState()).rejects.toThrow("Could not load shared tracker data.");
    expect(statePuts()).toHaveLength(1);
    expect(stored.rosterImport).toBeUndefined();
  });
});

describe("state backup before a data import", () => {
  it("writes the state it read aside before the import overwrites it, once", async () => {
    const before = structuredClone(stored);
    const result = await getState();
    const backupPath = `app-data/backups/tracker-state-v${before.version}-before-${result.rosterImport}.json`;
    expect([...backups.keys()]).toEqual([backupPath]);
    expect(JSON.parse(backups.get(backupPath)!)).toEqual(before);
    expect(put).toHaveBeenCalledWith(backupPath, expect.any(String), expect.objectContaining({ access: "private", addRandomSuffix: false }));
    const backupCall = vi.mocked(put).mock.calls.findIndex(([pathname]) => pathname === backupPath);
    const stateCall = vi.mocked(put).mock.calls.findIndex(([pathname]) => pathname === statePath);
    expect(vi.mocked(put).mock.invocationCallOrder[backupCall]).toBeLessThan(vi.mocked(put).mock.invocationCallOrder[stateCall]);
    await getState();
    expect(backups.size).toBe(1);
  });

  it("backs up the state it read, not whatever a concurrent request has since written", async () => {
    const before = structuredClone(stored);
    // Another request imports between this request's read and its backup.
    backupWrite = async () => {
      backupWrite = undefined;
      stored = { ...applyDataImports(stored), version: stored.version + 1 };
      revision += 1;
    };
    await getState();
    const [backup] = [...backups.values()];
    expect(JSON.parse(backup)).toEqual(before);
    expect(JSON.parse(backup).rosterImport).toBeUndefined();
  });

  it("serves the current state unimported when the backup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    backupWrite = async () => {
      throw new Error("Blob unavailable");
    };
    const result = await getState();
    expect(statePuts()).toHaveLength(0);
    expect(result.rosterImport).toBeUndefined();
    expect(stored.rosterImport).toBeUndefined();
  });

  it("never imports on a preview deployment, which may share production's store", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    const result = await getState();
    expect(put).not.toHaveBeenCalled();
    expect(result.rosterImport).toBeUndefined();
  });

  it("imports on the production deployment", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const result = await getState();
    expect(backups.size).toBe(1);
    expect(stored.rosterImport).toBe(result.rosterImport);
  });
});
