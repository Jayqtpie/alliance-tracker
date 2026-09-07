"use client";

import Image from "next/image";
import { Search, Swords, Users, X, Zap } from "lucide-react";
import { useId, useState } from "react";
import type { Member, TrackerState } from "@/lib/types";
import { MemberName } from "./member-name";
import { MemberActions } from "./member-actions";

import { EditMemberDialog } from "./edit-member-dialog";
import { allianceStatTotals, memberStats } from "@/lib/member-stats";
import { accurateAsOf } from "@/lib/display-date";

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

export function AllianceRoster({ state, onOpenMember, onMergeMember, onDeleteMember, onSaved }: { state: TrackerState; onSaved: (state: TrackerState) => void; onOpenMember: (id: string) => void; onMergeMember: (id: string) => void; onDeleteMember: (id: string) => void }) {
  const [editingId, setEditingId] = useState<string>();
  const editingMember = state.members.find((member) => member.id === editingId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [sort, setSort] = useState("heroPower");
  const [rankFilter, setRankFilter] = useState<RosterRankFilter>("all");
  const rosterListId = useId();
  const active = state.members.filter((member) => member.active);
  const totals = allianceStatTotals(state.members);
  const leader = active.find((member) => member.gameProfile?.rank === "R5");
  const capturedOn = active.find((member) => member.gameProfile)?.gameProfile?.capturedOn;
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
  const selectedRankLabel = ROSTER_RANK_FILTERS.find((item) => item.value === rankFilter)?.label;

  return <div className="page-stack alliance-roster-page">
    <section className="dashboard-heading">
      <div><p className="eyebrow">THE PEOPLE BEHIND THE ALLIANCE</p><h1>Alliance roster<span>.</span></h1><p>Your commanders, at a glance.</p></div>
      <dl className="alliance-totals" aria-label="Active alliance totals">
        {([
          { key: "heroPower", label: "Total hero power", Icon: Zap },
          { key: "kills", label: "Total kills", Icon: Swords },
        ] as const).map(({ key, label, Icon }) => <div className="alliance-total" data-stat={key} key={key}>
          <dt><Icon size={14} aria-hidden="true" />{label}</dt>
          <dd><strong>{totals[key].display}</strong><span>{totals[key].recorded} / {totals.activeCount} active members recorded</span></dd>
        </div>)}
      </dl>
    </section>
    <section className="alliance-roster-directory" aria-label="Alliance members">
      <header className="alliance-roster-heading"><div className="alliance-header-summary"><h2>My alliance <span>· {active.length} members</span></h2>{leader && <p>Leader: <MemberName member={leader} /><b className="alliance-rank" data-rank="R5">R5</b></p>}</div><span className="alliance-source-date">{capturedOn ? accurateAsOf(capturedOn) : "No profile capture"}</span></header>
      <div className="alliance-roster-toolbar">
        <div className="search-box"><Search size={16} /><input aria-label="Search roster" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a commander…" />{query && <button className="search-clear" aria-label="Clear roster search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <select aria-label="Roster membership" value={filter} onChange={(event) => { setFilter(event.target.value); setRankFilter("all"); }}><option value="active">Current roster</option><option value="previous">Previous records</option><option value="missing-profile">Missing profiles ({state.members.filter((member) => !member.gameProfile).length})</option></select>
        <select aria-label="Sort roster" value={sort} onChange={(event) => setSort(event.target.value)}><option value="heroPower">Hero power ↓</option><option value="kills">Kills ↓</option><option value="rank">Alliance rank · R5–R1</option><option value="name">Name A–Z</option></select>
      </div>
      <div className="alliance-roster-scroll"><div className="alliance-roster-columns"><span>Commander</span><select className="roster-rank-filter" aria-label="Filter roster by rank" aria-controls={rosterListId} value={rankFilter} onChange={(event) => setRankFilter(event.target.value as RosterRankFilter)}>
        {ROSTER_RANK_FILTERS.map(({ value }) => <option key={value} value={value}>{value === "all" ? "Rank" : value}</option>)}
      </select><span>Hero power</span><span>Kills</span></div>
      <ol id={rosterListId} className="alliance-roster-list">{filtered.map(({ member, position }) => <li key={member.id} className="roster-with-merge" data-rank={member.gameProfile?.rank}>
        <button className="alliance-roster-row" data-rank={member.gameProfile?.rank} onClick={() => onOpenMember(member.id)} aria-label={`View ${member.canonicalName}, hero power ${memberStats(member).heroPowerDisplay}, kills ${memberStats(member).killsDisplay}`}>
          <span className="alliance-row-identity"><span className="alliance-position">{position}</span><MemberAvatar member={member} /><MemberName member={member} /></span>
          <span className="member-rank-cell">{member.gameProfile && <b className="alliance-rank" data-rank={member.gameProfile.rank}>{member.gameProfile.rank}</b>}</span>
          <span className="alliance-stat"><strong>{memberStats(member).heroPowerDisplay}</strong></span>
          <span className="alliance-stat"><strong>{memberStats(member).killsDisplay}</strong></span>
        </button>
        <MemberActions name={member.canonicalName} canMerge={state.members.length > 1} onEdit={() => setEditingId(member.id)} onMerge={() => onMergeMember(member.id)} onDelete={() => onDeleteMember(member.id)} />
      </li>)}</ol></div>
      {!filtered.length && <div className="leaderboard-empty"><Users size={24} /><strong>No commanders found</strong><span>{query ? "Try another name or choose All ranks." : rankFilter !== "all" ? `No ${selectedRankLabel} members in ${filter === "active" ? "the current roster" : "previous records"}. Choose another rank or All.` : "There are no members in this roster view."}</span></div>}
      <footer className="alliance-roster-foot"><span aria-live="polite">{filtered.length} {filter === "missing-profile" ? "members without profiles" : filter === "active" ? "members" : "previous records"}{rankFilter !== "all" ? ` · ${selectedRankLabel}` : ""}{query ? " found" : ""}</span></footer>
    </section>
    {editingMember && <EditMemberDialog key={editingMember.id} member={editingMember} version={state.version} onClose={() => setEditingId(undefined)} onSaved={(next) => { onSaved(next); setEditingId(undefined); }} />}
  </div>;
}
