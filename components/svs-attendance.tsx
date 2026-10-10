"use client";

import { AlertTriangle, CheckCheck, Lock, LockOpen, Percent, Plus, RefreshCw, Search, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import type { AttendanceEventKind, Member, SvsAttendance, SvsEvent, TrackerState } from "@/lib/types";
import { attendanceCounts, attendanceSummary, createSvsEvent, EVENT_KINDS, eventKind, markAllPresent, overallAttendance, REPEAT_STREAK, repeatAbsences, rosterDrift, setAttendance, SVS_ATTENDANCE, syncRoster } from "@/lib/svs";
import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { useLanguage } from "./language-selector";
import type { Language, Translator } from "@/lib/i18n";
import "./svs-attendance.css";

type SummarySort = "rate" | "absent" | "present" | "name";

const LABELS: Record<SvsAttendance, string> = { present: "Present", absent: "Absent", excused: "Excused" };

const KINDS: Record<AttendanceEventKind, { tab: string; eyebrow: string; title: string; placeholder: string }> = {
  svs: { tab: "SvS", eyebrow: "SERVER VS SERVER", title: "SvS attendance", placeholder: "Label, e.g. vs #931" },
  goldvein: { tab: "Goldvein", eyebrow: "ALLIANCE EVENT", title: "Goldvein attendance", placeholder: "Label (optional)" },
};

function fightDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function shortDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { day: "numeric", month: "short" });
}

function countLine(t: Translator, event: SvsEvent) {
  const counts = attendanceCounts(event);
  const line = t("{present}/{total} present", { present: counts.present, total: counts.total });
  return counts.excused ? `${line} · ${t("{count} excused", { count: counts.excused })}` : line;
}

/** Members to chase: see {@link repeatAbsences} for the rule. Pass every event kind; misses count together. */
export function RepeatAbsences({ events, members }: { events: SvsEvent[]; members: Member[] }) {
  const { language, t } = useLanguage();
  const repeats = repeatAbsences(events, members);
  return <section className="panel svs-repeats">
    <div className="panel-head"><div><h3><AlertTriangle size={15} aria-hidden="true" />{t("Repeat absences")} <span className="count-chip">{repeats.length}</span></h3>
      <p className="svs-counts">{t("Missed the last 2+ fights in a row, or 3+ of their last 5, counting SvS and Goldvein together. Excused fights are skipped.")}</p></div></div>
    <ul className="svs-member-list">
      {repeats.map((row) => <li key={row.member.id}>
        <span className="svs-member"><MemberAvatar member={row.member} /><MemberName member={row.member} /></span>
        <span className="svs-repeat-stats">
          {row.streak >= REPEAT_STREAK && <span className="svs-pill" data-option="absent">{t("{count} in a row", { count: row.streak })}</span>}
          <span>{t("{absent} of last {counted}", { absent: row.recentAbsent, counted: row.recentCounted })}</span>
          <small>{row.lastPresent ? t("Last attended {date}", { date: shortDate(language, row.lastPresent) }) : t("Never attended")}</small>
        </span>
      </li>)}
      {!repeats.length && <li className="svs-empty">{t("No one has missed repeatedly.")}</li>}
    </ul>
  </section>;
}

