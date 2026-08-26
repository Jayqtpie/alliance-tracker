import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { blobToken } from "@/lib/blob";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      token: blobToken(),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!(await isAuthenticated())) throw new Error("Unauthorised");
        const payload = JSON.parse(clientPayload || "null") as { jobId?: string } | null;
        if (!payload?.jobId || !/^[0-9a-f-]{36}$/i.test(payload.jobId)) throw new Error("Invalid bridge job.");
        if (!pathname.startsWith(`bridge-uploads/${payload.jobId}/`)) throw new Error("Invalid upload path.");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
          maximumSizeInBytes: 4 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authorise the bridge upload.";
    return NextResponse.json({ error: message }, { status: /Unauthorised/.test(message) ? 401 : 400 });
  }
}
