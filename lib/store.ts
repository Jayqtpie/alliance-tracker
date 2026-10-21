import "server-only";
import { BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobEnabled, blobToken } from "@/lib/blob";
import { readDocument, readDocumentAndField, redisEnabled, setField, setString, writeDocumentIfVersion } from "@/lib/redis";
import { createEmptyState } from "@/lib/alliance";
import type { TrackerState } from "@/lib/types";
import { hydrateOperations } from "@/lib/operations";
import { importCapturedRoster } from "@/lib/roster-import";
import { applyMemberProfileUpdates } from "@/lib/member-profile-updates";
import { applyProfileRefreshRetries } from "@/lib/profile-refresh-retries";
import { applyProfileStats } from "@/lib/profile-stats";
import { applyOriginServers } from "@/lib/origin-servers";
import { applyAliasCorrections } from "@/lib/alias-corrections";
import { applyPairingImport } from "@/lib/pairings-import";

const stateFile = path.join(process.cwd(), ".data", "tracker-state.json");
const statePath = "app-data/tracker-state.json";
const backupDir = "app-data/backups";
const stateKey = "tracker-state";

// Every one-shot data import, in the order each one's guards expect. Each returns
// the state unchanged once it has been applied, so an unchanged result is the
// signal that nothing needs saving.
const DATA_IMPORTS = [importCapturedRoster, applyMemberProfileUpdates, applyProfileRefreshRetries, applyProfileStats, applyOriginServers, applyAliasCorrections, applyPairingImport];

export function applyDataImports(state: TrackerState): TrackerState {
  return DATA_IMPORTS.reduce((current, apply) => apply(current), state);
}

// A preview deployment may share production's Blob store, so only production (or a local
// server) runs the one-shot imports. A review branch's preview can then never apply its capture.
function importsAllowed() {
  return !process.env.VERCEL || process.env.VERCEL_ENV === "production";
}

