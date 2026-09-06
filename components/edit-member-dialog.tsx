"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Member, TrackerState } from "@/lib/types";
import "./merge-member.css";
import { memberStats, parseMemberStat } from "@/lib/member-stats";

export function EditMemberDialog({ member, version, onSaved, onClose }: {
  member: Member; version: number; onSaved: (state: TrackerState) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const stats = memberStats(member);
  const [heroPower, setHeroPower] = useState(stats.heroPower === null ? "" : String(stats.heroPower));
  const [kills, setKills] = useState(stats.kills === null ? "" : String(stats.kills));
  const [name, setName] = useState(member.canonicalName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try {
      parseMemberStat(heroPower);
      parseMemberStat(kills);
      const response = await fetch("/api/members", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "edit", memberId: member.id, canonicalName: name, heroPower, kills, version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save this player.");
      onSaved(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this player.");
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="merge-member-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <div className="merge-dialog-heading"><h2 id={titleId}>Edit player</h2><button type="button" className="icon-button" aria-label="Close player editor" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <p className="merge-copy">Changes appear across the roster and player profile. Previous names and ranking history are kept.</p>
      <fieldset disabled={busy}><label>Player name<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Hero power<input value={heroPower} onChange={(event) => setHeroPower(event.target.value)} maxLength={40} placeholder="e.g. 125M" aria-describedby={`${titleId}-stat-help`} /></label><label>Kills<input value={kills} onChange={(event) => setKills(event.target.value)} maxLength={40} placeholder="e.g. 12.5M" aria-describedby={`${titleId}-stat-help`} /></label></fieldset>
      <p id={`${titleId}-stat-help`} className="merge-copy">Enter a full number or use K, M or B. Leave blank for unavailable. Manual corrections are kept during roster refreshes.</p>
      {error && <p className="form-error-box" role="alert">{error}</p>}
      <div className="merge-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </dialog>;
}
