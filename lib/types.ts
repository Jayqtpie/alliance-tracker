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

export type StormType = "desert" | "canyon";
export type StormStatus = "draft" | "registration-open" | "locked" | "completed" | "cancelled";
export type StormAvailability = "no-response" | "available" | "maybe" | "unavailable";
export type StormRole = "unassigned" | "starter" | "substitute" | "reserve";
export type StormAttendance = "unknown" | "attended" | "no-show" | "late-cancel" | "substitute-used";

export interface StormParticipant {
  memberId: string;
  availability: StormAvailability;
  role: StormRole;
  confirmed: boolean;
  assignment?: string;
  attendance: StormAttendance;
  score?: number;
  notes?: string;
}

export interface StormEvent {
  id: string;
  type: StormType;
  team: "A" | "B";
  battleAt: string;
  registrationDeadline?: string;
  status: StormStatus;
  starterLimit: number;
  substituteLimit: number;
  officerNotes?: string;
  opponent?: string;
  result?: "unknown" | "win" | "loss" | "draw";
  allianceScore?: number;
  opponentScore?: number;
  participants: StormParticipant[];
}

export type TrainVipType = "none" | "guardian-defender" | "special-guest";
export type TrainStatus = "planned" | "completed" | "reassigned" | "skipped";
export type TrainInvitationStatus = "not-sent" | "pending" | "accepted" | "declined" | "expired";

export interface TrainAssignment {
  id: string;
  date: string;
  conductorMemberId?: string;
  vipType: TrainVipType;
  vipMemberId?: string;
  backupMemberId?: string;
  invitationStatus: TrainInvitationStatus;
  status: TrainStatus;
  notes?: string;
}

export interface OperationsState {
  stormEvents: StormEvent[];
  guardianPool: string[];
  trainAssignments: TrainAssignment[];
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
  operations?: OperationsState;
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
