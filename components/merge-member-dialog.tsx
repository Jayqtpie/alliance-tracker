"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, GitMerge, X } from "lucide-react";
import { MemberAvatar } from "./alliance-roster";
import { memberStats } from "@/lib/member-stats";
import { memberMergeConflicts } from "@/lib/tracker";
import type { Member, TrackerState } from "@/lib/types";
import "./merge-member.css";
import { useLanguage } from "./language-selector";

export function MergeMemberDialog({ duplicate, state, onClose, onMerged }: {
  duplicate: Member;
  state: TrackerState;
  onClose: () => void;
  onMerged: (state: TrackerState, primaryId: string) => void;
}) {
  const { language, t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [keepEntries, setKeepEntries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const primary = state.members.find((member) => member.id === primaryId);
  const candidates = state.members.filter((member) => member.id !== duplicate.id &&
    (member.id === primaryId || [member.canonicalName, ...member.aliases].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => Number(Boolean(b.gameProfile)) - Number(Boolean(a.gameProfile)) || a.canonicalName.localeCompare(b.canonicalName));
  const conflicts = primary ? memberMergeConflicts(state, primary.id, duplicate.id) : [];
  const captureCount = state.snapshots.filter((snapshot) => snapshot.entries.some((entry) => entry.memberId === duplicate.id)).length;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function merge() {
    if (!primary || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryId, duplicateId: duplicate.id, version: state.version, keepEntries }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not merge these members."));
      onMerged(body, primaryId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not merge these members. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} className="merge-member-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="merge-dialog-heading"><div><p className="eyebrow">{t("ROSTER CLEANUP")}</p><h2 id={titleId}>{t("Merge duplicate player")}</h2></div><button className="icon-button" aria-label={t("Close merge")} disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <form onSubmit={(event) => { event.preventDefault(); void merge(); }}>
      <fieldset disabled={busy}>
        <p className="merge-copy">{t("Choose the correct roster player to keep. The duplicate will be removed after its history is linked to that player.")}</p>
        <div className="merge-identity"><MemberAvatar member={duplicate} /><div><small>{t("DUPLICATE TO REMOVE")}</small><strong>{duplicate.canonicalName}</strong><span>{duplicate.gameProfile ? `${duplicate.gameProfile.rank} · ${t("Saved game profile")}` : t("No saved game profile")} · {t(captureCount === 1 ? "1 capture" : "{count} captures", { count: captureCount })}</span></div></div>
        <label>{t("Find the correct player")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search names or aliases…")} /></label>
        <label>{t("Correct player to keep")}<select required value={primaryId} onChange={(event) => { setPrimaryId(event.target.value); setKeepEntries({}); setError(""); }}>
          <option value="">{t("Choose a roster player…")}</option>
          {candidates.map((member) => <option key={member.id} value={member.id}>{member.canonicalName} · {member.gameProfile?.rank || t("No profile")}{member.active ? "" : ` · ${t("Previous record")}`}</option>)}
        </select></label>
        {!candidates.length && <p className="merge-copy">{t("No players match that search.")}</p>}
        {primary && <>
          <div className="merge-identity merge-keep"><MemberAvatar key={primary.id} member={primary} /><div><small>{t("PLAYER TO KEEP")}</small><strong>{primary.canonicalName}</strong><span>{primary.gameProfile ? `${primary.gameProfile.rank} · ${t("Hero power")} ${memberStats(primary).heroPowerDisplay} · ${t("Kills")} ${memberStats(primary).killsDisplay}` : t("No saved game profile")}</span></div></div>
          <div className="merge-preview"><ArrowRight size={18} /><p><strong>{duplicate.canonicalName}</strong> {t("becomes an alias of")} <strong>{primary.canonicalName}</strong>. {t("Future matching imports use this player. Their name, avatar and game profile stay; history, aliases and notes are combined.")}</p></div>
          {conflicts.length > 0 && <div className="merge-conflicts"><h3>{t("Choose one result per capture")}</h3><p>{t("These players both have results in the same capture. Keep the correct row; the other row is removed. Points are never added together.")}</p>
            {conflicts.map(({ snapshot, entries }) => <label key={snapshot.id}>{snapshot.capturedAt.slice(0, 10)} · {t(snapshot.dayLabel)} · {t(snapshot.status === "final" ? "final" : "live")}
              <select required value={keepEntries[snapshot.id] || ""} onChange={(event) => setKeepEntries({ ...keepEntries, [snapshot.id]: event.target.value })}>
                <option value="">{t("Choose the correct ranking result…")}</option>
                {entries.map((entry) => <option key={entry.id} value={entry.id}>#{entry.rank} · {entry.displayName} · {t("{points} points", { points: entry.points.toLocaleString(language === "en" ? "en-GB" : language) })}</option>)}
              </select>
            </label>)}
          </div>}
        </>}
      </fieldset>
      {error && <p role="alert" className="form-error-box">{error}</p>}
      <footer className="merge-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button type="submit" className="button primary" disabled={busy || !primary || conflicts.some(({ snapshot }) => !keepEntries[snapshot.id])}><GitMerge size={16} />{t(busy ? "Merging…" : "Merge and remove duplicate")}</button></footer>
    </form>
  </dialog>;
}
