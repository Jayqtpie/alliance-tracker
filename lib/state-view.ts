import "server-only";
import type { AccessRole } from "./auth";
import type { TrackerState } from "./types";

// Project before serializing either RSC props or JSON. Never persist this view.
export function stateForRole(state: TrackerState, role: AccessRole): TrackerState {
  if (role === "admin") return state;
  return {
    version: state.version, updatedAt: state.updatedAt, alliance: state.alliance, uploads: [],
    members: state.members.map((member) => ({
      id: member.id, canonicalName: member.canonicalName, aliases: member.aliases,
      previousNames: member.previousNames, active: member.active,
      joinedAt: member.joinedAt, leftAt: member.leftAt,
      manualStats: member.manualStats, gameProfile: member.gameProfile,
    })),
    snapshots: state.snapshots.map((snapshot) => ({
      id: snapshot.id, deletionLocked: snapshot.deletionLocked,
      capturedAt: snapshot.capturedAt, weekStart: snapshot.weekStart,
      dayLabel: snapshot.dayLabel, status: snapshot.status, sourceType: snapshot.sourceType,
      entries: snapshot.entries.map((entry) => ({
        id: entry.id, memberId: entry.memberId, rank: entry.rank,
        displayName: entry.displayName, points: entry.points, confidence: entry.confidence,
        needsReview: entry.needsReview, reviewed: entry.reviewed,
      })),
    })),
  };
}
