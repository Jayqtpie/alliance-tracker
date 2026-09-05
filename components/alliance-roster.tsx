"use client";

import Image from "next/image";
import { Search, Users, X } from "lucide-react";
import { useState } from "react";
import type { Member, TrackerState } from "@/lib/types";

export function MemberAvatar({ member, large = false }: { member: Member; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`alliance-avatar${large ? " large" : ""}`}>
    {member.gameProfile?.avatarPath && !failed
      ? <Image src={member.gameProfile.avatarPath} alt="" width={large ? 56 : 36} height={large ? 56 : 36} unoptimized onError={() => setFailed(true)} />
      : member.canonicalName.trim().charAt(0).toLocaleUpperCase() || "?"}
  </span>;
}

export function AllianceRoster({ state, onOpenMember }: { state: TrackerState; onOpenMember: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [sort, setSort] = useState("heroPower");
  const active = state.members.filter((member) => member.active);
  const leader = active.find((member) => member.gameProfile?.rank === "R5");
  const officers = active.filter((member) => member.gameProfile?.rank === "R4");
  const capturedOn = active.find((member) => member.gameProfile)?.gameProfile?.capturedOn;
  const ordered = state.members.filter((member) => filter === "active" ? member.active : !member.active).sort((a, b) => {
    if (sort === "name") return a.canonicalName.localeCompare(b.canonicalName);
    const key = sort as "heroPower" | "kills";
    return (b.gameProfile?.[key] ?? -1) - (a.gameProfile?.[key] ?? -1);
  });
  const filtered = ordered.map((member, index) => ({ member, position: index + 1 })).filter(({ member }) =>
    [member.canonicalName, ...member.aliases].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <div className="page-stack alliance-roster-page">
    <section className="dashboard-heading"><div><p className="eyebrow">THE PEOPLE BEHIND THE ALLIANCE</p><h1>Alliance roster<span>.</span></h1><p>Your commanders, at a glance.</p></div><span className="alliance-tag">{state.alliance.tag} <span>#{state.alliance.server}</span></span></section>
    <section className="alliance-roster-card" aria-label="Alliance members">
      <header className="alliance-roster-heading"><div><h2>My alliance <span className="count-chip">{active.length}</span></h2><p><span>{active.length} members</span>{leader && <span>Leader: <strong>{leader.canonicalName}</strong> <b className="alliance-rank leader">R5</b></span>}<span>{officers.length} officers</span></p></div><span className="alliance-source-date">{capturedOn ? `Captured ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${capturedOn}T00:00:00Z`))}` : "No profile capture"}</span></header>
      <div className="alliance-roster-toolbar">
        <div className="search-box"><Search size={16} /><input aria-label="Search roster" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a commander…" />{query && <button className="search-clear" aria-label="Clear roster search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <select aria-label="Roster membership" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Current roster</option><option value="previous">Previous records</option></select>
        <select aria-label="Sort roster" value={sort} onChange={(event) => setSort(event.target.value)}><option value="heroPower">Hero power ↓</option><option value="kills">Kills ↓</option><option value="name">Name A–Z</option></select>
      </div>
      <div className="alliance-roster-columns" aria-hidden="true"><span>Commander</span><span>Hero power</span><span>Kills</span></div>
      <ol className="alliance-roster-list">{filtered.map(({ member, position }) => <li key={member.id}>
        <button className="alliance-roster-row" onClick={() => onOpenMember(member.id)} aria-label={`View ${member.canonicalName}, hero power ${member.gameProfile?.heroPowerDisplay ?? "unavailable"}, kills ${member.gameProfile?.killsDisplay ?? "unavailable"}`}>
          <span className="alliance-row-identity"><span className="alliance-position">{position}</span><MemberAvatar member={member} /><span className="alliance-member-name">{member.canonicalName}</span>{member.gameProfile && <b className={`alliance-rank${member.gameProfile.rank === "R5" ? " leader" : ""}`}>{member.gameProfile.rank}</b>}</span>
          <span className="alliance-stat"><strong>{member.gameProfile?.heroPowerDisplay ?? "—"}</strong>{member.gameProfile?.heroPowerLegacy && <small className="alliance-legacy" title="LWServers marks this hero power as legacy data">Legacy</small>}</span>
          <span className="alliance-stat"><strong>{member.gameProfile?.killsDisplay ?? "—"}</strong></span>
        </button>
      </li>)}</ol>
      {!filtered.length && <div className="leaderboard-empty"><Users size={24} /><strong>No commanders found</strong><span>Try another name or roster filter.</span></div>}
      <footer className="alliance-roster-foot"><span aria-live="polite">{filtered.length} {filter === "active" ? "members" : "previous records"}{query ? " found" : ""}</span><span>LWServers capture · Rounded values · — unavailable · Legacy = older data</span></footer>
    </section>
  </div>;
}
