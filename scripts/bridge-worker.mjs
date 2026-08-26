import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

function loadEnvironmentFile(filename) {
  const target = resolve(filename);
  if (!existsSync(target)) return;
  for (const line of readFileSync(target, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvironmentFile(".env.local");
loadEnvironmentFile(".env.bridge.local");

const once = process.argv.includes("--once");
const bridgeUrl = (process.env.BRIDGE_URL || "https://alliance-tracker-nine.vercel.app").replace(/\/$/, "");
const secret = process.env.BRIDGE_SECRET || process.env.OFFICER_PASSCODE;
const workerId = `${hostname()}-${process.pid}`.slice(0, 100);
const extractor = resolve("scripts", "extract-local.mjs");
const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };

if (!secret) {
  console.error("Set BRIDGE_SECRET (or OFFICER_PASSCODE) in .env.bridge.local before starting the worker.");
  process.exit(1);
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${bridgeUrl}${pathname}`, options);
  if (response.status === 204) return undefined;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Bridge request failed with status ${response.status}.`);
  return body;
}

function extensionFor(file) {
  const existing = extname(file.name).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(existing)) return existing;
  return file.contentType === "image/png" ? ".png" : file.contentType === "image/webp" ? ".webp" : ".jpg";
}

async function downloadFiles(job, folder) {
  const images = new Array(job.files.length);
  for (let start = 0; start < job.files.length; start += 5) {
    await Promise.all(job.files.slice(start, start + 5).map(async (file, batchIndex) => {
      const index = start + batchIndex;
      const response = await fetch(`${bridgeUrl}/api/bridge/file?jobId=${encodeURIComponent(job.id)}&fileId=${encodeURIComponent(file.id)}`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      if (!response.ok) throw new Error(`Could not download ${file.name} (${response.status}).`);
      const target = join(folder, `${String(index + 1).padStart(2, "0")}${extensionFor(file)}`);
      writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      images[index] = target;
    }));
  }
  return images;
}

async function processJob(job) {
  const folder = mkdtempSync(join(tmpdir(), "alliance-bridge-"));
  try {
    console.log(`\nClaimed ${job.id}: downloading ${job.files.length} frame${job.files.length === 1 ? "" : "s"}...`);
    const images = await downloadFiles(job, folder);

    const output = join(folder, "result.json");
    const extraction = spawnSync(process.execPath, [extractor, "--out", output, ...images], { stdio: "inherit" });
    if (extraction.error || extraction.status !== 0) throw new Error("Local Codex extraction did not complete.");
    const parsed = JSON.parse(readFileSync(output, "utf8"));
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) throw new Error("Local Codex returned no ranking rows.");
    await request("/api/bridge/worker", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "complete", jobId: job.id, workerId, rows: parsed.rows }),
    });
    console.log(`Completed ${job.id}: ${parsed.rows.length} raw rows returned to Alliance Manager.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    console.error(`Bridge job ${job.id} failed: ${message}`);
    await request("/api/bridge/worker", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "fail", jobId: job.id, workerId, error: message }),
    }).catch((reason) => console.error(`Could not report failure: ${reason instanceof Error ? reason.message : reason}`));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

console.log(`Alliance Manager bridge worker ${workerId}`);
console.log(`Watching ${bridgeUrl}. Press Ctrl+C to stop.`);

do {
  try {
    const body = await request("/api/bridge/worker", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "claim", workerId }),
    });
    if (body?.job) await processJob(body.job);
    else if (once) console.log("No bridge jobs are waiting.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (once) process.exitCode = 1;
  }
  if (!once) await wait(10_000);
} while (!once);
