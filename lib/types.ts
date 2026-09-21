export type SnapshotStatus = "live" | "final";

export interface Member {
  id: string;
  canonicalName: string;
  aliases: string[];
  previousNames?: string[];
  active: boolean;
  joinedAt?: string;
  leftAt?: string;
  notes?: string;
  /** Officer correction to the source origin server. Absent means use the captured value. */
  originServer?: number | null;
  /** Server this player moved to when they left. Manual only: the source cannot see departed players. */
  transferredTo?: number | null;
  manualStats?: { power?: number | null; heroPower?: number | null; kills?: number | null; profession?: string | null; updatedAt: string };
  gameProfile?: {
    uid: string;
    rank: string;
    avatarPath: string;
    heroPower: number | null;
    heroPowerDisplay: string;
    heroPowerLegacy: boolean;
    kills: number | null;
    killsDisplay: string;
    power?: number | null;
    powerDisplay?: string;
    profession?: string | null;
    /** Server the player started on, from the source capture. */
    originServer?: number | null;
    capturedOn: string;
    sourceActivityDate?: string;
    lastRankPublicId?: string;
    sourceUpdatedAt?: string;
    heroPowerMeasuredAt?: string;
    refreshStatus?: "fresh" | "retained";
    refreshAttemptedOn?: string;
    source: string;
  };
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
  reviewed?: boolean;
}

export interface Snapshot {
  id: string;
  /** Older captures are protected unless explicitly unlocked. */
  deletionLocked?: boolean;
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

export interface PairingRow {
  id: string;
  warLeaderId?: string;
  engineerId?: string;
}

export type SvsAttendance = "present" | "absent" | "excused";

export interface SvsEvent {
  id: string;
  /** Fight date, YYYY-MM-DD. */
  date: string;
  label?: string;
  /** Roster captured when the fight was created, keyed by member id. */
  attendance: Record<string, SvsAttendance>;
}

export interface TrackerState {
  version: number;
  rosterImport?: string;
  pairingImport?: string;
  memberProfileUpdates?: string[];
  alliance: {
    name: string;
    tag: string;
    server: string;
    emblem?: string | null;
  };
  members: Member[];
  snapshots: Snapshot[];
  uploads: UploadRecord[];
  operations?: OperationsState;
  pairings?: PairingRow[];
  svsEvents?: SvsEvent[];
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
  reviewed?: boolean;
}
