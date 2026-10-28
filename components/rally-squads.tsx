"use client";

import { Check, Copy, Crown, Download, Pin, Scale, Shuffle, UserCheck, UserX, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Member, RallyBoard, RallyMode, TrackerState } from "@/lib/types";
import { allianceFilePrefix } from "@/lib/alliance";
import { csvBlob } from "@/lib/csv";
import { memberStats, statDisplay } from "@/lib/member-stats";
import {
  canLead, defaultRallyBoard, LEADER_SLOT, MAX_SQUADS, moveRallyMember, rallyBoardCsv, rallyBoardText, resolveRallyBoard, setSquadCount, setUnavailable,
  squadGap, squadTotal, suggestRallyBoard, suggestedSquadCount, togglePin, type RallyTarget,
} from "@/lib/rally-squads";
import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { useLanguage } from "./language-selector";
import "./svs-attendance.css";
import "./rally-squads.css";

const MODE_LABELS: Record<RallyMode, string> = { balanced: "Balanced", tiered: "Tiered" };

function signed(value: number) {
  if (Math.abs(value) < 5e5) return "±0";
  return `${value > 0 ? "+" : "−"}${statDisplay(Math.abs(value))}`;
}

/**
 * Rally squads: a War Leader leads each rally and four members of any profession join. Officers suggest
 * squads, adjust them by drag or click, pin who must stay and mark who is away. All rules are in
 * lib/rally-squads.ts, since the gestures cannot be tested here.
 */
