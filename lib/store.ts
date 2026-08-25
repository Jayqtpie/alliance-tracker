import "server-only";
import { get, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INITIAL_STATE } from "@/lib/seed";
import type { TrackerState } from "@/lib/types";

const stateFile = path.join(process.cwd(), ".data", "tracker-state.json");
const statePath = "app-data/tracker-state.json";

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function assertVercelStorageConfigured() {
  if (process.env.VERCEL && !blobEnabled()) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is missing from this Vercel deployment. Connect a private Blob store to the project and redeploy.",
    );
  }
}

async function getBlobState() {
  const result = await get(statePath, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const payload = JSON.parse(await new Response(result.stream).text()) as TrackerState;
  return { payload, etag: result.blob.etag };
}

export function storageMode() {
  return blobEnabled() ? "vercel-blob" : "local";
}

export async function getState(): Promise<TrackerState> {
  assertVercelStorageConfigured();
  if (blobEnabled()) {
    const current = await getBlobState();
    if (current) return current.payload;
    try {
      await put(statePath, JSON.stringify(INITIAL_STATE), {
        access: "private",
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
    return JSON.parse(await readFile(stateFile, "utf8")) as TrackerState;
  } catch {
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(INITIAL_STATE, null, 2), "utf8");
    return structuredClone(INITIAL_STATE);
  }
}

export async function setState(state: TrackerState) {
  assertVercelStorageConfigured();
  const next = { ...state, version: state.version + 1, updatedAt: new Date().toISOString() };
  if (blobEnabled()) {
    const current = await getBlobState();
    if (!current || current.payload.version !== state.version) {
      throw new Error("The tracker changed in another officer session. Refresh and try again.");
    }
    await put(statePath, JSON.stringify(next), {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 60,
      allowOverwrite: true,
      ifMatch: current.etag,
    });
    return next;
  }
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}
