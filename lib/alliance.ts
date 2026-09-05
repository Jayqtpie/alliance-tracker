import { z } from "zod";
import type { TrackerState } from "./types";

export const allianceSchema = z.object({
  name: z.string().trim().min(1, "Enter your alliance name.").max(80),
  tag: z.string().trim().min(1, "Enter your alliance tag.").max(8).regex(/^[\p{L}\p{N}]+$/u, "Use only letters and numbers for the tag."),
  server: z.string().trim().regex(/^[1-9]\d{0,5}$/, "Enter a server number from 1 to 999999."),
  // Custom emblems are small, browser-normalised PNGs saved with the identity.
  emblem: z.string().max(260_000, "Choose a smaller emblem.").regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/, "Choose a valid emblem image.").nullable().optional(),
});

export function allianceNeedsSetup(alliance: TrackerState["alliance"]) {
  return !alliance.name || !alliance.tag || !alliance.server;
}

export function createEmptyState(): TrackerState {
  return {
    version: 1,
    // Never apply the bundled historical RSCL import to a customer installation.
    rosterImport: "custom-alliance",
    alliance: { name: "", tag: "", server: "" },
    members: [], snapshots: [], uploads: [],
    operations: { stormEvents: [], guardianPool: [], trainAssignments: [] },
    updatedAt: new Date().toISOString(),
  };
}

export function allianceFilePrefix(alliance: TrackerState["alliance"]) {
  const tag = alliance.tag.replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase() || "alliance";
  return `${tag}-${alliance.server.replace(/\D/g, "") || "server"}`;
}
