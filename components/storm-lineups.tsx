"use client";

import { CheckCheck, CircleParking, Lock, LockOpen, Search, Shuffle, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import type { Member, StormResult, StormSlot, StormSlotRole, StormTeam, StormType, StormWeek, TrackerState } from "@/lib/types";
import { memberStats } from "@/lib/member-stats";
import {
  createStormWeek, markStartersPlayed, parkedFor, parksNextWeek, placeMember, previousWeek, removeMember, seatsTaken,
  setPark, setResult, STORM_CAPACITY, STORM_KINDS, STORM_RESULTS, STORM_ROLES, STORM_TEAMS, stormSummary, weekCounts,
} from "@/lib/storms";
import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { useLanguage } from "./language-selector";
import type { Language } from "@/lib/i18n";
import "./svs-attendance.css";
import "./storm-lineups.css";

const KIND_LABELS: Record<StormType, string> = { desert: "Desert Storm", canyon: "Canyon Storm" };
const RESULT_LABELS: Record<StormResult, string> = { played: "Played", missed: "Missed", excused: "Excused" };
const ROLE_LABELS: Record<StormSlotRole, string> = { starter: "Starters", sub: "Subs" };
const SEATS = STORM_TEAMS.flatMap((team) => STORM_ROLES.map((role) => ({ team, role, value: `${team}-${role}` })));

function battleDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function shortDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { day: "numeric", month: "short" });
}

/** The park toggle flips what the slot does now; landing back on the rule clears the override. */
function togglePark(week: StormWeek, slot: StormSlot) {
  const rule = parksNextWeek({ ...slot, park: undefined });
  const next = !parksNextWeek(slot);
  return setPark(week, slot.memberId, next === rule ? undefined : next);
}

