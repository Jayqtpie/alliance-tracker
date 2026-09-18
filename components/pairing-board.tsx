"use client";

import { Crown, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import type { Member, PairingRow, TrackerState } from "@/lib/types";
import type { PairingColumn } from "@/lib/pairings";
import { movePairing, nextRowId, resolvePairings, slotMismatch } from "@/lib/pairings";
import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { memberStats } from "@/lib/member-stats";
import "./pairing-board.css";

type Held = { memberId: string; column: PairingColumn };
type Target = { kind: "row"; rowId: string } | { kind: "unpaired" };

function columnLabel(column: PairingColumn) {
  return column === "warLeader" ? "War Leader" : "Engineer";
}

function parseDragData(event: React.DragEvent): Held | null {
  try {
    const raw = event.dataTransfer.getData("text/plain");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.memberId === "string" && (parsed.column === "warLeader" || parsed.column === "engineer")) return parsed;
  } catch { /* ignore malformed drag payloads */ }
  return null;
}

export function PairingBoard({ canManage, state, onSaved }: { canManage: boolean; state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const [draft, setDraft] = useState<PairingRow[] | undefined>(undefined);
  const [held, setHeld] = useState<Held>();
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dragData = useRef<Held | null>(null);

  const dirty = draft !== undefined;
  const rows = draft ?? state.pairings;
  const resolved = resolvePairings(state.members, rows);
  const extraRowId = nextRowId(resolved.rows);
  const displayRows: PairingRow[] = [...resolved.rows, { id: extraRowId }];
  const memberById = new Map(state.members.map((member) => [member.id, member]));
  const pairedWarLeaders = resolved.rows.filter((row) => row.warLeaderId).length;
  const pairedEngineers = resolved.rows.filter((row) => row.engineerId).length;

  function applyMove(memberId: string, column: PairingColumn, target: Target) {
    setDraft(movePairing(resolved.rows, { memberId, column, target }));
  }

  function pickUp(member: Member, column: PairingColumn) {
    setHeld({ memberId: member.id, column });
    setAnnouncement(`Picked up ${member.canonicalName}. Choose any slot.`);
  }

  function place(column: PairingColumn, target: Target, rowNumber?: number) {
    if (!held) return;
    const member = memberById.get(held.memberId);
    applyMove(held.memberId, column, target);
    setHeld(undefined);
    setAnnouncement(member ? `Moved ${member.canonicalName} to ${target.kind === "row" ? `row ${rowNumber}` : "the unpaired pool"}.` : "Moved.");
  }

  function handleChipPick(member: Member, column: PairingColumn, rowId: string | undefined, rowNumber: number | undefined) {
    if (held?.memberId === member.id) { setHeld(undefined); setAnnouncement(`Cancelled moving ${member.canonicalName}.`); return; }
    if (held && rowId) { place(column, { kind: "row", rowId }, rowNumber); return; }
    pickUp(member, column);
  }

  function handleDragStart(event: React.DragEvent, member: Member, column: PairingColumn) {
    dragData.current = { memberId: member.id, column };
    event.dataTransfer.effectAllowed = "move";
    try { event.dataTransfer.setData("text/plain", JSON.stringify({ memberId: member.id, column })); } catch { /* Safari drag payloads can be finicky; the ref still carries the data */ }
  }

  function handleDragEnd() { dragData.current = null; }

  function handleRowDrop(event: React.DragEvent, column: PairingColumn, rowId: string) {
    event.preventDefault();
    const data = dragData.current ?? parseDragData(event);
    dragData.current = null;
    if (!data) return;
    applyMove(data.memberId, column, { kind: "row", rowId });
    setHeld(undefined);
  }

  function handlePoolDrop(event: React.DragEvent, column: PairingColumn) {
    event.preventDefault();
    const data = dragData.current ?? parseDragData(event);
    dragData.current = null;
    if (!data) return;
    applyMove(data.memberId, column, { kind: "unpaired" });
    setHeld(undefined);
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pairings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: draft, version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save pairings.");
      onSaved(body);
      setDraft(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save pairings.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-stack pairing-board-page">
    <section className="section-heading"><div><p className="eyebrow">WAR LEADER · ENGINEER PAIRING</p><h2>Pairing board<span>.</span></h2><p>Drag a commander onto a slot, or {canManage ? "use keyboard: click a commander then click their destination." : "sign in as an officer to make changes."}</p></div></section>
    {canManage && <p aria-live="polite" className="sr-only">{announcement}</p>}
    <div className="pairing-board">
      <div className="pairing-board-head">
        <span className="pairing-row-number-head" aria-hidden="true" />
        <span className="pairing-col-head"><Crown size={14} aria-hidden="true" />War Leaders<span className="count-chip">{pairedWarLeaders}</span></span>
        <span className="pairing-col-head"><Wrench size={14} aria-hidden="true" />Engineers<span className="count-chip">{pairedEngineers}</span></span>
      </div>
      {displayRows.map((row, index) => <div className="pairing-row" key={row.id}>
        <span className="pairing-row-number">{index + 1}</span>
        <PairingSlot column="warLeader" row={row} rowNumber={index + 1} member={row.warLeaderId ? memberById.get(row.warLeaderId) : undefined}
          canManage={canManage} held={held} onPick={handleChipPick}
          onEmptyActivate={() => place("warLeader", { kind: "row", rowId: row.id }, index + 1)}
          onDrop={(event) => handleRowDrop(event, "warLeader", row.id)}
          onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        <PairingSlot column="engineer" row={row} rowNumber={index + 1} member={row.engineerId ? memberById.get(row.engineerId) : undefined}
          canManage={canManage} held={held} onPick={handleChipPick}
          onEmptyActivate={() => place("engineer", { kind: "row", rowId: row.id }, index + 1)}
          onDrop={(event) => handleRowDrop(event, "engineer", row.id)}
          onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
      </div>)}
    </div>
    <div className="pairing-unpaired-grid">
      <PairingPool column="warLeader" title="Unpaired War Leaders" members={resolved.unpairedWarLeaders} canManage={canManage} held={held}
        onPick={handleChipPick} onPoolActivate={() => place("warLeader", { kind: "unpaired" })}
        onDrop={(event) => handlePoolDrop(event, "warLeader")} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
      <PairingPool column="engineer" title="Unpaired Engineers" members={resolved.unpairedEngineers} canManage={canManage} held={held}
        onPick={handleChipPick} onPoolActivate={() => place("engineer", { kind: "unpaired" })}
        onDrop={(event) => handlePoolDrop(event, "engineer")} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
    </div>
    {resolved.withoutProfession > 0 && <p className="pairing-footnote">{resolved.withoutProfession} active member{resolved.withoutProfession === 1 ? "" : "s"} {resolved.withoutProfession === 1 ? "has" : "have"} no profession recorded and {resolved.withoutProfession === 1 ? "isn’t" : "aren’t"} shown here.</p>}
    {canManage && <div className="pairing-actions">
      {dirty && <span className="pairing-dirty-note">Unsaved changes</span>}
      <button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setDraft(undefined); setError(""); }}>Discard</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save pairings"}</button>
    </div>}
    {error && <p className="form-error-box" role="alert">{error}</p>}
  </div>;
}

function PairingChip({ member, column, rowId, rowNumber, canManage, held, onPick, onDragStart, onDragEnd }: {
  member: Member; column: PairingColumn; rowId?: string; rowNumber?: number; canManage: boolean; held?: Held;
  onPick: (member: Member, column: PairingColumn, rowId: string | undefined, rowNumber: number | undefined) => void;
  onDragStart: (event: React.DragEvent, member: Member, column: PairingColumn) => void;
  onDragEnd: () => void;
}) {
  const picked = held?.memberId === member.id;
  const mismatch = rowId !== undefined ? slotMismatch(member, column) : null;
  const flagText = mismatch === null ? null : mismatch === "no profession" ? "no profession" : `currently ${mismatch}`;
  const shortFlagText = mismatch === null || mismatch === "no profession" ? flagText : `currently ${mismatch === "War Leader" ? "WL" : "ENG"}`;
  const content = <><MemberAvatar member={member} /><MemberName member={member} />{flagText && <span className="pairing-chip-flag" title={flagText}>
    <span className="sr-only">{flagText}</span>
    <span aria-hidden="true" className="pairing-chip-flag-long">{flagText}</span>
    <span aria-hidden="true" className="pairing-chip-flag-short">{shortFlagText}</span>
  </span>}<span className="pairing-chip-power">{memberStats(member).powerDisplay}</span></>;
  if (!canManage) return <div className="pairing-chip">{content}</div>;
  return <button type="button" className="pairing-chip" draggable aria-pressed={picked}
    onDragStart={(event) => onDragStart(event, member, column)} onDragEnd={onDragEnd}
    onClick={() => onPick(member, column, rowId, rowNumber)}>{content}</button>;
}

function PairingSlot({ column, row, rowNumber, member, canManage, held, onPick, onEmptyActivate, onDrop, onDragStart, onDragEnd }: {
  column: PairingColumn; row: PairingRow; rowNumber: number; member?: Member; canManage: boolean; held?: Held;
  onPick: (member: Member, column: PairingColumn, rowId: string | undefined, rowNumber: number | undefined) => void;
  onEmptyActivate: () => void;
  onDrop: (event: React.DragEvent) => void;
  onDragStart: (event: React.DragEvent, member: Member, column: PairingColumn) => void;
  onDragEnd: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dragProps = canManage ? {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDragEnter: () => setDragOver(true),
    onDragLeave: () => setDragOver(false),
    onDrop: (event: React.DragEvent) => { setDragOver(false); onDrop(event); },
  } : {};
  return <div className="pairing-slot" data-dragover={dragOver || undefined} {...dragProps}>
    {member
      ? <PairingChip member={member} column={column} rowId={row.id} rowNumber={rowNumber} canManage={canManage} held={held} onPick={onPick} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      : canManage
        ? <button type="button" className="pairing-slot-empty" disabled={!held} aria-label={`Empty ${columnLabel(column)} slot, row ${rowNumber}`} onClick={onEmptyActivate}>Empty</button>
        : <span className="pairing-slot-empty">—</span>}
  </div>;
}

function PairingPool({ column, title, members, canManage, held, onPick, onPoolActivate, onDrop, onDragStart, onDragEnd }: {
  column: PairingColumn; title: string; members: Member[]; canManage: boolean; held?: Held;
  onPick: (member: Member, column: PairingColumn, rowId: string | undefined, rowNumber: number | undefined) => void;
  onPoolActivate: () => void;
  onDrop: (event: React.DragEvent) => void;
  onDragStart: (event: React.DragEvent, member: Member, column: PairingColumn) => void;
  onDragEnd: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dragProps = canManage ? {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDragEnter: () => setDragOver(true),
    onDragLeave: () => setDragOver(false),
    onDrop: (event: React.DragEvent) => { setDragOver(false); onDrop(event); },
  } : {};
  return <section className="panel pairing-pool">
    <div className="panel-head"><h3>{title} <span className="count-chip">{members.length}</span></h3></div>
    <ul className="pairing-pool-list" data-dragover={dragOver || undefined} {...dragProps}>
      {members.length ? members.map((member) => <li key={member.id}>
        <PairingChip member={member} column={column} canManage={canManage} held={held} onPick={onPick} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      </li>) : <li className="pairing-pool-empty">None</li>}
    </ul>
    {canManage && <button type="button" className="pairing-pool-target" disabled={!held} onClick={onPoolActivate}>Move held {columnLabel(column)} here</button>}
  </section>;
}
