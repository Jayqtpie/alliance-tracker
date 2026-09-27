import type { Member } from "./types";

export const PROFESSIONS = ["Engineer", "War Leader"] as const;

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

/** Warzone numbers are three or four digits. Blank means nothing is recorded. */
export function parseServerId(input: string): number | null {
  const text = input.trim().replace(/^[sS#]/, "");
  if (!text || text === "—") return null;
  if (!/^\d{3,4}$/.test(text)) throw new Error("Use a three or four digit server number, such as 927. Leave blank for not recorded.");
  return Number(text);
}

export function serverLabel(server: number | null): string {
  return server === null ? "—" : `S${server}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Hashing a server number into a hue looked obvious and failed: the warzones in one
 * roster are a sparse set, so a third of the pairs landed within 25 degrees of each
 * other and several within 3. Spreading the hues evenly over the servers actually
 * present guarantees the widest separation the palette allows.
 *
 * Servers are ordered by number, then walked in golden-ratio strides so that
 * neighbours by number — 862 and 863, the pairs most easily confused — sit far
 * apart on the wheel. The stride is kept coprime with the count so every slot is
 * used exactly once. Paired with OKLCH in the stylesheet, which holds perceived
 * lightness constant across hue, no server reads louder than another.
 */
export function serverHuePalette(servers: number[]): Map<number, number> {
  const distinct = [...new Set(servers)].sort((a, b) => a - b);
  const count = distinct.length;
  let stride = 1;
  for (let offset = 0; offset < count && stride === 1; offset += 1) {
    for (const candidate of [Math.round(count * 0.381966) + offset, Math.round(count * 0.381966) - offset]) {
      if (candidate > 1 && candidate < count && greatestCommonDivisor(candidate, count) === 1) { stride = candidate; break; }
    }
  }
  return new Map(distinct.map((server, index) => [server, Math.round((index * stride % count) * (360 / count))]));
}

/**
 * Where a player came from and where they went. The officer correction wins over
 * the captured value; a departure server is only ever entered by hand.
 */
export function memberServers(member: Member) {
  const origin = member.originServer !== undefined ? member.originServer : member.gameProfile?.originServer ?? null;
  return { origin: origin ?? null, transferredTo: member.transferredTo ?? null };
}

function statDisplay(value: number | null): string {
  if (value === null) return "—";
  for (const [unit, divisor] of [["B", 1e9], ["M", 1e6], ["K", 1e3]] as const) {
    if (value >= divisor) return `${Number((value / divisor).toFixed(2))}${unit}`;
  }
  return String(value);
}

type CapturedStat = "heroPower" | "kills" | "power" | "profession";

/**
 * A manual stat holds until a newer capture measures that stat: whichever is more recent wins,
 * and an edit made on the capture's own day counts as the newer. A capture without a value for
 * the stat never displaces it.
 */
function manualStatInEffect(member: Member, key: CapturedStat): boolean {
  const manual = member.manualStats;
  if (manual?.[key] === undefined) return false;
  const profile = member.gameProfile;
  const captured = profile?.[key] ?? null;
  const capturedOn = key === "heroPower" ? profile?.heroPowerMeasuredAt ?? profile?.capturedOn : profile?.capturedOn;
  if (captured === null || !capturedOn) return true;
  return manual.updatedAt.slice(0, 10) >= capturedOn.slice(0, 10);
}

/** The manual stats still in effect; an edit carries these forward and drops the superseded ones. */
export function manualStatsInEffect(member: Member): Partial<NonNullable<Member["manualStats"]>> {
  const manual = member.manualStats;
  if (!manual) return {};
  return {
    ...(manualStatInEffect(member, "heroPower") ? { heroPower: manual.heroPower } : {}),
    ...(manualStatInEffect(member, "kills") ? { kills: manual.kills } : {}),
    ...(manualStatInEffect(member, "power") ? { power: manual.power } : {}),
    ...(manualStatInEffect(member, "profession") ? { profession: manual.profession } : {}),
  };
}

export function memberStats(member: Member) {
  const manualHeroPower = manualStatInEffect(member, "heroPower");
  const manualKills = manualStatInEffect(member, "kills");
  const manualPower = manualStatInEffect(member, "power");
  const heroPower = manualHeroPower ? member.manualStats!.heroPower ?? null : member.gameProfile?.heroPower ?? null;
  const kills = manualKills ? member.manualStats!.kills ?? null : member.gameProfile?.kills ?? null;
  const power = manualPower ? member.manualStats!.power ?? null : member.gameProfile?.power ?? null;
  return {
    heroPower, kills, power,
    profession: manualStatInEffect(member, "profession") ? member.manualStats!.profession ?? null : member.gameProfile?.profession ?? null,
    powerDisplay: manualPower ? statDisplay(power) : member.gameProfile?.powerDisplay ?? "—",
    heroPowerDisplay: manualHeroPower ? statDisplay(heroPower) : member.gameProfile?.heroPowerDisplay ?? "—",
    killsDisplay: manualKills ? statDisplay(kills) : member.gameProfile?.killsDisplay ?? "—",
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
  const professionCount = (profession: string) => stats.filter((stat) => stat.profession === profession).length;
  return { activeCount: active.length, heroPower: total("heroPower"), kills: total("kills"), engineers: professionCount("Engineer"), warLeaders: professionCount("War Leader") };
}
