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

export type AttendanceEventKind = "svs" | "goldvein";

export interface SvsEvent {
  id: string;
  /** Fight date, YYYY-MM-DD. */
  date: string;
  label?: string;
  /** Missing on fights recorded before Goldvein existed; those are SvS. */
  kind?: AttendanceEventKind;
  /** Attendance is final: the fight can be unlocked, but not edited or deleted while locked. */
  locked?: boolean;
  /** Roster captured when the fight was created, keyed by member id. */
  attendance: Record<string, SvsAttendance>;
}

export type StormTeam = "A" | "B";
export type StormSlotRole = "starter" | "sub";
export type StormResult = "played" | "missed" | "excused";

export interface StormSlot {
  memberId: string;
  team: StormTeam;
  role: StormSlotRole;
  /** Unset until an officer records it. */
  result?: StormResult;
  /** Officer override of the parking rule for the next week; unset follows the rule. */
  park?: boolean;
}

/** One weekly Desert Storm or Canyon Storm: the lineup across both teams and how each slot went. */
export interface StormWeek {
  id: string;
  kind: StormType;
  /** Battle date, YYYY-MM-DD. */
  date: string;
  /** Final: the week can be unlocked, but not edited or deleted while locked. */
  locked?: boolean;
  /**
   * Teams whose lineup here matches the one entered in the game. Only these have starters marked
   * missed by a results import; changing a team's lineup takes it off this list.
   */
  confirmed?: StormTeam[];
  /** Each team's battle time as the game showed it when the lineup was confirmed, e.g. "2026-10-23 02:00~02:30 (Local Time)". */
  times?: Partial<Record<StormTeam, string>>;
  slots: StormSlot[];
}

export type RallyMode = "balanced" | "tiered";

/** One rally: `slots[0]` is the leader, who must be a War Leader; the other four are joiners. Null is an empty slot. */
export interface RallySquad {
  id: string;
  slots: (string | null)[];
}

export interface RallyBoard {
  mode: RallyMode;
  squads: RallySquad[];
  /** Members a suggestion leaves where they are. */
  pinned: string[];
  /** Members who are not online for this event, so a suggestion skips them. */
  unavailable: string[];
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
  stormWeeks?: StormWeek[];
  rallyBoard?: RallyBoard;
  updatedAt: string;
}

export interface ExtractedRow {
  rank: number;
  displayName: string;
  /** Score, or for a storm lineup screen (which has neither ranks nor scores) the player's hero power. */
  points: number;
  /** Storm lineup screen only: where the game seats the player. */
  role?: StormSlotRole;
  confidence: number;
  isPinned?: boolean;
  sourceFile?: string;
  needsReview?: boolean;
  reviewed?: boolean;
}
