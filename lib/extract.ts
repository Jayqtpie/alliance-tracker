import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import type { ExtractedRow } from "@/lib/types";

const outputSchema = z.object({
  rows: z.array(
    z.object({
      rank: z.number().int().positive(),
      displayName: z.string().min(1),
      points: z.number().int().nonnegative(),
      confidence: z.number().min(0).max(1),
      isPinned: z.boolean(),
      needsReview: z.boolean(),
    }),
  ),
});

export async function extractLeaderboard(file: File): Promise<ExtractedRow[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured. Use manual entry or add the key in Vercel.");
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const image = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mime = file.type || "image/png";
  const response = await openai.responses.create({
    model: process.env.OPENAI_VISION_MODEL || "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Extract only complete player rows from this Last War Alliance Duel Weekly Rank screenshot. " +
              "For each row return rank, commander display name exactly as shown (preserve Unicode, spacing and case), and integer points without commas. " +
              "The green card fixed at the bottom is the viewer's pinned rank: mark it isPinned=true so it can be discarded. " +
              "Do not include headers, alliance text, chat banners, or partially obscured rows. Mark needsReview for ambiguous characters. " +
              "Return JSON only as {rows:[{rank,displayName,points,confidence,isPinned,needsReview}]}",
          },
          { type: "input_image", image_url: `data:${mime};base64,${image}`, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "leaderboard_rows",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  rank: { type: "integer" },
                  displayName: { type: "string" },
                  points: { type: "integer" },
                  confidence: { type: "number" },
                  isPinned: { type: "boolean" },
                  needsReview: { type: "boolean" },
                },
                required: ["rank", "displayName", "points", "confidence", "isPinned", "needsReview"],
              },
            },
          },
          required: ["rows"],
        },
      },
    },
  });
  const parsed = outputSchema.parse(JSON.parse(response.output_text));
  return parsed.rows.map((row) => ({ ...row, sourceFile: file.name }));
}
