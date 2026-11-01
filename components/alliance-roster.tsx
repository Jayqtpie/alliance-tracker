"use client";

import Image from "next/image";
import { Crown, Search, Swords, Users, Wrench, X, Zap } from "lucide-react";
import { type CSSProperties, useId, useState } from "react";
import type { Member, TrackerState } from "@/lib/types";
import { MemberName } from "./member-name";
import { MemberActions } from "./member-actions";
import { useLanguage } from "./language-selector";

import { EditMemberDialog } from "./edit-member-dialog";
import { allianceStatTotals, memberServers, memberStats, serverHuePalette, serverLabel } from "@/lib/member-stats";

const ROSTER_RANK_FILTERS = [
  { value: "all", label: "All" },
  { value: "R5", label: "Leader" },
  { value: "R4", label: "R4" },
  { value: "R3", label: "R3" },
  { value: "R2", label: "R2" },
  { value: "R1", label: "R1" },
] as const;
type RosterRankFilter = (typeof ROSTER_RANK_FILTERS)[number]["value"];

export function MemberAvatar({ member, large = false }: { member: Member; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`alliance-avatar${large ? " large" : ""}`}>
    {member.gameProfile?.avatarPath && !failed
      ? <Image src={member.gameProfile.avatarPath} alt="" width={large ? 56 : 36} height={large ? 56 : 36} unoptimized onError={() => setFailed(true)} />
      : member.canonicalName.trim().charAt(0).toLocaleUpperCase() || "?"}
  </span>;
}

/** A player who started on this alliance's own warzone carries no tag. */
export function memberServerTags(member: Member, homeServer: string) {
  const { origin, transferredTo } = memberServers(member);
  return { origin: origin !== null && String(origin) !== String(homeServer) ? origin : null, transferredTo };
}

function ServerTags({ member, homeServer, hues }: { member: Member; homeServer: string; hues: Map<number, number> }) {
  const { t } = useLanguage();
  const { origin, transferredTo } = memberServerTags(member, homeServer);
  if (origin === null && transferredTo === null) return null;
  return <span className="member-server-tags">
    {origin !== null && <b className="member-server-tag" style={{ "--server-hue": hues.get(origin) ?? 0 } as CSSProperties} title={t("Came from server {server}", { server: origin })}>{serverLabel(origin)}</b>}
    {transferredTo !== null && <b className="member-server-tag departed" title={t("Transferred to server {server}", { server: transferredTo })}>→ {serverLabel(transferredTo)}</b>}
  </span>;
}

