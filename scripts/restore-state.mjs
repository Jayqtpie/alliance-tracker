// Restores the tracker state from a pre-import backup in Redis.
//   node scripts/restore-state.mjs              lists the backups
//   node scripts/restore-state.mjs <backup-key> replaces the live state with that backup
// Needs KV_REST_API_URL and KV_REST_API_TOKEN (Upstash console → the database → REST API).
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN first.");
  process.exit(1);
}

async function command(args) {
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(`${args[0]} failed: ${body.error || response.status}`);
  return body.result;
}

const key = process.argv[2];
if (!key) {
  const keys = await command(["KEYS", "tracker-state:backup:*"]);
  console.log(keys.length ? keys.sort().join("\n") : "No backups.");
  process.exit(0);
}

const backup = await command(["GET", key]);
if (backup === null) {
  console.error(`No backup at ${key}.`);
  process.exit(1);
}
const live = await command(["HGET", "tracker-state", "version"]);
const version = JSON.parse(backup).version;
await command(["HSET", "tracker-state", "json", backup, "version", String(version)]);
console.log(`Restored version ${version} over live version ${live}. Officer edits made since the backup are gone.`);