export function StormLineupsView({ canManage, state, onSaved }: { canManage: boolean; state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<StormWeek[] | undefined>(undefined);
  const [mode, setMode] = useState<"weeks" | "summary">("weeks");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [newKind, setNewKind] = useState<StormType>(() => [...(state.stormWeeks ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0]?.kind ?? "desert");
  const [confirm, setConfirm] = useState<"delete" | "unlock" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty = draft !== undefined;
  const allWeeks = draft ?? state.stormWeeks ?? [];
  const sorted = [...allWeeks].sort((a, b) => b.date.localeCompare(a.date));
  const selected = sorted.find((week) => week.id === selectedId) ?? sorted[0];
  const memberById = new Map(state.members.map((member) => [member.id, member]));

  function select(id: string) { setSelectedId(id); setConfirm(null); }

  function change(next: (week: StormWeek) => StormWeek) {
    if (!selected) return;
    setDraft(allWeeks.map((week) => week.id === selected.id ? next(week) : week));
  }

  function addWeek() {
    const week = createStormWeek(state.members, allWeeks, newDate, newKind);
    setDraft([...allWeeks, week]);
    select(week.id);
  }

  function deleteWeek() {
    if (!selected) return;
    setDraft(allWeeks.filter((week) => week.id !== selected.id));
    setConfirm(null);
  }

  // Locking saves straight away, and only with no unsaved edits, so a lock never carries other changes.
  function setLocked(locked: boolean) {
    if (!selected || dirty) return;
    void persist((state.stormWeeks ?? []).map((week) => week.id === selected.id ? { ...week, locked } : week));
    setConfirm(null);
  }

  async function persist(next: StormWeek[]) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/storms", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ weeks: next, version: state.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not save the lineup."));
      onSaved(body);
      setDraft(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save the lineup."));
    } finally {
      setBusy(false);
    }
  }

  const editable = canManage && !selected?.locked;
  const counts = selected ? weekCounts(selected) : undefined;
  const parked = selected ? parkedFor(allWeeks, selected.date) : new Map<string, StormWeek>();
  const previous = selected ? previousWeek(allWeeks, selected.date) : undefined;
  const playedBefore = new Set(previous?.slots.map((slot) => slot.memberId));
  const needle = query.trim().toLocaleLowerCase();
  const matches = (member: Member) => !needle || member.canonicalName.toLocaleLowerCase().includes(needle);
  const power = (member: Member) => memberStats(member).power ?? 0;

  const lineup = selected ? selected.slots
    .map((slot) => ({ slot, member: memberById.get(slot.memberId) }))
    .filter((row): row is { slot: StormSlot; member: Member } => Boolean(row.member) && matches(row.member!))
    .sort((a, b) => power(b.member) - power(a.member)) : [];
  const picked = new Set(selected?.slots.map((slot) => slot.memberId));
  // Who sat out last week comes first: they are next in the rotation.
  const bench = selected ? state.members.filter((member) => member.active && !picked.has(member.id) && matches(member))
    .sort((a, b) => Number(parked.has(a.id)) - Number(parked.has(b.id)) || Number(playedBefore.has(a.id)) - Number(playedBefore.has(b.id)) || power(b) - power(a)) : [];

  const summary = stormSummary(allWeeks, state.members).filter((row) => row.member.active || row.picked > 0);
  const parkedNext = parkedFor(allWeeks, "9999-12-31");

  function seatOptions(week: StormWeek, memberId: string) {
    return SEATS.map(({ team, role, value }) => <option key={value} value={value} disabled={seatsTaken(week, team, role, memberId) >= STORM_CAPACITY[role]}>
      {t("{team} · {role}", { team, role: t(role === "starter" ? "Starter" : "Sub") })}
    </option>);
  }

  function seat(value: string) {
    const [team, role] = value.split("-") as [StormTeam, StormSlotRole];
    return { team, role };
  }

  function slotRow({ slot, member }: { slot: StormSlot; member: Member }) {
    const parks = parksNextWeek(slot);
    return <li key={slot.memberId} data-state={slot.result ?? "unrecorded"}>
      <span className="svs-member"><MemberAvatar member={member} /><MemberName member={member} />
        {parks && <span className="storm-flag" data-flag="parked" title={t(slot.park ? "Parked by an officer" : "Missed as a starter")}><CircleParking size={11} aria-hidden="true" />{t("Parks next week")}</span>}
      </span>
      <span className="storm-power">{memberStats(member).powerDisplay}</span>
      {editable ? <span className="storm-controls">
        <span className="svs-toggle storm-toggle" role="group" aria-label={t("{name} result", { name: member.canonicalName })}>
          {STORM_RESULTS.map((option) => <button key={option} type="button" data-option={option} aria-pressed={slot.result === option}
            aria-label={t("Mark {name} {status}", { name: member.canonicalName, status: t(RESULT_LABELS[option]).toLocaleLowerCase() })}
            onClick={() => change((week) => setResult(week, slot.memberId, slot.result === option ? undefined : option))}>{t(RESULT_LABELS[option])}</button>)}
        </span>
        <button type="button" className="storm-park" aria-pressed={parks} aria-label={t("Park {name} next week", { name: member.canonicalName })}
          title={t("Park next week")} onClick={() => change((week) => togglePark(week, slot))}><CircleParking size={14} aria-hidden="true" /></button>
        <select aria-label={t("Move {name}", { name: member.canonicalName })} value={`${slot.team}-${slot.role}`}
          onChange={(event) => change((week) => event.target.value === "remove" ? removeMember(week, slot.memberId) : placeMember(week, slot.memberId, seat(event.target.value).team, seat(event.target.value).role))}>
          {seatOptions(selected!, slot.memberId)}
          <option value="remove">{t("Remove from lineup")}</option>
        </select>
      </span> : <span className="svs-pill storm-pill" data-option={slot.result ?? "unrecorded"}>{t(slot.result ? RESULT_LABELS[slot.result] : "Not recorded")}</span>}
    </li>;
  }

  return <div className="page-stack svs-page storm-page">
    <section className="dashboard-heading">
      <div><p className="eyebrow">{t("WEEKLY BATTLEFIELD")}</p><h1>{t("Storm lineups")}<span>.</span></h1>
        <p>{t(canManage
          ? "Suggest a lineup, adjust it, then record who played. Starters who miss sit out the next week."
          : "Who was picked for each Desert Storm and Canyon Storm, and who played. Starters who miss sit out the next week.")}</p></div>
      <dl className="alliance-totals svs-totals" aria-label={t("Selected week")}>
        <div className="alliance-total" data-stat="storm-starters">
          <dt><Users size={14} aria-hidden="true" />{t("Starters played")}</dt>
          <dd><strong>{counts ? `${counts.startersPlayed} / ${counts.starters}` : "—"}</strong><span>{selected ? `${shortDate(language, selected.date)} · ${t(KIND_LABELS[selected.kind])}` : t("no weeks recorded yet")}</span></dd>
        </div>
        <div className="alliance-total" data-stat="storm-parked">
          <dt><CircleParking size={14} aria-hidden="true" />{t("Parked next week")}</dt>
          <dd><strong>{counts ? counts.parked : "—"}</strong><span>{selected ? t("from this week") : t("no weeks recorded yet")}</span></dd>
        </div>
      </dl>
    </section>
    <div className="svs-mode" role="group" aria-label={t("Storm view")}>
      <button type="button" aria-pressed={mode === "weeks"} onClick={() => setMode("weeks")}>{t("Weeks")}</button>
      <button type="button" aria-pressed={mode === "summary"} onClick={() => setMode("summary")}>{t("Summary")}</button>
    </div>

    {mode === "weeks" ? <div className="svs-layout">
      <section className="panel svs-fights">
        <div className="panel-head"><h3>{t("Weeks")} <span className="count-chip">{allWeeks.length}</span></h3></div>
        {canManage && <form className="svs-new storm-new" onSubmit={(event) => { event.preventDefault(); addWeek(); }}>
          <input type="date" aria-label={t("Battle date")} required value={newDate} onChange={(event) => setNewDate(event.target.value)} />
          <select aria-label={t("Battlefield")} value={newKind} onChange={(event) => setNewKind(event.target.value as StormType)}>
            {STORM_KINDS.map((kind) => <option key={kind} value={kind}>{t(KIND_LABELS[kind])}</option>)}
          </select>
          <button type="submit" className="button secondary" disabled={!newDate}><Shuffle size={14} />{t("Suggest lineup")}</button>
        </form>}
        {sorted.length ? <ul className="svs-fight-list">
          {sorted.map((week) => {
            const weekly = weekCounts(week);
            return <li key={week.id}>
              <button type="button" aria-pressed={week.id === selected?.id} onClick={() => select(week.id)}>
                <strong>{battleDate(language, week.date)}{week.locked && <Lock size={11} role="img" aria-label={t("Locked")} />}</strong>
                <span>{t(KIND_LABELS[week.kind])}</span>
                <small>{t("{played}/{starters} starters played · {parked} parked", { played: weekly.startersPlayed, starters: weekly.starters, parked: weekly.parked })}</small>
              </button>
            </li>;
          })}
        </ul> : <p className="svs-empty">{t("No weeks recorded yet.")}</p>}
      </section>

      {selected && counts && <section className="panel svs-checklist storm-week">
        <div className="panel-head">
          <div><h3>{battleDate(language, selected.date)} · {t(KIND_LABELS[selected.kind])}{selected.locked && <Lock size={14} role="img" aria-label={t("Locked")} />}</h3>
            <p className="svs-counts">{t("{starters}/40 starters · {subs}/20 subs · {played} played · {missed} missed · {unrecorded} not recorded", { starters: counts.starters, subs: counts.subs, played: counts.played, missed: counts.missed, unrecorded: counts.unrecorded })}</p></div>
          <div className="svs-checklist-tools">
            {editable && <button type="button" className="button secondary" disabled={!selected.slots.some((slot) => slot.role === "starter" && !slot.result)}
              onClick={() => change(markStartersPlayed)}><CheckCheck size={14} />{t("Mark starters played")}</button>}
            <div className="search-box"><Search size={16} /><input aria-label={t("Filter lineup members")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Find a commander…")} />{query && <button className="search-clear" aria-label={t("Clear member filter")} onClick={() => setQuery("")}><X size={14} /></button>}</div>
          </div>
        </div>
        <div className="storm-teams">
          {STORM_TEAMS.map((team) => <section key={team} className="storm-team" aria-label={t("Team {team}", { team })}>
            <h4>{t("Team {team}", { team })}</h4>
            {STORM_ROLES.map((role) => {
              const rows = lineup.filter(({ slot }) => slot.team === team && slot.role === role);
              return <div key={role} className="storm-group">
                <h5>{t(ROLE_LABELS[role])} <span className="count-chip">{seatsTaken(selected, team, role)}/{STORM_CAPACITY[role]}</span></h5>
                <ul className="svs-member-list">
                  {rows.map(slotRow)}
                  {!rows.length && <li className="svs-empty">{t(needle ? "No one matches that name." : "No one here yet.")}</li>}
                </ul>
              </div>;
            })}
          </section>)}
        </div>

        <section className="storm-bench" aria-label={t("Not in this lineup")}>
          <h4>{t("Not in this lineup")} <span className="count-chip">{bench.length}</span></h4>
          <ul className="svs-member-list">
            {bench.map((member) => {
              const parkedFrom = parked.get(member.id);
              return <li key={member.id} data-state={parkedFrom ? "parked" : "bench"}>
                <span className="svs-member"><MemberAvatar member={member} /><MemberName member={member} />
                  {parkedFrom
                    ? <span className="storm-flag" data-flag="parked"><CircleParking size={11} aria-hidden="true" />{t("Parked · from {date}", { date: shortDate(language, parkedFrom.date) })}</span>
                    : previous && !playedBefore.has(member.id) && <span className="storm-flag" data-flag="due">{t("Sat out last week")}</span>}
                </span>
                <span className="storm-power">{memberStats(member).powerDisplay}</span>
                {editable && !parkedFrom && <select aria-label={t("Add {name}", { name: member.canonicalName })} value=""
                  onChange={(event) => change((week) => placeMember(week, member.id, seat(event.target.value).team, seat(event.target.value).role))}>
                  <option value="" disabled>{t("Add to…")}</option>
                  {seatOptions(selected, member.id)}
                </select>}
              </li>;
            })}
            {!bench.length && <li className="svs-empty">{t(needle ? "No one matches that name." : "Everyone active is in the lineup.")}</li>}
          </ul>
        </section>

        {canManage && <div className="svs-delete">
          {confirm === "delete"
            ? <><span>{t("Delete this week and its lineup?")}</span>
              <button type="button" className="button secondary" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
              <button type="button" className="button danger" onClick={deleteWeek}>{t("Delete")}</button></>
            : confirm === "unlock"
              ? <><span>{t("Unlock this week so its lineup can be edited?")}</span>
                <button type="button" className="button secondary" onClick={() => setConfirm(null)}>{t("Cancel")}</button>
                <button type="button" className="button primary" disabled={busy} onClick={() => setLocked(false)}><LockOpen size={14} />{t("Unlock")}</button></>
              : selected.locked
                ? <><span>{t(dirty ? "Save or discard your changes first." : "Locked. Unlock it to make changes.")}</span>
                  <button type="button" className="button ghost" disabled={busy || dirty} onClick={() => setConfirm("unlock")}><LockOpen size={14} />{t("Unlock week")}</button></>
                : <>{dirty && <span>{t("Save or discard your changes first.")}</span>}
                  <button type="button" className="button ghost" disabled={busy || dirty} onClick={() => setLocked(true)}><Lock size={14} />{t("Lock week")}</button>
                  <button type="button" className="button ghost" onClick={() => setConfirm("delete")}><Trash2 size={14} />{t("Delete week")}</button></>}
        </div>}
      </section>}
    </div> : <section className="panel svs-summary storm-summary">
      <div className="panel-head"><h3>{t("Storm record")} <span className="count-chip">{t(allWeeks.length === 1 ? "1 week" : "{count} weeks", { count: allWeeks.length })}</span></h3></div>
      <div className="table-scroll"><table>
        <thead><tr><th>{t("Member")}</th><th>{t("Picked")}</th><th>{t("Played")}</th><th>{t("Missed")}</th><th>{t("Excused")}</th><th>{t("Rate")}</th><th>{t("Next week")}</th></tr></thead>
        <tbody>{summary.map((row) => <tr key={row.member.id} className={row.member.active ? undefined : "svs-left"}>
          <td><span className="svs-member"><MemberAvatar member={row.member} /><MemberName member={row.member} /></span></td>
          <td>{row.picked}</td><td>{row.played}</td><td>{row.missed}</td><td>{row.excused}</td>
          <td>{row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}</td>
          <td>{parkedNext.has(row.member.id) ? <span className="storm-flag" data-flag="parked"><CircleParking size={11} aria-hidden="true" />{t("Parked")}</span> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {canManage && <div className="svs-actions">
      {dirty && <span className="svs-dirty-note">{t("Unsaved changes")}</span>}
      <button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setDraft(undefined); setError(""); setConfirm(null); }}>{t("Discard")}</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => { if (draft) void persist(draft); }}>{t(busy ? "Saving…" : "Save lineup")}</button>
    </div>}
    {error && <p className="form-error-box" role="alert">{error}</p>}
  </div>;
}
