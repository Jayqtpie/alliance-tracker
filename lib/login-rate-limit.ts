import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_BUCKETS = 5000;
const attempts = new Map<string, { count: number; until: number }>();

// Defense in depth per process. Production also needs an edge/shared rate limit.
export function loginRetryAfter(request: Request, now = Date.now()) {
  // Trust platform-supplied IPs only on Vercel. Local forwarded headers are spoofable.
  const address = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : undefined;
  const key = address && isIP(address) ? createHash("sha256").update(address).digest("hex") : "local";
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  let entry = attempts.get(key);
  if (!entry) {
    // Do not evict active restrictions when an attacker supplies many identities.
    if (attempts.size >= MAX_BUCKETS) return Math.ceil(WINDOW_MS / 1000);
    entry = { count: 0, until: now + WINDOW_MS };
    attempts.set(key, entry);
  }
  if (entry.count >= MAX_ATTEMPTS) return Math.max(1, Math.ceil((entry.until - now) / 1000));
  entry.count += 1;
  return 0;
}
