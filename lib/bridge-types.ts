import type { ExtractedRow, StormTeam } from "@/lib/types";

export type BridgeJobStatus = "pending" | "processing" | "completed" | "failed";
/** Which screen the worker reads. A job saved without a kind is an Alliance Duel ranking. */
export type BridgeJobKind = "duel" | "storm";

/** The week and team a storm results mail belongs to; the mail itself names neither. */
export interface BridgeStormTarget {
  weekId: string;
  team: StormTeam;
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
}

export interface BridgeQueue {
  version: number;
  jobs: BridgeJob[];
  updatedAt: string;
}
