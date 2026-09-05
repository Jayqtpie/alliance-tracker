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
import { getState, setState } from "./store";
import { importCapturedRoster } from "./roster-import";

let stored: TrackerState;
let revision: number;

beforeEach(() => {
  vi.resetAllMocks();
  stored = structuredClone(INITIAL_STATE);
  revision = 1;
  vi.mocked(head).mockImplementation(async () => ({ etag: `metadata-${revision}` }) as Awaited<ReturnType<typeof head>>);
  vi.mocked(get).mockImplementation(async () => ({
    statusCode: 200, stream: new Response(JSON.stringify(stored)).body!,
    headers: new Headers(), blob: {
      etag: `delivery-${revision}`, url: "https://example.invalid/state.json",
      downloadUrl: "https://example.invalid/state.json", pathname: "app-data/tracker-state.json",
      contentDisposition: "inline", cacheControl: "no-cache", uploadedAt: new Date(0),
      contentType: "application/json", size: JSON.stringify(stored).length,
    },
  }));
  vi.mocked(put).mockImplementation(async (_path, body, options) => {
    if (options?.ifMatch !== `metadata-${revision}`) throw new BlobPreconditionFailedError();
    stored = JSON.parse(String(body));
    revision += 1;
    return {} as Awaited<ReturnType<typeof put>>;
  });
});

describe("private Blob state writes", () => {
  it("loads and persists the roster using the metadata ETag, not the delivery ETag", async () => {
    const result = await getState();
    expect(result.members.filter((member) => member.active)).toHaveLength(100);
    expect(stored.rosterImport).toBe(result.rosterImport);
    expect(put).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ ifMatch: "metadata-1" }));
    expect(vi.mocked(head).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(get).mock.invocationCallOrder[1]);
    await getState();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale officer save without overwriting newer content", async () => {
    const stale = structuredClone(stored);
    stored.version += 1;
    await expect(setState(stale)).rejects.toThrow("another officer session");
    expect(put).not.toHaveBeenCalled();
  });

  it("retries the migration on fresh content after a concurrent write", async () => {
    vi.mocked(put).mockImplementationOnce(async () => {
      stored.members[0].notes = "Concurrent officer note";
      stored.version += 1;
      revision += 1;
      throw new BlobPreconditionFailedError();
    });
    const result = await getState();
    expect(result.members.find((member) => member.id === INITIAL_STATE.members[0].id)?.notes).toBe("Concurrent officer note");
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("returns a migration completed by another request without rewriting it", async () => {
    vi.mocked(put).mockImplementationOnce(async () => {
      stored = importCapturedRoster(stored);
      stored.version += 1;
      revision += 1;
      throw new BlobPreconditionFailedError();
    });
    expect((await getState()).members.filter((member) => member.active)).toHaveLength(100);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("does not retry unrelated storage failures or report a failed import as saved", async () => {
    vi.mocked(put).mockRejectedValue(new Error("Blob access denied"));
    await expect(getState()).rejects.toThrow("Blob access denied");
    expect(put).toHaveBeenCalledTimes(1);
    expect(stored.rosterImport).toBeUndefined();
  });
});
