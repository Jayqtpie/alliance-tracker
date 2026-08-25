import "server-only";
import { del, put } from "@vercel/blob";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UploadRecord } from "@/lib/types";

const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function retainUpload(file: File): Promise<UploadRecord> {
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const storagePath = `${new Date().toISOString().slice(0, 10)}/${id}-${safeName}`;
  const uploadedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + FIVE_DAYS).toISOString();
  const bytes = Buffer.from(await file.arrayBuffer());
  if (blobEnabled()) {
    await put(storagePath, bytes, {
      access: "private",
      contentType: file.type,
      addRandomSuffix: false,
      maximumSizeInBytes: 4 * 1024 * 1024,
      cacheControlMaxAge: 60,
    });
  } else {
    const target = path.join(process.cwd(), ".data", "uploads", storagePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  return { id, name: file.name, storagePath, uploadedAt, expiresAt };
}

export async function removeUploads(records: UploadRecord[]) {
  if (!records.length) return;
  if (blobEnabled()) {
    await del(records.map((record) => record.storagePath));
    return;
  }
  await Promise.all(
    records.map((record) =>
      unlink(path.join(process.cwd(), ".data", "uploads", record.storagePath)).catch(() => undefined),
    ),
  );
}
