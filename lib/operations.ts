import type { OperationsState, TrainAssignment } from "@/lib/types";

export const EMPTY_OPERATIONS: OperationsState = {
  stormEvents: [],
  guardianPool: [],
  trainAssignments: [],
};

export function hydrateOperations(operations?: Partial<OperationsState>): OperationsState {
  return {
    stormEvents: Array.isArray(operations?.stormEvents) ? operations.stormEvents : [],
    guardianPool: Array.isArray(operations?.guardianPool) ? operations.guardianPool.slice(0, 7) : [],
    trainAssignments: Array.isArray(operations?.trainAssignments) ? operations.trainAssignments : [],
  };
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mondayFor(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

export function assignmentsForWeek(assignments: TrainAssignment[], weekStart: string) {
  const end = addDays(weekStart, 6);
  return assignments.filter((assignment) => assignment.date >= weekStart && assignment.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

export function applyGuardianRotation(operations: OperationsState, weekStart: string): OperationsState {
  const outsideWeek = operations.trainAssignments.filter((assignment) => assignment.date < weekStart || assignment.date > addDays(weekStart, 6));
  const existing = new Map(assignmentsForWeek(operations.trainAssignments, weekStart).map((assignment) => [assignment.date, assignment]));
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const current = existing.get(date);
    return {
      id: current?.id || crypto.randomUUID(),
      date,
      conductorMemberId: current?.conductorMemberId,
      vipType: "guardian-defender",
      vipMemberId: operations.guardianPool[index],
      backupMemberId: current?.backupMemberId,
      invitationStatus: current?.invitationStatus || "not-sent",
      status: current?.status || "planned",
      notes: current?.notes,
    } satisfies TrainAssignment;
  });
  return { ...operations, trainAssignments: [...outsideWeek, ...week].sort((a, b) => a.date.localeCompare(b.date)) };
}
