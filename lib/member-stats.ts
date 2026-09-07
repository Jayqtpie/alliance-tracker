import type { Member } from "./types";

export function parseMemberStat(input: string): number | null {
  const text = input.trim();
  if (!text || text === "—") return null;
  const match = text.match(/^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?\s*([KMB])?$/i);
  if (!match) throw new Error("Use a non-negative number, such as 125,000,000 or 125M. Leave blank for unavailable.");
  const value = Number(`${match[1].replaceAll(",", "")}.${match[2] ?? "0"}`) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[3]?.toUpperCase()] ?? 1);
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0 || Math.abs(value - rounded) > 1e-6) throw new Error("Enter a non-negative whole number within the supported range.");
  return rounded;
}

function statDisplay(value: number | null): string {
  if (value === null) return "—";
  for (const [unit, divisor] of [["B", 1e9], ["M", 1e6], ["K", 1e3]] as const) {
    if (value >= divisor) return `${Number((value / divisor).toFixed(2))}${unit}`;
  }
  return String(value);
}

export function memberStats(member: Member) {
  const heroPower = member.manualStats?.heroPower !== undefined ? member.manualStats.heroPower : member.gameProfile?.heroPower ?? null;
  const kills = member.manualStats?.kills !== undefined ? member.manualStats.kills : member.gameProfile?.kills ?? null;
  return {
    heroPower, kills,
    heroPowerDisplay: member.manualStats?.heroPower !== undefined ? statDisplay(heroPower) : member.gameProfile?.heroPowerDisplay ?? "—",
    killsDisplay: member.manualStats?.kills !== undefined ? statDisplay(kills) : member.gameProfile?.killsDisplay ?? "—",
  };
}

export function allianceStatTotals(members: Member[]) {
  const active = members.filter((member) => member.active);
  const stats = active.map(memberStats);
  const total = (key: "heroPower" | "kills") => {
    const recorded = stats.filter((stat) => stat[key] !== null);
    const value = recorded.length ? recorded.reduce((sum, stat) => sum + (stat[key] ?? 0), 0) : null;
    return { value, display: statDisplay(value), recorded: recorded.length };
  };
  return { activeCount: active.length, heroPower: total("heroPower"), kills: total("kills") };
}
