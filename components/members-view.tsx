"use client";

import { Link2, Users } from "lucide-react";
import { useState } from "react";
import type { TrackerState } from "@/lib/types";
import { AllianceRoster } from "./alliance-roster";
import { PairingBoard } from "./pairing-board";

export function MembersView({ canManage = false, state, onSaved, onOpenMember, onMergeMember, onDeleteMember }: {
  canManage?: boolean; state: TrackerState; onSaved: (state: TrackerState) => void;
  onOpenMember: (id: string) => void; onMergeMember: (id: string) => void; onDeleteMember: (id: string) => void;
}) {
  const [tab, setTab] = useState<"roster" | "pairings">("roster");
  return <>
    <div className="reports-tabs-wrap"><div className="operations-tabs reports-tabs">
      <button className={tab === "roster" ? "active" : ""} onClick={() => setTab("roster")}><Users size={16} />Roster</button>
      <button className={tab === "pairings" ? "active" : ""} onClick={() => setTab("pairings")}><Link2 size={16} />Pairings</button>
    </div></div>
    {tab === "roster"
      ? <AllianceRoster canManage={canManage} state={state} onSaved={onSaved} onOpenMember={onOpenMember} onMergeMember={onMergeMember} onDeleteMember={onDeleteMember} />
      : <PairingBoard canManage={canManage} state={state} onSaved={onSaved} />}
  </>;
}
