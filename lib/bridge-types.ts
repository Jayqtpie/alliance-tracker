import type { ExtractedRow, StormTeam } from "@/lib/types";

export type BridgeJobStatus = "pending" | "processing" | "completed" | "failed";
/**
 * Which screen the worker reads. A job saved without a kind is an Alliance Duel ranking; "storm" is a
 * storm's results mail, "storm-lineup" the game's View Participants list for one team.
 */
export type BridgeJobKind = "duel" | "storm" | "storm-lineup";

/** The week and team a storm screen belongs to, as the officer chose when uploading. */
export interface BridgeStormTarget {
  weekId: string;
  team: StormTeam;
}

/** What a storm lineup screen says about itself, read alongside its rows. Anything unreadable is left out. */
export interface BridgeLineupHeader {
  /** The Task Force the screen shows. */
  team?: StormTeam;
  /** The game's own starter and sub counts, to check no screenshot was missed. */
  starters?: number;
  subs?: number;
  /** The battle day and time as shown, with the game's Local or Server Time label. */
  battleTime?: string;
}

export interface BridgeFile {
  id: string;
  name: string;
  pathname: string;
  contentType: string;
  size: number;
}

export interface BridgeJob {
  id: string;
  status: BridgeJobStatus;
  kind?: BridgeJobKind;
  storm?: BridgeStormTarget;
  files: BridgeFile[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  attempts: number;
  workerId?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  error?: string;
  rows?: ExtractedRow[];
  lineup?: BridgeLineupHeader;
}

export interface BridgeJobView {
  id: string;
  status: BridgeJobStatus;
  kind: BridgeJobKind;
  storm?: BridgeStormTarget;
  fileCount: number;
  fileNames: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  attempts: number;
  error?: string;
  rows?: ExtractedRow[];
  lineup?: BridgeLineupHeader;
}

export interface BridgeQueue {
  version: number;
  jobs: BridgeJob[];
  updatedAt: string;
}
