import { upload } from "@vercel/blob/client";
import type { BridgeFile } from "@/lib/bridge-types";

/** Uploads a job's screenshots to private Blob, five at a time, reporting overall progress (0–99). */
export async function uploadBridgeFrames(jobId: string, files: File[], onProgress: (percent: number) => void): Promise<BridgeFile[]> {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const uploadedBytes = new Map<number, number>();
  const uploadedFiles: BridgeFile[] = [];
  for (let start = 0; start < files.length; start += 5) {
    const batch = files.slice(start, start + 5);
    const results = await Promise.all(batch.map(async (file, batchIndex) => {
      const index = start + batchIndex;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const id = `frame-${String(index + 1).padStart(2, "0")}`;
      const pathname = `bridge-uploads/${jobId}/${id}-${safeName}`;
      const blob = await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/bridge/upload",
        clientPayload: JSON.stringify({ jobId }),
        onUploadProgress: (progress) => {
          uploadedBytes.set(index, progress.loaded);
          const loaded = [...uploadedBytes.values()].reduce((total, value) => total + value, 0);
          onProgress(Math.min(99, Math.round((loaded / totalBytes) * 100)));
        },
      });
      return { id, name: file.name, pathname: blob.pathname, contentType: blob.contentType, size: file.size };
    }));
    uploadedFiles.push(...results);
  }
  return uploadedFiles;
}
