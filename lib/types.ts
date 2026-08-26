export type SnapshotStatus = "live" | "final";

export interface Member {
  id: string;
  canonicalName: string;
  aliases: string[];
  active: boolean;
  joinedAt?: string;
  leftAt?: string;
  notes?: string;
}

export interface RankingEntry {
  id: string;
  memberId?: string;
  rank: number;
  displayName: string;
  points: number;
  confidence: number;
  sourceFile?: string;
  needsReview?: boolean;
}

export interface Snapshot {
  id: string;
  capturedAt: string;
  weekStart: string;
  dayLabel: string;
  status: SnapshotStatus;
  sourceType: "screenshots" | "video" | "local-codex" | "manual";
  notes?: string;
  createdBy?: string;
  entries: RankingEntry[];
}

export interface UploadRecord {
  id: string;
  name: string;
  storagePath: string;
  uploadedAt: string;
  expiresAt: string;
}

export interface TrackerState {
  version: number;
  alliance: {
    name: string;
    tag: string;
    server: string;
  };
  members: Member[];
  snapshots: Snapshot[];
  uploads: UploadRecord[];
  updatedAt: string;
}

export interface ExtractedRow {
  rank: number;
  displayName: string;
  points: number;
  confidence: number;
  isPinned?: boolean;
  sourceFile?: string;
  needsReview?: boolean;
}
