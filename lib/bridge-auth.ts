import "server-only";
import { timingSafeEqual } from "node:crypto";
import { blobEnabled } from "@/lib/blob";

function workerSecret() {
  return process.env.BRIDGE_SECRET || process.env.OFFICER_PASSCODE;
}

function equal(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function bridgeConfigured() {
  return blobEnabled() && Boolean(workerSecret());
}

export function isBridgeWorker(request: Request) {
  const secret = workerSecret();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(secret && supplied && equal(secret, supplied));
}