// An import overwrites the only copy of the state, and reverting its commit cannot undo that,
// so the state it replaces is copied aside first. Named by version: a version is replaced once.
// It writes the state this request read, not a server-side copy of the Blob: a concurrent
// request may already have imported, and copying then would back up the imported state.
async function backupState(state: TrackerState, incoming: string | undefined) {
  const name = `tracker-state-v${state.version}-before-${incoming ?? "import"}.json`;
  if (redisEnabled()) {
    await setString(`${stateKey}:backup:${name}`, JSON.stringify(state));
    return;
  }
  if (blobEnabled()) {
    await put(`${backupDir}/${name}`, JSON.stringify(state), {
      access: "private",
      token: blobToken(),
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  const dir = path.join(path.dirname(stateFile), "backups");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), JSON.stringify(state, null, 2), "utf8");
}

export class StateConflictError extends Error {
  constructor() {
    super("The tracker changed in another officer session. Refresh and try again.");
  }
}

function assertVercelStorageConfigured() {
  if (process.env.VERCEL && !redisEnabled() && !blobEnabled()) {
    throw new Error(
      "No shared storage is configured in this deployment. Connect Upstash Redis (or a private Blob store) to the project and redeploy.",
    );
  }
}

/** What the Blob state file holds once the data has moved to Redis. */
interface MovedMarker { movedTo: "redis"; movedAt: string; backup: string | null }

export class StorageMovedError extends Error {
  constructor(movedAt: string) {
    const date = movedAt.slice(0, 10);
    super(redisEnabled()
      ? `The tracker's data moved to Redis on ${date}, but the connected Redis database is empty. Reconnect the original database, or restore a backup with scripts/restore-state.mjs.`
      : `The tracker's data moved to Upstash Redis on ${date}, but this deployment has no Redis connection. Reconnect Upstash Redis in Vercel and redeploy.`);
  }
}

async function getBlobState() {
  const result = await get(statePath, { access: "private", useCache: false, token: blobToken() });
  if (!result || result.statusCode !== 200) return null;
  const stored = JSON.parse(await new Response(result.stream).text()) as TrackerState | MovedMarker;
  if ("movedTo" in stored) throw new StorageMovedError(stored.movedAt);
  const payload = { ...stored, operations: hydrateOperations(stored.operations) };
  return { payload };
}

export function storageMode() {
  return redisEnabled() ? "redis" : blobEnabled() ? "vercel-blob" : "local";
}

const blobRetiredField = "blobRetiredAt";

// The first read after Redis is connected carries the Blob state over, so nothing is lost in the move.
async function seedRedisState(initialState: TrackerState): Promise<TrackerState> {
  const seed = (blobEnabled() ? (await getBlobState())?.payload : null) ?? initialState;
  if (await writeDocumentIfVersion(stateKey, null, seed)) return seed;
  const seededByAnotherRequest = await readDocument<TrackerState>(stateKey);
  if (seededByAnotherRequest) return seededByAnotherRequest;
  throw new Error("Could not initialise Redis state.");
}

// Once Redis holds the data, the Blob copy is backed up and replaced by a marker. A deployment that
// loses its Redis connection then refuses to load, instead of quietly serving and saving a frozen copy.
async function retireBlobState() {
  const movedAt = new Date().toISOString();
  let backup: string | null = null;
  try {
    const current = await getBlobState();
    if (current) {
      backup = `${backupDir}/tracker-state-v${current.payload.version}-before-redis.json`;
      await put(backup, JSON.stringify(current.payload), { access: "private", token: blobToken(), contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
    }
  } catch (error) {
    // An earlier attempt already left the marker but could not record it.
    if (!(error instanceof StorageMovedError)) throw error;
    await setField(stateKey, blobRetiredField, movedAt);
    return;
  }
  const marker: MovedMarker = { movedTo: "redis", movedAt, backup };
  await put(statePath, JSON.stringify(marker), { access: "private", token: blobToken(), contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  await setField(stateKey, blobRetiredField, movedAt);
}

async function getRedisState(initialState: TrackerState): Promise<TrackerState> {
  const { value: stored, field: retired } = await readDocumentAndField<TrackerState>(stateKey, blobRetiredField);
  const state = stored ?? await seedRedisState(initialState);
  if (!retired && blobEnabled()) {
    // Redis already has the data, so a failure here (Blob blocked, say) must not take the app down.
    try { await retireBlobState(); }
    catch (error) { console.error("Could not retire the Blob copy of the tracker state; retrying on the next load.", error); }
  }
  return { ...state, operations: hydrateOperations(state.operations) };
}

async function getStoredState(): Promise<TrackerState> {
  assertVercelStorageConfigured();
  const initialState = createEmptyState();
  if (redisEnabled()) return getRedisState(initialState);
  if (blobEnabled()) {
    const current = await getBlobState();
    if (current) return current.payload;
    try {
      await put(statePath, JSON.stringify(initialState), {
        access: "private",
        token: blobToken(),
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return initialState;
    } catch {
      const createdByAnotherRequest = await getBlobState();
      if (createdByAnotherRequest) return createdByAnotherRequest.payload;
      throw new Error("Could not initialise Vercel Blob state.");
    }
  }

  try {
    const stored = JSON.parse(await readFile(stateFile, "utf8")) as TrackerState;
    return { ...stored, operations: hydrateOperations(stored.operations) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(initialState, null, 2), { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return getStoredState();
  }
}

async function loadState(): Promise<TrackerState> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await getStoredState();
    if (!importsAllowed()) return stored;
    const imported = applyDataImports(stored);
    if (imported === stored) return stored;
    // No backup, no import: the app keeps serving the current state until a backup succeeds.
    try {
      await backupState(stored, imported.rosterImport);
    } catch (error) {
      console.error("Skipped the data import: could not back up the current state first.", error);
      return stored;
    }
    try {
      return await setState(imported);
    } catch (error) {
      if (!(error instanceof StateConflictError)) throw error;
      // Reapply the import to fresh state, preserving a concurrent officer edit.
    }
  }
  const latest = await getStoredState();
  if (applyDataImports(latest) === latest) return latest;
  throw new StateConflictError();
}

async function saveState(state: TrackerState) {
  assertVercelStorageConfigured();
  const next = { ...state, version: state.version + 1, updatedAt: new Date().toISOString() };
  if (redisEnabled()) {
    if (!(await writeDocumentIfVersion(stateKey, state.version, next))) throw new StateConflictError();
    return next;
  }
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

export async function getState(): Promise<TrackerState> {
  try { return await loadState(); }
  catch (error) {
    if (error instanceof StateConflictError || error instanceof StorageMovedError) throw error;
    throw new Error("Could not load shared tracker data. Please try again.");
  }
}

export async function setState(state: TrackerState) {
  try { return await saveState(state); }
  catch (error) {
    if (error instanceof StateConflictError || error instanceof StorageMovedError) throw error;
    throw new Error("Could not save shared tracker data. Please try again.");
  }
}
