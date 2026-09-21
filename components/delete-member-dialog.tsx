"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Member, TrackerState } from "@/lib/types";
import "./merge-member.css";
import { useLanguage } from "./language-selector";

export function DeleteMemberDialog({ member, state, onDeleted, onClose }: {
  member: Member; state: TrackerState; onDeleted: (state: TrackerState) => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const captures = state.snapshots.filter((snapshot) => snapshot.entries.some((entry) => entry.memberId === member.id)).length;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/members?id=${encodeURIComponent(member.id)}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not delete this player."));
      onDeleted(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not delete this player."));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="merge-member-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={remove}>
      <div className="merge-dialog-heading"><h2 id={titleId}>{t("Delete player?")}</h2><button type="button" className="icon-button" aria-label={t("Close delete confirmation")} disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <p className="merge-copy"><strong>{member.canonicalName}</strong> {t("will be removed from the roster and Missing profiles list. Their profile, aliases and notes will be deleted. This cannot be undone.")}</p>
      <p className="merge-copy">{captures ? t(captures === 1 ? "1 saved capture will keep this player's recorded name, rank and points, without a profile link." : "{count} saved captures will keep this player's recorded name, rank and points, without a profile link.", { count: captures }) : t("This player has no saved ranking results.")} {t("If this is a duplicate of another player, use Merge to keep their history linked.")}</p>
      {error && <p className="form-error-box" role="alert">{error}</p>}
      <div className="merge-dialog-footer"><button autoFocus type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button type="submit" className="button danger" disabled={busy}><Trash2 size={16} />{t(busy ? "Deleting…" : "Delete player")}</button></div>
    </form>
  </dialog>;
}
