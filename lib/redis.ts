import "server-only";

// Upstash Redis over its REST API: one POST per command, no client library.
// The Vercel Marketplace integration sets the KV_* names; a direct Upstash setup sets UPSTASH_*.
function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export function redisEnabled() {
  return config() !== null;
}

async function command<T>(args: string[]): Promise<T> {
  const settings = config();
  if (!settings) throw new Error("Redis is not configured.");
  const response = await fetch(settings.url, {
    method: "POST",
    headers: { authorization: `Bearer ${settings.token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { result?: T; error?: string };
  if (!response.ok || body.error) throw new Error(`Redis ${args[0]} failed: ${body.error || response.status}`);
  return body.result as T;
}

// A document is a hash of its JSON and its version. The write compares the stored version with the
// one the caller read and replaces both in one step, so two officers saving at once cannot both win.
// An empty expected version means the document must not exist yet.
const WRITE_IF_VERSION = `
local current = redis.call('HGET', KEYS[1], 'version')
if (current or '') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'json', ARGV[2], 'version', ARGV[3])
return 1`;

export async function readDocument<T>(key: string): Promise<T | null> {
  const json = await command<string | null>(["HGET", key, "json"]);
  return json === null ? null : JSON.parse(json) as T;
}

/** The document and one other field of its hash, in a single command. */
export async function readDocumentAndField<T>(key: string, field: string): Promise<{ value: T | null; field: string | null }> {
  const [json, extra] = await command<[string | null, string | null]>(["HMGET", key, "json", field]);
  return { value: json === null ? null : JSON.parse(json) as T, field: extra };
}

export async function setField(key: string, field: string, value: string) {
  await command(["HSET", key, field, value]);
}

/** False when the stored version is not `expected` (null: when the document already exists). */
export async function writeDocumentIfVersion(key: string, expected: number | null, value: { version: number }) {
  const written = await command<number>(["EVAL", WRITE_IF_VERSION, "1", key, expected === null ? "" : String(expected), JSON.stringify(value), String(value.version)]);
  return written === 1;
}

export async function setString(key: string, value: string) {
  await command(["SET", key, value]);
}
