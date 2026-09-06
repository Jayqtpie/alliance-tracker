"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Member, TrackerState } from "@/lib/types";
import "./merge-member.css";

export function RenameMemberDialog({ member, version, onSaved, onClose }: {
  member: Member; version: number; onSaved: (state: TrackerState) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
      const response = await fetch("/api/members", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rename", memberId: member.id, canonicalName: name, version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save this name.");
      onSaved(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this name.");
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="merge-member-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <div className="merge-dialog-heading"><h2 id={titleId}>Edit player name</h2><button type="button" className="icon-button" aria-label="Close name editor" disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <p className="merge-copy">The new name will appear across the roster and rankings. The previous name is kept as an alias for future imports.</p>
      <fieldset disabled={busy}><label>Player name<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label></fieldset>
      {error && <p className="form-error-box" role="alert">{error}</p>}
      <div className="merge-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !name.trim() || name.trim() === member.canonicalName}>{busy ? "Saving…" : "Save name"}</button></div>
    </form>
  </dialog>;
}
