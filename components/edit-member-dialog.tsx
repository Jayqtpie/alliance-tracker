"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Member, TrackerState } from "@/lib/types";
import "./merge-member.css";
import { memberServers, memberStats, parseMemberStat, parseServerId, PROFESSIONS } from "@/lib/member-stats";
import { useLanguage } from "./language-selector";

export function EditMemberDialog({ member, version, onSaved, onClose }: {
  member: Member; version: number; onSaved: (state: TrackerState) => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const stats = memberStats(member);
  const servers = memberServers(member);
  const [originServer, setOriginServer] = useState(servers.origin === null ? "" : String(servers.origin));
  const [transferredTo, setTransferredTo] = useState(servers.transferredTo === null ? "" : String(servers.transferredTo));
  const [power, setPower] = useState(stats.power === null ? "" : String(stats.power));
  const [profession, setProfession] = useState(stats.profession ?? "");
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
      parseMemberStat(power);
      parseMemberStat(heroPower);
      parseMemberStat(kills);
      parseServerId(originServer);
      parseServerId(transferredTo);
      const response = await fetch("/api/members", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "edit", memberId: member.id, canonicalName: name, power, heroPower, kills, profession, originServer, transferredTo, version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not save this player."));
      onSaved(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save this player."));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="merge-member-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <div className="merge-dialog-heading"><h2 id={titleId}>{t("Edit player")}</h2><button type="button" className="icon-button" aria-label={t("Close player editor")} disabled={busy} onClick={onClose}><X size={18} /></button></div>
      <p className="merge-copy">{t("Changes appear across the roster and player profile. Previous names and ranking history are kept.")}</p>
      <fieldset disabled={busy}><label>{t("Player name")}<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><label>{t("Power")}<input value={power} onChange={(event) => setPower(event.target.value)} maxLength={40} placeholder={t("e.g. {example}", { example: "450M" })} aria-describedby={`${titleId}-stat-help`} /></label><label>{t("Hero power")}<input value={heroPower} onChange={(event) => setHeroPower(event.target.value)} maxLength={40} placeholder={t("e.g. {example}", { example: "125M" })} aria-describedby={`${titleId}-stat-help`} /></label><label>{t("Kills")}<input value={kills} onChange={(event) => setKills(event.target.value)} maxLength={40} placeholder={t("e.g. {example}", { example: "12.5M" })} aria-describedby={`${titleId}-stat-help`} /></label><label>{t("Profession")}<select value={profession} onChange={(event) => setProfession(event.target.value)}><option value="">{t("Unavailable")}</option>{PROFESSIONS.map((option) => <option key={option} value={option}>{t(option)}</option>)}</select></label><label>{t("Origin server")}<input value={originServer} onChange={(event) => setOriginServer(event.target.value)} maxLength={10} inputMode="numeric" placeholder={t("e.g. {example}", { example: "856" })} aria-describedby={`${titleId}-server-help`} /></label><label>{t("Transferred to")}<input value={transferredTo} onChange={(event) => setTransferredTo(event.target.value)} maxLength={10} inputMode="numeric" placeholder={t("e.g. {example}", { example: "931" })} aria-describedby={`${titleId}-server-help`} /></label></fieldset>
      <p id={`${titleId}-stat-help`} className="merge-copy">{t("Enter a full number or use K, M or B. Leave blank for unavailable. Manual corrections are kept during roster refreshes.")}</p>
      <p id={`${titleId}-server-help`} className="merge-copy">{t("Server numbers are three or four digits. Clear the origin server to record none, or set the transfer server to note where a departing player went.")}</p>
      {error && <p className="form-error-box" role="alert">{error}</p>}
      <div className="merge-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button type="submit" className="button primary" disabled={busy || !name.trim()}>{t(busy ? "Saving…" : "Save changes")}</button></div>
    </form>
  </dialog>;
}
