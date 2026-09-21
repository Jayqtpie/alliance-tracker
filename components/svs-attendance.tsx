"use client";

import { CheckCheck, Percent, Plus, Search, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import type { SvsAttendance, SvsEvent, TrackerState } from "@/lib/types";
import { attendanceCounts, attendanceSummary, createSvsEvent, markAllPresent, overallAttendance, setAttendance, SVS_ATTENDANCE } from "@/lib/svs";
import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { useLanguage } from "./language-selector";
import type { Language, Translator } from "@/lib/i18n";
import "./svs-attendance.css";

type SummarySort = "rate" | "absent" | "present" | "name";

const LABELS: Record<SvsAttendance, string> = { present: "Present", absent: "Absent", excused: "Excused" };

function fightDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function countLine(t: Translator, event: SvsEvent) {
  const counts = attendanceCounts(event);
  const line = t("{present}/{total} present", { present: counts.present, total: counts.total });
  return counts.excused ? `${line} · ${t("{count} excused", { count: counts.excused })}` : line;
}

export function SvsAttendanceView({ canManage, state, onSaved }: { canManage: boolean; state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<SvsEvent[] | undefined>(undefined);
  const [mode, setMode] = useState<"fights" | "summary">("fights");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SummarySort>("rate");
  const [newDate, setNewDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [newLabel, setNewLabel] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty = draft !== undefined;
  const events = draft ?? state.svsEvents ?? [];
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const selected = sorted.find((event) => event.id === selectedId) ?? sorted[0];
  const memberById = new Map(state.members.map((member) => [member.id, member]));

  function select(id: string) { setSelectedId(id); setConfirmDelete(false); }

  function addFight() {
    const event = createSvsEvent(state.members, newDate, newLabel);
    setDraft([...events, event]);
    setNewLabel("");
    select(event.id);
  }

  function mark(memberId: string, value: SvsAttendance) {
    if (!selected) return;
    setDraft(events.map((event) => event.id === selected.id ? setAttendance(event, memberId, value) : event));
  }

  function deleteFight() {
    if (!selected) return;
    setDraft(events.filter((event) => event.id !== selected.id));
    setConfirmDelete(false);
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/svs", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: draft, version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not save attendance."));
      onSaved(body);
      setDraft(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save attendance."));
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLocaleLowerCase();
  const checklist = selected ? Object.entries(selected.attendance)
    .map(([memberId, value]) => ({ member: memberById.get(memberId), value }))
    .filter((row): row is { member: NonNullable<typeof row.member>; value: SvsAttendance } => Boolean(row.member))
    .filter((row) => !needle || row.member.canonicalName.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.member.canonicalName.localeCompare(b.member.canonicalName)) : [];

  const overall = overallAttendance(events);
  const fightsLine = overall.fights ? t(overall.fights === 1 ? "across 1 fight" : "across {count} fights", { count: overall.fights }) : t("no fights recorded yet");

  // attendanceSummary already orders by rate; Array.sort is stable, so ties keep that order.
  const summary = attendanceSummary(events, state.members)
    .filter((row) => row.member.active || row.present + row.absent + row.excused > 0)
    .sort((a, b) => sort === "name" ? a.member.canonicalName.localeCompare(b.member.canonicalName)
      : sort === "absent" ? b.absent - a.absent
        : sort === "present" ? b.present - a.present : 0);

  return <div className="page-stack svs-page">
    <section className="dashboard-heading">
      <div><p className="eyebrow">{t("SERVER VS SERVER")}</p><h1>{t("SvS attendance")}<span>.</span></h1><p>{t(canManage ? "Add a fight, then mark who showed up. Excused absences don’t count against a member’s rate." : "Who showed up to each fight. Excused absences don’t count against a member’s rate.")}</p></div>
      <dl className="alliance-totals svs-totals" aria-label={t("Attendance across all fights")}>
        <div className="alliance-total" data-stat="svs-rate">
          <dt><Percent size={14} aria-hidden="true" />{t("Attendance")}</dt>
          <dd><strong>{overall.rate === null ? "—" : `${Math.round(overall.rate * 100)}%`}</strong><span>{fightsLine}</span></dd>
        </div>
        <div className="alliance-total" data-stat="svs-turnout">
          <dt><Users size={14} aria-hidden="true" />{t("Showed up")}</dt>
          <dd><strong>{overall.averagePresent === null ? "—" : `${Math.round(overall.averagePresent)} / ${Math.round(overall.averageRoster)}`}</strong><span>{overall.fights ? t("average per fight") : fightsLine}</span></dd>
        </div>
      </dl>
    </section>
    <div className="svs-mode" role="group" aria-label={t("SvS view")}>
      <button type="button" aria-pressed={mode === "fights"} onClick={() => setMode("fights")}>{t("Fights")}</button>
      <button type="button" aria-pressed={mode === "summary"} onClick={() => setMode("summary")}>{t("Summary")}</button>
    </div>

    {mode === "fights" ? <div className="svs-layout">
      <section className="panel svs-fights">
        <div className="panel-head"><h3>{t("Fights")} <span className="count-chip">{events.length}</span></h3></div>
        {canManage && <form className="svs-new" onSubmit={(event) => { event.preventDefault(); addFight(); }}>
          <input type="date" aria-label={t("Fight date")} required value={newDate} onChange={(event) => setNewDate(event.target.value)} />
          <input type="text" aria-label={t("Fight label")} placeholder={t("Label, e.g. vs #931")} maxLength={80} value={newLabel} onChange={(event) => setNewLabel(event.target.value)} />
          <button type="submit" className="button secondary" disabled={!newDate}><Plus size={14} />{t("Add fight")}</button>
        </form>}
        {sorted.length ? <ul className="svs-fight-list">
          {sorted.map((event) => <li key={event.id}>
            <button type="button" aria-pressed={event.id === selected?.id} onClick={() => select(event.id)}>
              <strong>{fightDate(language, event.date)}</strong>
              {event.label && <span>{event.label}</span>}
              <small>{countLine(t, event)}</small>
            </button>
          </li>)}
        </ul> : <p className="svs-empty">{t("No fights recorded yet.")}</p>}
      </section>

      {selected && <section className="panel svs-checklist">
        <div className="panel-head">
          <div><h3>{fightDate(language, selected.date)}{selected.label ? ` · ${selected.label}` : ""}</h3><p className="svs-counts">{countLine(t, selected)}</p></div>
          <div className="svs-checklist-tools">
          {canManage && <button type="button" className="button secondary" disabled={!Object.values(selected.attendance).includes("absent")}
            onClick={() => setDraft(events.map((event) => event.id === selected.id ? markAllPresent(event) : event))}><CheckCheck size={14} />{t("Mark all present")}</button>}
          <div className="search-box"><Search size={16} /><input aria-label={t("Filter fight members")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Find a commander…")} />{query && <button className="search-clear" aria-label={t("Clear member filter")} onClick={() => setQuery("")}><X size={14} /></button>}</div>
          </div>
        </div>
        <ul className="svs-member-list">
          {checklist.map(({ member, value }) => <li key={member.id} data-state={value}>
            <span className="svs-member"><MemberAvatar member={member} /><MemberName member={member} /></span>
            {canManage
              ? <span className="svs-toggle" role="group" aria-label={t("{name} attendance", { name: member.canonicalName })}>
                {SVS_ATTENDANCE.map((option) => <button key={option} type="button" data-option={option} aria-pressed={value === option}
                  aria-label={t("Mark {name} {status}", { name: member.canonicalName, status: t(LABELS[option]).toLocaleLowerCase() })} onClick={() => mark(member.id, option)}>{t(LABELS[option])}</button>)}
              </span>
              : <span className="svs-pill" data-option={value}>{t(LABELS[value])}</span>}
          </li>)}
          {!checklist.length && <li className="svs-empty">{t(needle ? "No one matches that name." : "No members on this fight.")}</li>}
        </ul>
        {canManage && <div className="svs-delete">
          {confirmDelete
            ? <><span>{t("Delete this fight and its attendance?")}</span>
              <button type="button" className="button secondary" onClick={() => setConfirmDelete(false)}>{t("Cancel")}</button>
              <button type="button" className="button danger" onClick={deleteFight}>{t("Delete")}</button></>
            : <button type="button" className="button ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{t("Delete fight")}</button>}
        </div>}
      </section>}
    </div> : <section className="panel svs-summary">
      <div className="panel-head"><h3>{t("Attendance rate")} <span className="count-chip">{t(events.length === 1 ? "1 fight" : "{count} fights", { count: events.length })}</span></h3>
        <select aria-label={t("Sort attendance")} value={sort} onChange={(event) => setSort(event.target.value as SummarySort)}>
          <option value="rate">{t("Rate · lowest first")}</option><option value="absent">{t("Absences")} ↓</option><option value="present">{t("Present")} ↓</option><option value="name">{t("Name A–Z")}</option>
        </select>
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>{t("Member")}</th><th>{t("Present")}</th><th>{t("Absent")}</th><th>{t("Excused")}</th><th>{t("Rate")}</th></tr></thead>
        <tbody>{summary.map((row) => <tr key={row.member.id} className={row.member.active ? undefined : "svs-left"}>
          <td><span className="svs-member"><MemberAvatar member={row.member} /><MemberName member={row.member} /></span></td>
          <td>{row.present}</td><td>{row.absent}</td><td>{row.excused}</td>
          <td>{row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {canManage && <div className="svs-actions">
      {dirty && <span className="svs-dirty-note">{t("Unsaved changes")}</span>}
      <button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setDraft(undefined); setError(""); setConfirmDelete(false); }}>{t("Discard")}</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={save}>{t(busy ? "Saving…" : "Save attendance")}</button>
    </div>}
    {error && <p className="form-error-box" role="alert">{error}</p>}
  </div>;
}
