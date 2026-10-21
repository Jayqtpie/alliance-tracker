"use client";

import { Link2, Swords, Tornado, Users } from "lucide-react";
import { useState } from "react";
import type { TrackerState } from "@/lib/types";
import { AllianceRoster } from "./alliance-roster";
import { PairingBoard } from "./pairing-board";
import { StormLineupsView } from "./storm-lineups";
import { SvsAttendanceView } from "./svs-attendance";
import { useLanguage } from "./language-selector";

export function MembersView({ canManage = false, bridgeConfigured = false, state, onSaved, onOpenMember, onMergeMember, onDeleteMember }: {
  canManage?: boolean; bridgeConfigured?: boolean; state: TrackerState; onSaved: (state: TrackerState) => void;
  onOpenMember: (id: string) => void; onMergeMember: (id: string) => void; onDeleteMember: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"roster" | "pairings" | "svs" | "storms">("roster");
  return <>
    <div className="reports-tabs-wrap"><div className="operations-tabs reports-tabs members-tabs">
      <button className={tab === "roster" ? "active" : ""} onClick={() => setTab("roster")}><Users size={16} />{t("Roster")}</button>
      <button className={tab === "pairings" ? "active" : ""} onClick={() => setTab("pairings")}><Link2 size={16} />{t("Pairings")}</button>
      <button className={tab === "svs" ? "active" : ""} onClick={() => setTab("svs")}><Swords size={16} />{t("Attendance")}</button>
      <button className={tab === "storms" ? "active" : ""} onClick={() => setTab("storms")}><Tornado size={16} />{t("Storms")}</button>
    </div></div>
    {tab === "roster"
      ? <AllianceRoster canManage={canManage} state={state} onSaved={onSaved} onOpenMember={onOpenMember} onMergeMember={onMergeMember} onDeleteMember={onDeleteMember} />
      : tab === "pairings"
        ? <PairingBoard canManage={canManage} state={state} onSaved={onSaved} />
        : tab === "svs"
          ? <SvsAttendanceView canManage={canManage} state={state} onSaved={onSaved} />
          : <StormLineupsView canManage={canManage} bridgeConfigured={bridgeConfigured} state={state} onSaved={onSaved} />}
  </>;
}
