import "server-only";
import { BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobEnabled, blobToken } from "@/lib/blob";
import { INITIAL_STATE } from "@/lib/seed";
import type { TrackerState } from "@/lib/types";
import { hydrateOperations } from "@/lib/operations";
import { importCapturedRoster } from "@/lib/roster-import";

const stateFile = path.join(process.cwd(), ".data", "tracker-state.json");
const statePath = "app-data/tracker-state.json";

class StateConflictError extends Error {
  constructor() {
    super("The tracker changed in another officer session. Refresh and try again.");
  }
}

function assertVercelStorageConfigured() {
  if (process.env.VERCEL && !blobEnabled()) {
    throw new Error(
      "No Vercel Blob read-write token is available in this deployment. Connect a private Blob store to the project and redeploy.",
    );
  }
}

async function getBlobState() {
  const result = await get(statePath, { access: "private", useCache: false, token: blobToken() });
  if (!result || result.statusCode !== 200) return null;
  const stored = JSON.parse(await new Response(result.stream).text()) as TrackerState;
  const payload = { ...stored, operations: hydrateOperations(stored.operations) };
  return { payload };
}

export function storageMode() {
  return blobEnabled() ? "vercel-blob" : "local";
}

async function getStoredState(): Promise<TrackerState> {
  assertVercelStorageConfigured();
  if (blobEnabled()) {
    const current = await getBlobState();
    if (current) return current.payload;
    try {
      await put(statePath, JSON.stringify(INITIAL_STATE), {
        access: "private",
        token: blobToken(),
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return structuredClone(INITIAL_STATE);
    } catch {
      const createdByAnotherRequest = await getBlobState();
      if (createdByAnotherRequest) return createdByAnotherRequest.payload;
      throw new Error("Could not initialise Vercel Blob state.");
    }
  }

  try {
    const stored = JSON.parse(await readFile(stateFile, "utf8")) as TrackerState;
    return { ...stored, operations: hydrateOperations(stored.operations) };
  } catch {
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(INITIAL_STATE, null, 2), "utf8");
    return structuredClone(INITIAL_STATE);
  }
}

export async function getState(): Promise<TrackerState> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await getStoredState();
    const imported = importCapturedRoster(stored);
    if (imported === stored) return stored;
    try {
      return await setState(imported);
    } catch (error) {
      if (!(error instanceof StateConflictError)) throw error;
      // Reapply the import to fresh state, preserving a concurrent officer edit.
    }
  }
  const latest = await getStoredState();
  if (importCapturedRoster(latest) === latest) return latest;
  throw new StateConflictError();
}

export async function setState(state: TrackerState) {
  assertVercelStorageConfigured();
  const next = { ...state, version: state.version + 1, updatedAt: new Date().toISOString() };
  if (blobEnabled()) {
    // The delivery response's ETag is not the control-plane write token.
    // Read metadata BEFORE content so a write during/after the read cannot
    // attach a newer ETag to an older state and silently overwrite an edit.
    const currentEtag = (await head(statePath, { token: blobToken() })).etag;
    const current = await getBlobState();
    if (!current || current.payload.version !== state.version) {
      throw new StateConflictError();
    }
    try {
      await put(statePath, JSON.stringify(next), {
        access: "private",
        token: blobToken(),
        contentType: "application/json",
        cacheControlMaxAge: 60,
        allowOverwrite: true,
        ifMatch: currentEtag,
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) throw new StateConflictError();
      throw error;
    }
    return next;
  }
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}
