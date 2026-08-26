import type { ExtractedRow } from "@/lib/types";

export type BridgeJobStatus = "pending" | "processing" | "completed" | "failed";

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