export function RallySquadsView({ canManage, state, onSaved }: { canManage: boolean; state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<RallyBoard>();
  const [held, setHeld] = useState<string>();
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dragData = useRef<string | null>(null);

  // With nothing saved, an officer starts from a suggestion; a viewer sees that none has been made.
  const fallback = useMemo(() => canManage && !state.rallyBoard ? defaultRallyBoard(state.members) : undefined, [canManage, state.rallyBoard, state.members]);
  const source = draft ?? state.rallyBoard ?? fallback;
  const dirty = draft !== undefined || (!state.rallyBoard && fallback !== undefined);
  const memberById = new Map(state.members.map((member) => [member.id, member]));

  const heading = (stats?: React.ReactNode) => <section className="dashboard-heading">
    <div><p className="eyebrow">{t("OPERATIONS")} · {t("RALLIES")}</p><h1>{t("Rally squads")}<span>.</span></h1>
      <p>{t(canManage
        ? "A War Leader leads each rally and four members join. Suggest squads, then drag or click to adjust. Pin anyone who must stay put."
        : "Who leads each rally and who joins it.")}</p></div>
    {stats}
  </section>;

  if (!source) return <div className="page-stack rally-page">
    {heading()}
    <p className="panel svs-empty">{t("No rally squads yet. An officer can build them here.")}</p>
  </div>;

  const { board, bench, unavailable } = resolveRallyBoard(state.members, source);
  const pinned = new Set(board.pinned);
  const placedCount = board.squads.flatMap((squad) => squad.slots).filter(Boolean).length;
  const suggestedCount = suggestedSquadCount(state.members, board.unavailable);
  const gap = squadGap(board, memberById);
  const totals = board.squads.map((squad) => squadTotal(squad, memberById));
  const filledTotals = totals.filter((_, index) => board.squads[index].slots.some(Boolean));
  const average = filledTotals.length ? filledTotals.reduce((sum, total) => sum + total, 0) / filledTotals.length : 0;
  const heldMember = held ? memberById.get(held) : undefined;

  function change(next: RallyBoard) {
    setDraft(next);
    setError("");
  }

  function move(memberId: string, target: RallyTarget) {
    const member = memberById.get(memberId);
    setHeld(undefined);
    if (!member) return;
    if (target.kind === "slot" && target.slot === LEADER_SLOT && !canLead(member)) {
      setNotice(t("Only a War Leader can lead a rally. {name} is not one.", { name: member.canonicalName }));
      return;
    }
    change(moveRallyMember(board, state.members, memberId, target));
    setNotice(target.kind === "bench"
      ? t("Moved {name} to the bench.", { name: member.canonicalName })
      : t("Moved {name} to squad {squad}.", { name: member.canonicalName, squad: board.squads.findIndex((squad) => squad.id === target.squadId) + 1 }));
  }

  function pick(member: Member, target?: RallyTarget) {
    if (held === member.id) { setHeld(undefined); setNotice(t("Cancelled moving {name}.", { name: member.canonicalName })); return; }
    if (held && target) { move(held, target); return; }
    setHeld(member.id);
    setNotice(t("Picked up {name}. Choose a slot.", { name: member.canonicalName }));
  }

  function dragStart(event: React.DragEvent, member: Member) {
    dragData.current = member.id;
    event.dataTransfer.effectAllowed = "move";
    try { event.dataTransfer.setData("text/plain", member.id); } catch { /* Safari drag payloads can be finicky; the ref still carries the id */ }
  }

  function drop(event: React.DragEvent, target: RallyTarget) {
    event.preventDefault();
    const memberId = dragData.current ?? event.dataTransfer.getData("text/plain");
    dragData.current = null;
    if (memberId && memberById.has(memberId)) move(memberId, target);
  }

  function suggest(mode: RallyMode = board.mode) {
    setHeld(undefined);
    change(suggestRallyBoard(state.members, { ...board, mode }));
    setNotice(t(board.pinned.length ? "Squads suggested. Pinned members stayed put." : "Squads suggested."));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(rallyBoardText(board, memberById));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice(t("Could not copy. Your browser blocked the clipboard."));
    }
  }

  function exportCsv() {
    const url = URL.createObjectURL(csvBlob(rallyBoardCsv(board, memberById)));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${allianceFilePrefix(state.alliance)}-rally-squads-${new Date().toLocaleDateString("en-CA")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rally-squads", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ board, version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not save the squads."));
      onSaved(body);
      setDraft(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save the squads."));
    } finally {
      setBusy(false);
    }
  }

  const allowDrop = canManage ? (event: React.DragEvent) => event.preventDefault() : undefined;

  function chip(member: Member, target?: RallyTarget) {
    const inSquad = target?.kind === "slot";
    const leaderMismatch = inSquad && target.slot === LEADER_SLOT && !canLead(member);
    const content = <><MemberAvatar member={member} /><MemberName member={member} />
      {leaderMismatch && <span className="rally-flag">{t("not a War Leader")}</span>}
      <span className="rally-power">{memberStats(member).heroPowerDisplay}</span></>;
    return <div className="rally-chip" data-pinned={pinned.has(member.id) || undefined}>
      {canManage
        ? <button type="button" className="rally-chip-pick" draggable aria-pressed={held === member.id}
          onDragStart={(event) => dragStart(event, member)} onDragEnd={() => { dragData.current = null; }}
          onClick={() => pick(member, target)}>{content}</button>
        : <span className="rally-chip-pick">{content}</span>}
      {inSquad && (canManage
        ? <button type="button" className="rally-pin" aria-pressed={pinned.has(member.id)}
          aria-label={t(pinned.has(member.id) ? "Unpin {name}" : "Pin {name} to this squad", { name: member.canonicalName })}
          title={t(pinned.has(member.id) ? "Pinned: Suggest squads leaves them here" : "Pin to this squad")}
          onClick={() => change(togglePin(board, member.id))}><Pin size={13} aria-hidden="true" /></button>
        : pinned.has(member.id) && <span className="rally-pin" title={t("Pinned")}><Pin size={13} aria-label={t("Pinned")} /></span>)}
    </div>;
  }

  function benchRow(member: Member, away: boolean) {
    const profession = memberStats(member).profession;
    return <li key={member.id}>
      {away ? <span className="svs-member"><MemberAvatar member={member} /><MemberName member={member} /></span> : chip(member)}
      <span className="rally-tag" data-lead={profession === "War Leader" || undefined}>{profession === "War Leader" ? "WL" : profession === "Engineer" ? "ENG" : "—"}</span>
      {away && <span className="rally-power">{memberStats(member).heroPowerDisplay}</span>}
      {canManage && <button type="button" className="button ghost rally-away" onClick={() => change(setUnavailable(board, member.id, !away))}>
        {away ? <><UserCheck size={14} aria-hidden="true" />{t("Available")}</> : <><UserX size={14} aria-hidden="true" />{t("Away")}</>}</button>}
    </li>;
  }

  return <div className="page-stack rally-page">
    {heading(<dl className="alliance-totals svs-totals" aria-label={t("Rally squads")}>
      <div className="alliance-total" data-stat="rally-squads">
        <dt><Users size={14} aria-hidden="true" />{t("Squads")}</dt>
        <dd><strong>{board.squads.length}</strong><span>{t("{placed} placed · {bench} on the bench", { placed: placedCount, bench: bench.length })}</span></dd>
      </div>
      <div className="alliance-total" data-stat="rally-gap">
        <dt><Scale size={14} aria-hidden="true" />{t("Squad gap")}</dt>
        <dd><strong>{gap === null ? "—" : statDisplay(gap)}</strong><span>{t("strongest against weakest")}</span></dd>
      </div>
    </dl>)}

    <section className="panel rally-toolbar" aria-label={t("Squad settings")}>
      {canManage && <>
        <label className="rally-count">{t("Squads")}
          <input type="number" min={1} max={MAX_SQUADS} value={board.squads.length}
            onChange={(event) => { if (event.target.value) change(setSquadCount(board, Number(event.target.value))); }} />
        </label>
        {suggestedCount !== board.squads.length && <button type="button" className="button ghost rally-use-count" onClick={() => change(setSquadCount(board, suggestedCount))}>
          {t("Use {count}, one per 5 available", { count: suggestedCount })}</button>}
        <div className="svs-mode" role="group" aria-label={t("How Suggest squads splits members")}>
          {(["balanced", "tiered"] as const).map((mode) => <button key={mode} type="button" aria-pressed={board.mode === mode}
            title={t(mode === "balanced" ? "Every squad about as strong as the others" : "Squad 1 strongest, then squad 2, and so on")}
            onClick={() => suggest(mode)}>{t(MODE_LABELS[mode])}</button>)}
        </div>
        <button type="button" className="button secondary" onClick={() => suggest()}><Shuffle size={14} />{t("Suggest squads")}</button>
      </>}
      <button type="button" className="button ghost rally-copy" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? "Copied" : "Copy as text")}</button>
      <button type="button" className="button ghost" onClick={exportCsv}><Download size={14} />{t("Export CSV")}</button>
      {canManage && <p className="rally-notice" role="status">{notice || (heldMember ? "" : t("Click a member, then a slot. Strength is total hero power."))}</p>}
    </section>

    <div className="rally-grid">
      {board.squads.map((squad, index) => {
        const filled = squad.slots.some(Boolean);
        return <section key={squad.id} className="rally-squad" aria-label={t("Squad {number}", { number: index + 1 })}>
          <header className="rally-squad-head">
            <h3>{t("Squad {number}", { number: index + 1 })}</h3>
            <span className="rally-squad-total" title={t("Total hero power")}>{statDisplay(totals[index])}</span>
            {filled && filledTotals.length > 1 && <span className="rally-squad-diff" title={t("Against the average squad")}>{signed(totals[index] - average)}</span>}
          </header>
          <ol className="rally-slots">
            {squad.slots.map((memberId, slot) => {
              const member = memberId ? memberById.get(memberId) : undefined;
              const target: RallyTarget = { kind: "slot", squadId: squad.id, slot };
              const leader = slot === LEADER_SLOT;
              const blocked = leader && heldMember !== undefined && !canLead(heldMember);
              return <li key={slot} className="rally-slot" data-role={leader ? "leader" : "joiner"}
                onDragOver={allowDrop} onDrop={canManage ? (event) => drop(event, target) : undefined}>
                <span className="rally-slot-label">{leader ? <><Crown size={12} aria-hidden="true" />{t("Lead")}</> : slot}</span>
                {member ? chip(member, target) : canManage
                  ? <button type="button" className="rally-empty" disabled={!held || blocked} onClick={() => held && move(held, target)}
                    aria-label={t(leader ? "Empty leader slot, squad {number}" : "Empty joiner slot, squad {number}", { number: index + 1 })}>
                    {t(leader ? "War Leader" : "Empty")}</button>
                  : <span className="rally-empty">—</span>}
              </li>;
            })}
          </ol>
        </section>;
      })}
    </div>

    <section className="panel rally-bench" onDragOver={allowDrop} onDrop={canManage ? (event) => drop(event, { kind: "bench" }) : undefined}>
      <div className="panel-head"><h3>{t("Bench")} <span className="count-chip">{bench.length}</span></h3>
        {canManage && <button type="button" className="button ghost" disabled={!held || !board.squads.some((squad) => squad.slots.includes(held))}
          onClick={() => held && move(held, { kind: "bench" })}>{t("Move to the bench")}</button>}</div>
      <ul className="svs-member-list">
        {bench.map((member) => benchRow(member, false))}
        {!bench.length && <li className="svs-empty">{t("Everyone available is in a squad.")}</li>}
      </ul>
      {unavailable.length > 0 && <details className="rally-away-list">
        <summary>{t("Away")} <span className="count-chip">{unavailable.length}</span></summary>
        <ul className="svs-member-list">{unavailable.map((member) => benchRow(member, true))}</ul>
      </details>}
    </section>

    {canManage && <div className="svs-actions">
      {dirty && <span className="svs-dirty-note">{t(state.rallyBoard ? "Unsaved changes" : "Suggested squads, not saved yet")}</span>}
      <button type="button" className="button secondary" disabled={busy || draft === undefined} onClick={() => { setDraft(undefined); setHeld(undefined); setError(""); setNotice(""); }}>{t("Discard")}</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={save}>{t(busy ? "Saving…" : "Save squads")}</button>
    </div>}
    {error && <p className="form-error-box" role="alert">{error}</p>}
  </div>;
}