export function AllianceRoster({ canManage = false, state, onOpenMember, onMergeMember, onDeleteMember, onSaved }: { canManage?: boolean; state: TrackerState; onSaved: (state: TrackerState) => void; onOpenMember: (id: string) => void; onMergeMember: (id: string) => void; onDeleteMember: (id: string) => void }) {
  const { language, t } = useLanguage();
  const [editingId, setEditingId] = useState<string>();
  const editingMember = state.members.find((member) => member.id === editingId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [sort, setSort] = useState("heroPower");
  const [rankFilter, setRankFilter] = useState<RosterRankFilter>("all");
  const rosterListId = useId();
  const active = state.members.filter((member) => member.active);
  const totals = allianceStatTotals(state.members);
  // Built from the whole roster, not the filtered view, so a search or a rank
  // filter never repaints the tags that stay on screen.
  const serverHues = serverHuePalette(state.members
    .map((member) => memberServerTags(member, state.alliance.server).origin)
    .filter((server): server is number => server !== null));
  const leader = active.find((member) => member.gameProfile?.rank === "R5");
  const lastUpdated = active.flatMap((member) => [member.gameProfile?.capturedOn, member.manualStats?.updatedAt])
    .filter((date): date is string => Boolean(date)).map((date) => date.slice(0, 10)).sort().at(-1);
  const membership = state.members.filter((member) => filter === "missing-profile" ? !member.gameProfile : filter === "active" ? member.active : !member.active);
  const ordered = [...membership].sort((a, b) => {
    if (sort === "name") return a.canonicalName.localeCompare(b.canonicalName);
    if (sort === "rank") {
      const rankPosition = (member: Member) => ROSTER_RANK_FILTERS.findIndex((rank) => rank.value === member.gameProfile?.rank);
      const aRank = rankPosition(a);
      const bRank = rankPosition(b);
      return (aRank < 0 ? Infinity : aRank) - (bRank < 0 ? Infinity : bRank)
        || (memberStats(b).heroPower ?? -1) - (memberStats(a).heroPower ?? -1)
        || a.canonicalName.localeCompare(b.canonicalName);
    }
    const key = sort as "heroPower" | "kills";
    return (memberStats(b)[key] ?? -1) - (memberStats(a)[key] ?? -1);
  });
  const filtered = ordered.map((member, index) => ({ member, position: index + 1 })).filter(({ member }) =>
    (rankFilter === "all" || member.gameProfile?.rank === rankFilter) &&
    [member.canonicalName, ...member.aliases].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectedRankLabel = t(ROSTER_RANK_FILTERS.find((item) => item.value === rankFilter)?.label || "All");
  const [membershipError, setMembershipError] = useState("");

  async function setMemberActive(member: Member) {
    setMembershipError("");
    try {
      const response = await fetch("/api/members", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-active", memberId: member.id, active: !member.active, version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not update roster membership."));
      onSaved(body);
    } catch (reason) {
      setMembershipError(reason instanceof Error ? reason.message : t("Could not update roster membership."));
    }
  }

  return <div className="page-stack alliance-roster-page">
    <section className="dashboard-heading">
      <div><p className="eyebrow">{t("THE PEOPLE BEHIND THE ALLIANCE")}</p><h1>{t("Alliance roster")}<span>.</span></h1>
        <p className="alliance-source-date">{lastUpdated ? t("Last updated {date}", { date: new Intl.DateTimeFormat(language === "en" ? "en-GB" : language, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${lastUpdated}T00:00:00Z`)) }) : t("No profile updates")}</p>
      </div>
      <dl className="alliance-totals" aria-label={t("Active alliance totals")}>
        {([
          { key: "heroPower", label: "Total hero power", Icon: Zap },
          { key: "kills", label: "Total kills", Icon: Swords },
        ] as const).map(({ key, label, Icon }) => <div className="alliance-total" data-stat={key} key={key}>
          <dt><Icon size={14} aria-hidden="true" />{t(label)}</dt>
          <dd><strong>{totals[key].display}</strong><span>{t("{recorded} / {total} active members recorded", { recorded: totals[key].recorded, total: totals.activeCount })}</span></dd>
        </div>)}
        {([
          { key: "engineers", label: "Engineers", Icon: Wrench },
          { key: "warLeaders", label: "War Leaders", Icon: Crown },
        ] as const).map(({ key, label, Icon }) => <div className="alliance-total" data-stat={key} key={key}>
          <dt><Icon size={14} aria-hidden="true" />{t(label)}</dt>
          <dd><strong>{totals[key]}</strong><span>{t("of {total} active members", { total: totals.activeCount })}</span></dd>
        </div>)}
      </dl>
    </section>
    <section className="alliance-roster-directory" aria-label={t("Alliance members")}>
      <header className="alliance-roster-heading"><div className="alliance-header-summary"><h2>{state.alliance.name || t("My alliance")} <span>· {t("{count} members", { count: active.length })}</span></h2>{leader && <p>{t("Leader")}: <MemberName member={leader} /><b className="alliance-rank" data-rank="R5">R5</b></p>}</div></header>
      <div className="alliance-roster-toolbar">
        <div className="search-box"><Search size={16} /><input aria-label={t("Search roster")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Find a commander…")} />{query && <button className="search-clear" aria-label={t("Clear roster search")} onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <select aria-label={t("Roster membership")} value={filter} onChange={(event) => { setFilter(event.target.value); setRankFilter("all"); }}><option value="active">{t("Current roster")}</option><option value="previous">{t("Previous records")}</option><option value="missing-profile">{t("Missing profiles ({count})", { count: state.members.filter((member) => !member.gameProfile).length })}</option></select>
        <select aria-label={t("Sort roster")} value={sort} onChange={(event) => setSort(event.target.value)}><option value="heroPower">{t("Hero power")} ↓</option><option value="kills">{t("Kills")} ↓</option><option value="rank">{t("Alliance rank")} · R5–R1</option><option value="name">{t("Name A–Z")}</option></select>
      </div>
      {membershipError && <p className="form-error-box" role="alert">{membershipError}</p>}
      <div className="alliance-roster-scroll"><div className="alliance-roster-columns"><span>{t("Commander")}</span><select className="roster-rank-filter" aria-label={t("Filter roster by rank")} aria-controls={rosterListId} value={rankFilter} onChange={(event) => setRankFilter(event.target.value as RosterRankFilter)}>
        {ROSTER_RANK_FILTERS.map(({ value }) => <option key={value} value={value}>{value === "all" ? t("Rank") : value}</option>)}
      </select><span className="alliance-col-power">{t("Power")}</span><span>{t("Hero power")}</span><span>{t("Kills")}</span><span className="alliance-col-profession">{t("Profession")}</span></div>
      <ol id={rosterListId} className="alliance-roster-list">{filtered.map(({ member, position }) => <li key={member.id} className="roster-with-merge" data-rank={member.gameProfile?.rank}>
        <button className="alliance-roster-row" data-rank={member.gameProfile?.rank} onClick={() => onOpenMember(member.id)} aria-label={[
          t("View {name}, power {power}, hero power {heroPower}, kills {kills}, profession {profession}", { name: member.canonicalName, power: memberStats(member).powerDisplay, heroPower: memberStats(member).heroPowerDisplay, kills: memberStats(member).killsDisplay, profession: memberStats(member).profession ?? "—" }),
          memberServerTags(member, state.alliance.server).origin !== null ? t("Came from server {server}", { server: memberServerTags(member, state.alliance.server).origin! }) : "",
          memberServerTags(member, state.alliance.server).transferredTo !== null ? t("Transferred to server {server}", { server: memberServerTags(member, state.alliance.server).transferredTo! }) : "",
        ].filter(Boolean).join(", ")}>
          <span className="alliance-row-identity"><span className="alliance-position">{position}</span><MemberAvatar member={member} />
            <span className="alliance-row-naming"><MemberName member={member} /><ServerTags member={member} homeServer={state.alliance.server} hues={serverHues} /></span></span>
          <span className="member-rank-cell">{member.gameProfile && <b className="alliance-rank" data-rank={member.gameProfile.rank}>{member.gameProfile.rank}</b>}</span>
          <span className="alliance-stat alliance-col-power"><strong>{memberStats(member).powerDisplay}</strong></span>
          <span className="alliance-stat"><strong>{memberStats(member).heroPowerDisplay}</strong></span>
          <span className="alliance-stat"><strong>{memberStats(member).killsDisplay}</strong></span>
          <span className="alliance-stat alliance-col-profession"><strong>{memberStats(member).profession ? t(memberStats(member).profession!) : "—"}</strong></span>
        </button>
        {canManage && <MemberActions name={member.canonicalName} canMerge={state.members.length > 1} active={member.active} onEdit={() => setEditingId(member.id)} onMerge={() => onMergeMember(member.id)} onToggleActive={() => setMemberActive(member)} onDelete={() => onDeleteMember(member.id)} />}
      </li>)}</ol></div>
      {!filtered.length && <div className="leaderboard-empty"><Users size={24} /><strong>{t("No commanders found")}</strong><span>{query ? t("Try another name or choose All ranks.") : rankFilter !== "all" ? t(filter === "active" ? "No {rank} members in the current roster. Choose another rank or All." : "No {rank} members in previous records. Choose another rank or All.", { rank: selectedRankLabel }) : t("There are no members in this roster view.")}</span></div>}
      <footer className="alliance-roster-foot"><span aria-live="polite">{t(filter === "missing-profile" ? (query ? "{count} members without profiles found" : "{count} members without profiles") : filter === "active" ? (query ? "{count} members found" : "{count} members") : (query ? "{count} previous records found" : "{count} previous records"), { count: filtered.length })}{rankFilter !== "all" ? ` · ${selectedRankLabel}` : ""}</span></footer>
    </section>
    {canManage && editingMember && <EditMemberDialog key={editingMember.id} member={editingMember} version={state.version} onClose={() => setEditingId(undefined)} onSaved={(next) => { onSaved(next); setEditingId(undefined); }} />}
  </div>;
}
