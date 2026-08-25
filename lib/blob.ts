import "server-only";

export function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB1_READ_WRITE_TOKEN;
}

export function blobEnabled() {
  return Boolean(blobToken());
}
