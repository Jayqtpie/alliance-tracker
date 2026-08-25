import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dedupeRows } from "@/lib/tracker";
import { extractLeaderboard } from "@/lib/extract";
import { getState, setState } from "@/lib/store";
import { retainUpload } from "@/lib/uploads";
import type { UploadRecord } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...(await Promise.all(items.slice(index, index + size).map(work))));
  }
  return results;
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Screenshot extraction needs OPENAI_API_KEY. Manual paste is available without it." },
      { status: 503 },
    );
  }
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length !== 1) {
    return NextResponse.json({ error: "Send one screenshot per extraction request." }, { status: 400 });
  }
  if (files.some((file) => !file.type.startsWith("image/") || file.size > 4 * 1024 * 1024)) {
    return NextResponse.json({ error: "The file must be an image no larger than 4 MB." }, { status: 400 });
  }

  try {
    const extracted = await inBatches(files, 3, async (file) => extractLeaderboard(file));
    const uploads = await inBatches<File, UploadRecord>(files, 4, retainUpload);
    const state = await getState();
    await setState({ ...state, uploads: [...state.uploads, ...uploads] });
    const result = dedupeRows(extracted.flat());
    return NextResponse.json({ ...result, uploads, rawCount: extracted.flat().length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