export function SvsAttendanceView({ canManage, state, onSaved }: { canManage: boolean; state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<SvsEvent[] | undefined>(undefined);
  // Open on whichever kind was recorded most recently.
  const [kind, setKind] = useState<AttendanceEventKind>(() => {
    const newest = [...(state.svsEvents ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
    return newest ? eventKind(newest) : "svs";
  });
  const [mode, setMode] = useState<"fights" | "summary">("fights");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SummarySort>("rate");
  const [newDate, setNewDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [newLabel, setNewLabel] = useState("");
  const [confirm, setConfirm] = useState<"delete" | "unlock" | "sync" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty = draft !== undefined;
  const allEvents = draft ?? state.svsEvents ?? [];
  const events = allEvents.filter((event) => eventKind(event) === kind);
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const selected = sorted.find((event) => event.id === selectedId) ?? sorted[0];
  const memberById = new Map(state.members.map((member) => [member.id, member]));

  function select(id: string) { setSelectedId(id); setConfirm(null); }

  function addFight() {
    const event = createSvsEvent(state.members, newDate, newLabel, kind);
    setDraft([...allEvents, event]);
    setNewLabel("");
    select(event.id);
  }

  function mark(memberId: string, value: SvsAttendance) {
    if (!selected) return;
    setDraft(allEvents.map((event) => event.id === selected.id ? setAttendance(event, memberId, value) : event));
  }

  function syncFight() {
    if (!selected) return;
    setDraft(allEvents.map((event) => event.id === selected.id ? syncRoster(event, state.members) : event));
    setConfirm(null);
  }

  function deleteFight() {
    if (!selected) return;
    setDraft(allEvents.filter((event) => event.id !== selected.id));
    setConfirm(null);
  }

  // Locking saves straight away, and only with no unsaved edits, so a lock never carries other changes.
  function setLocked(locked: boolean) {
    if (!selected || dirty) return;
    void persist((state.svsEvents ?? []).map((event) => event.id === selected.id ? { ...event, locked } : event));
    setConfirm(null);
  }

  async function save() {
    if (draft) await persist(draft);
  }

  async function persist(next: SvsEvent[]) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/svs", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: next, version: state.version }),
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

  const editable = canManage && !selected?.locked;
  // A fight created before a roster refresh lands is missing joiners and still lists leavers.
  const drift = editable && selected ? rosterDrift(selected, state.members) : { added: [], removed: [] };
  const drifted = drift.added.length > 0 || drift.removed.length > 0;
  const syncLine = [
    drift.added.length ? t("Add as absent: {names}", { names: drift.added.map((member) => member.canonicalName).join(", ") }) : "",
    drift.removed.length ? t("Remove, no longer active: {names}", { names: drift.removed.map((id) => memberById.get(id)?.canonicalName ?? id).join(", ") }) : "",
  ].filter(Boolean).join(" · ");
  const needle = query.trim().toLocaleLowerCase();
  const checklist = selected ? Object.entries(selected.attendance)
    .map(([memberId, value]) => ({ member: memberById.get(memberId), value }))
    .filter((row): row is { member: NonNullable<typeof row.member>; value: SvsAttendance } => Boolean(row.member))
    .filter((row) => !needle || row.member.canonicalName.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.member.canonicalName.localeCompare(b.member.canonicalName)) : [];

  const overall = overallAttendance(events);
  // Turnout is per fight: the selected one, so each fight reads against its own roster.
  const selectedCounts = selected ? attendanceCounts(selected) : undefined;
  const fightsLine = overall.fights ? t(overall.fights === 1 ? "across 1 fight" : "across {count} fights", { count: overall.fights }) : t("no fights recorded yet");

  // attendanceSummary already orders by rate; Array.sort is stable, so ties keep that order.
  const summary = attendanceSummary(events, state.members)
    .filter((row) => row.member.active || row.present + row.absent + row.excused > 0)
    .sort((a, b) => sort === "name" ? a.member.canonicalName.localeCompare(b.member.canonicalName)
      : sort === "absent" ? b.absent - a.absent
        : sort === "present" ? b.present - a.present : 0);

  return <div className="page-stack svs-page">
    <div className="svs-mode" role="group" aria-label={t("Event type")}>
      {EVENT_KINDS.map((option) => <button key={option} type="button" aria-pressed={kind === option} onClick={() => { setKind(option); setConfirm(null); }}>{t(KINDS[option].tab)}</button>)}
    </div>
    <section className="dashboard-heading">
      <div><p className="eyebrow">{t(KINDS[kind].eyebrow)}</p><h1>{t(KINDS[kind].title)}<span>.</span></h1><p>{t(canManage ? "Add a fight, then mark who showed up. Excused absences don’t count against a member’s rate." : "Who showed up to each fight. Excused absences don’t count against a member’s rate.")}</p></div>
      <dl className="alliance-totals svs-totals" aria-label={t("Attendance across all fights")}>
        <div className="alliance-total" data-stat="svs-rate">
          <dt><Percent size={14} aria-hidden="true" />{t("Attendance")}</dt>
          <dd><strong>{overall.rate === null ? "—" : `${Math.round(overall.rate * 100)}%`}</strong><span>{fightsLine}</span></dd>
        </div>
        <div className="alliance-total" data-stat="svs-turnout">
          <dt><Users size={14} aria-hidden="true" />{t("Showed up")}</dt>
          <dd><strong>{selectedCounts ? `${selectedCounts.present} / ${selectedCounts.total}` : "—"}</strong><span>{selected ? [shortDate(language, selected.date), selected.label].filter(Boolean).join(" · ") : fightsLine}</span></dd>
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
          <input type="text" aria-label={t("Fight label")} placeholder={t(KINDS[kind].placeholder)} maxLength={80} value={newLabel} onChange={(event) => setNewLabel(event.target.value)} />
          <button type="submit" className="button secondary" disabled={!newDate}><Plus size={14} />{t("Add fight")}</button>
        </form>}
        {sorted.length ? <ul className="svs-fight-list">
          {sorted.map((event) => <li key={event.id}>
            <button type="button" aria-pressed={event.id === selected?.id} onClick={() => select(event.id)}>
              <strong>{fightDate(language, event.date)}{event.locked && <Lock size={11} role="img" aria-label={t("Locked")} />}</strong>
              {event.label && <span>{event.label}</span>}
              <small>{countLine(t, event)}</small>
            </button>
          </li>)}
        </ul> : <p className="svs-empty">{t("No fights recorded yet.")}</p>}
      </section>

      {selected && <section className="panel svs-checklist">
        <div className="panel-head">
          <div><h3>{fightDate(language, selected.date)}{selected.label ? ` · ${selected.label}` : ""}{selected.locked && <Lock size={14} role="img" aria-label={t("Locked")} />}</h3><p className="svs-counts">{countLine(t, selected)}</p></div>
          <div className="svs-checklist-tools">
          {editable && <button type="button" className="button secondary" disabled={!Object.values(selected.attendance).includes("absent")}
            onClick={() => setDraft(allEvents.map((event) => event.id === selected.id ? markAllPresent(event) : event))}><CheckCheck size={14} />{t("Mark all present")}</button>}
          {drifted && <button type="button" className="button secondary" onClick={() => setConfirm("sync")}><RefreshCw size={14} />{t("Sync roster")}</button>}
          <div className="search-box"><Search size={16} /><input aria-label={t("Filter fight members")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Find a commander…")} />{query && <button className="search-clear" aria-label={t("Clear member filter")} onClick={() => setQuery("")}><X size={14} /></button>}</div>
          </div>
        </div>
        <ul className="svs-member-list">
          {checklist.map(({ member, value }) => <li key={member.id} data-state={value}>
            <span className="svs-member"><MemberAvatar member={member} /><MemberName member={member} /></span>
            {editable
              ? <span className="svs-toggle" role="group" aria-label={t("{name} attendance", { name: member.canonicalName })}>
                {SVS_ATTENDANCE.map((option) => <button key={option} type="button" data-option={option} aria-pressed={value === option}
                  aria-label={t("Mark {name} {status}", { name: member.canonicalName, status: t(LABELS[option]).toLocaleLowerCase() })} onClick={() => mark(member.id, option)}>{t(LABELS[option])}</button>)}
              </span>
              : <span className="svs-pill" data-option={value}>{t(LABELS[value])}</span>}
          </li>)}
          {!checklist.length && <li className="svs-empty">{t(needle ? "No one matches that name." : "No members on this fight.")}</li>}
        </ul>
        {canManage && <div className="svs-delete">
          {confirm === "delete"
            ? <><span>{t("Delete this fight and its attendance?")}</span>
              <button type="button" className="button secondary" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
              <button type="button" className="button danger" onClick={deleteFight}>{t("Delete")}</button></>
            : confirm === "sync" && drifted
              ? <><span>{t("Sync this fight with the current roster?")} {syncLine}</span>
                <button type="button" className="button secondary" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
                <button type="button" className="button primary" onClick={syncFight}><RefreshCw size={14} />{t("Sync roster")}</button></>
            : confirm === "unlock"
              ? <><span>{t("Unlock this fight so its attendance can be edited?")}</span>
                <button type="button" className="button secondary" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
                <button type="button" className="button primary" disabled={busy} onClick={() => setLocked(false)}><LockOpen size={14} />{t("Unlock")}</button></>
              : selected.locked
                ? <><span>{t(dirty ? "Save or discard your changes first." : "Locked. Unlock it to make changes.")}</span>
                  <button type="button" className="button ghost" disabled={busy || dirty} onClick={() => setConfirm("unlock")}><LockOpen size={14} />{t("Unlock fight")}</button></>
                : <>{dirty && <span>{t("Save or discard your changes first.")}</span>}
                  <button type="button" className="button ghost" disabled={busy || dirty} onClick={() => setLocked(true)}><Lock size={14} />{t("Lock fight")}</button>
                  <button type="button" className="button ghost" onClick={() => setConfirm("delete")}><Trash2 size={14} />{t("Delete fight")}</button></>}
        </div>}
      </section>}
    </div> : <>{allEvents.length > 0 && <RepeatAbsences events={allEvents} members={state.members} />}
    <section className="panel svs-summary">
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
    </section></>}

    {canManage && <div className="svs-actions">
      {dirty && <span className="svs-dirty-note">{t("Unsaved changes")}</span>}
      <button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setDraft(undefined); setError(""); setConfirm(null); }}>{t("Discard")}</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={save}>{t(busy ? "Saving…" : "Save attendance")}</button>
    </div>}
    {error && <p className="form-error-box" role="alert">{error}</p>}
  </div>;
}
