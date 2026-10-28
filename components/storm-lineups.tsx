"use client";

import { Check, CheckCheck, ChevronRight, Cloud, CircleParking, Flag, Lock, LockOpen, Search, Shuffle, Trash2, Trophy, Users, X } from "lucide-react";
import { useState } from "react";
import type { Member, StormOutcome, StormResult, StormSlot, StormSlotRole, StormTeam, StormTeamOutcome, StormType, StormWeek, TrackerState } from "@/lib/types";
import { memberStats, statDisplay } from "@/lib/member-stats";
import {
  createStormWeek, markStartersPlayed, parkedFor, parksNextWeek, placeMember, previousWeek, removeMember, seatsTaken,
  setConfirmed, setOutcome, setPark, setResult, STORM_CAPACITY, STORM_RESULTS, STORM_ROLES, STORM_TEAMS, nextStormDate, stormDayProblem, stormDayRule,
  stormSummary, weekCounts,
} from "@/lib/storms";
import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { StormImport } from "./storm-import";
import { useLanguage } from "./language-selector";
import type { Language, Translator } from "@/lib/i18n";
import "./svs-attendance.css";
import "./storm-lineups.css";

const KIND_LABELS: Record<StormType, string> = { desert: "Desert Storm", canyon: "Canyon Storm" };
const KIND_DAYS: Record<StormType, string> = { desert: "Friday", canyon: "Thursday" };
const RESULT_LABELS: Record<StormResult, string> = { played: "Played", missed: "Missed", excused: "Excused" };
const ROLE_LABELS: Record<StormSlotRole, string> = { starter: "Starters", sub: "Subs" };
const SEATS = STORM_TEAMS.flatMap((team) => STORM_ROLES.map((role) => ({ team, role, value: `${team}-${role}` })));

function battleDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function shortDate(language: Language, date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "en" ? undefined : language, { day: "numeric", month: "short" });
}

const OUTCOME_LABELS: Record<StormOutcome, string> = { win: "Win", loss: "Loss" };

function outcomeLabel(t: Translator, outcome: StormTeamOutcome) {
  const opponent = outcome.opponent?.trim();
  if (outcome.result === "win") return opponent ? t("Won vs {opponent}", { opponent }) : t("Won");
  return opponent ? t("Lost to {opponent}", { opponent }) : t("Lost");
}

/** The park toggle flips what the slot does now; landing back on the rule clears the override. */
function togglePark(week: StormWeek, slot: StormSlot) {
  const rule = parksNextWeek({ ...slot, park: undefined });
  const next = !parksNextWeek(slot);
  return setPark(week, slot.memberId, next === rule ? undefined : next);
}

/**
 * One battlefield's page. The draft holds both kinds, so switching pages keeps unsaved edits, and parking
 * still reads every week: a starter who misses Canyon on Thursday sits out Desert on Friday.
 */
export function StormLineupsView({ kind, canManage, bridgeConfigured = false, state, onSaved }: { kind: StormType; canManage: boolean; bridgeConfigured?: boolean; state: TrackerState; onSaved: (state: TrackerState) => void }) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState<StormWeek[] | undefined>(undefined);
  // Screenshot imports applied to the draft. Saving deletes them; discarding the draft brings them back.
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"weeks" | "summary">("weeks");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [benchOpen, setBenchOpen] = useState(false);
  const [newDate, setNewDate] = useState(() => nextStormDate(new Date().toLocaleDateString("en-CA"), kind));
  const [shownKind, setShownKind] = useState(kind);
  const newDateProblem = newDate ? stormDayProblem(kind, newDate) : undefined;
  const [confirm, setConfirm] = useState<"delete" | "unlock" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Opening the other battlefield moves the add-week date to its day and drops a half-asked question.
  if (shownKind !== kind) {
    setShownKind(kind);
    setNewDate(nextStormDate(new Date().toLocaleDateString("en-CA"), kind));
    setConfirm(null);
  }

  const dirty = draft !== undefined;
  const allWeeks = draft ?? state.stormWeeks ?? [];
  const kindWeeks = allWeeks.filter((week) => week.kind === kind);
  const sorted = [...kindWeeks].sort((a, b) => b.date.localeCompare(a.date));
  const selected = sorted.find((week) => week.id === selectedId) ?? sorted[0];
  const memberById = new Map(state.members.map((member) => [member.id, member]));

  function select(id: string) { setSelectedId(id); setConfirm(null); }

  function change(next: (week: StormWeek) => StormWeek) {
    if (!selected) return;
    setDraft(allWeeks.map((week) => week.id === selected.id ? next(week) : week));
  }

  function addWeek() {
    const week = createStormWeek(state.members, allWeeks, newDate, kind);
    setDraft([...allWeeks, week]);
    select(week.id);
  }

  // Saved straight away, since screenshots can only be uploaded to a saved week.
  function startFromGame() {
    if (dirty) return;
    const week = createStormWeek(state.members, allWeeks, newDate, kind, false);
    select(week.id);
    void persist([...(state.stormWeeks ?? []), week]);
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
      // The results are saved, so their uploads can go. A job left behind expires on its own.
      await Promise.all(appliedJobIds.map((id) => fetch(`/api/bridge/jobs?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined)));
      setAppliedJobIds([]);
      onSaved(body);
      setDraft(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save the lineup."));
    } finally {
      setBusy(false);
    }
  }

  const editable = canManage && !selected?.locked;
  const saved = Boolean(selected && state.stormWeeks?.some((week) => week.id === selected.id));
  const counts = selected ? weekCounts(selected) : undefined;
  const parked = selected ? parkedFor(allWeeks, selected.date) : new Map<string, StormWeek>();
  const previous = selected ? previousWeek(allWeeks, selected.date) : undefined;
  const playedBefore = new Set(previous?.slots.map((slot) => slot.memberId));
  const needle = query.trim().toLocaleLowerCase();
  const matches = (member: Member) => !needle || member.canonicalName.toLocaleLowerCase().includes(needle);
  // Hero power, the measure the suggestion picks and balances by.
  const power = (member: Member) => memberStats(member).heroPower ?? 0;
  const byName = (a: Member, b: Member) => a.canonicalName.localeCompare(b.canonicalName, "en", { sensitivity: "base" });
  const groupPower = (team: StormTeam, role: StormSlotRole) => selected!.slots
    .filter((slot) => slot.team === team && slot.role === role)
    .reduce((sum, slot) => sum + (memberById.has(slot.memberId) ? power(memberById.get(slot.memberId)!) : 0), 0);

  const lineup = selected ? selected.slots
    .map((slot) => ({ slot, member: memberById.get(slot.memberId) }))
    .filter((row): row is { slot: StormSlot; member: Member } => Boolean(row.member) && matches(row.member!))
    .sort((a, b) => power(b.member) - power(a.member)) : [];
  const picked = new Set(selected?.slots.map((slot) => slot.memberId));
  const bench = selected ? state.members.filter((member) => member.active && !picked.has(member.id) && matches(member))
    .sort(byName) : [];
  // Collapsed until opened, and always open while a search is filtering it.
  const benchShown = benchOpen || Boolean(needle);

  const summary = stormSummary(kindWeeks, state.members).filter((row) => row.member.active || row.picked > 0);
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
      <span className="storm-power">{memberStats(member).heroPowerDisplay}</span>
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
      <div><p className="eyebrow">{t("OPERATIONS")} · {t(KIND_DAYS[kind]).toLocaleUpperCase()}</p><h1>{t(KIND_LABELS[kind])}<span>.</span></h1>
        <p>{t(canManage
          ? "Start a week from the game's lineup or suggest one, then record who played. Starters who miss sit out the next storm, Desert or Canyon."
          : "Who was picked for each week and who played. Starters who miss sit out the next storm, Desert or Canyon.")}</p></div>
      <dl className="alliance-totals svs-totals" aria-label={t("Selected week")}>
        <div className="alliance-total" data-stat="storm-starters">
          <dt><Users size={14} aria-hidden="true" />{t("Starters played")}</dt>
          <dd><strong>{counts ? `${counts.startersPlayed} / ${counts.starters}` : "—"}</strong><span>{selected ? shortDate(language, selected.date) : t("no weeks recorded yet")}</span></dd>
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
        <div className="panel-head"><h3>{t("Weeks")} <span className="count-chip">{kindWeeks.length}</span></h3></div>
        {canManage && <form className="svs-new storm-new" onSubmit={(event) => { event.preventDefault(); addWeek(); }}>
          <input type="date" aria-label={t("Battle date")} required value={newDate} aria-invalid={Boolean(newDateProblem)} aria-describedby="storm-new-day"
            onChange={(event) => setNewDate(event.target.value)} />
          {bridgeConfigured && <button type="button" className="button primary" disabled={!newDate || Boolean(newDateProblem) || dirty || busy}
            title={t(dirty ? "Save or discard your changes first." : "Add this week with empty teams, then upload the game's lineup screenshots for each team.")}
            onClick={startFromGame}><Cloud size={14} />{t("Start from the game")}</button>}
          <button type="submit" className="button secondary" disabled={!newDate || Boolean(newDateProblem)}><Shuffle size={14} />{t("Suggest lineup")}</button>
          <p id="storm-new-day" className="storm-new-day" data-problem={newDateProblem ? "" : undefined}>{t(stormDayRule(kind))}</p>
          {!bridgeConfigured && <p className="bridge-unavailable">{t("Claude extraction appears after private Blob storage and a worker secret are configured.")}</p>}
        </form>}
        {sorted.length ? <ul className="svs-fight-list">
          {sorted.map((week) => {
            const weekly = weekCounts(week);
            return <li key={week.id}>
              <button type="button" aria-pressed={week.id === selected?.id} onClick={() => select(week.id)}>
                <strong>{battleDate(language, week.date)}{week.locked && <Lock size={11} role="img" aria-label={t("Locked")} />}</strong>
                <small>{t("{played}/{starters} starters played · {parked} parked", { played: weekly.startersPlayed, starters: weekly.starters, parked: weekly.parked })}</small>
                {week.outcomes && <small className="storm-week-outcomes">{STORM_TEAMS.filter((team) => week.outcomes?.[team]).map((team) => <span key={team} data-result={week.outcomes![team]!.result}>
                  {t("{team}: {outcome}", { team, outcome: outcomeLabel(t, week.outcomes![team]!) })}</span>)}</small>}
              </button>
            </li>;
          })}
        </ul> : <p className="svs-empty">{t("No weeks recorded yet.")}
          {/* The screenshot import lives inside a week, so say where it will appear. */}
          {canManage && bridgeConfigured && <> {t("Start a week from the game above, then upload each team's lineup screenshots there.")}</>}</p>}
      </section>

      {selected && counts && <section className="panel svs-checklist storm-week">
        <div className="panel-head">
          <div><h3>{battleDate(language, selected.date)}{selected.locked && <Lock size={14} role="img" aria-label={t("Locked")} />}</h3>
            <p className="svs-counts">{t("{starters}/40 starters · {subs}/20 subs · {played} played · {missed} missed · {unrecorded} not recorded", { starters: counts.starters, subs: counts.subs, played: counts.played, missed: counts.missed, unrecorded: counts.unrecorded })}</p></div>
          <div className="svs-checklist-tools">
            {editable && <button type="button" className="button secondary" disabled={!selected.slots.some((slot) => slot.role === "starter" && !slot.result)}
              onClick={() => change(markStartersPlayed)}><CheckCheck size={14} />{t("Mark starters played")}</button>}
            <div className="search-box"><Search size={16} /><input aria-label={t("Filter lineup members")} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Find a commander…")} />{query && <button className="search-clear" aria-label={t("Clear member filter")} onClick={() => setQuery("")}><X size={14} /></button>}</div>
          </div>
        </div>
        {/* Before the battle: make each team match the game. After it: record who played. */}
        {/* An upload for an unsaved week would be lost with the draft, so it waits for the save. */}
        {editable && bridgeConfigured && (saved
          ? (["storm-lineup", "storm"] as const).map((kind) => <StormImport key={`${selected.id}-${kind}`} kind={kind}
            week={selected} members={state.members} appliedJobIds={appliedJobIds} refreshKey={state.version}
            onApply={(jobId, next) => { change(() => next); setAppliedJobIds((ids) => [...ids, jobId]); }} />)
          : <p className="storm-import-help">{t("Save the lineup to upload screenshots from the game for this week.")}</p>)}

        <div className="storm-teams">
          {STORM_TEAMS.map((team) => {
            const confirmed = selected.confirmed?.includes(team) ?? false;
            const time = selected.times?.[team];
            const outcome = selected.outcomes?.[team];
            return <section key={team} className="storm-team" aria-label={t("Team {team}", { team })}>
            <h4>{t("Team {team}", { team })}
              {editable
                ? <button type="button" className="storm-confirm" aria-pressed={confirmed} onClick={() => change((week) => setConfirmed(week, team, !confirmed))}
                  title={t(confirmed ? "This lineup matches the game. Changing it clears this." : "Mark this lineup as the one entered in the game, so missing starters count as missed.")}>
                  {confirmed && <Check size={12} aria-hidden="true" />}{t(confirmed ? "Matches the game" : "Mark as matching the game")}</button>
                : confirmed && <span className="storm-flag" data-flag="team"><Check size={11} aria-hidden="true" />{t("Matches the game")}</span>}
            </h4>
            {time && <p className="storm-team-time">{t("Battle: {time}", { time })}</p>}
            {editable
              ? <div className="storm-outcome-edit" role="group" aria-label={t("Team {team} result", { team })}>
                <span className="svs-toggle">
                  {(["win", "loss"] as const).map((result) => <button key={result} type="button" data-option={result} aria-pressed={outcome?.result === result}
                    onClick={() => change((week) => setOutcome(week, team, outcome?.result === result ? undefined : { result, opponent: outcome?.opponent }))}>{t(OUTCOME_LABELS[result])}</button>)}
                </span>
                <input type="text" maxLength={80} value={outcome?.opponent ?? ""} disabled={!outcome} aria-label={t("Team {team} opponent", { team })}
                  placeholder={t(outcome ? "Opponent alliance" : "Pick win or loss first")}
                  onChange={(event) => outcome && change((week) => setOutcome(week, team, { result: outcome.result, opponent: event.target.value }))} />
              </div>
              : outcome && <p className="storm-outcome" data-result={outcome.result}>
                {outcome.result === "win" ? <Trophy size={13} aria-hidden="true" /> : <Flag size={13} aria-hidden="true" />}{outcomeLabel(t, outcome)}</p>}
            {STORM_ROLES.map((role) => {
              const rows = lineup.filter(({ slot }) => slot.team === team && slot.role === role);
              return <div key={role} className="storm-group">
                <h5>{t(ROLE_LABELS[role])} <span className="count-chip">{seatsTaken(selected, team, role)}/{STORM_CAPACITY[role]}</span>
                  <span className="storm-group-power" title={t("Total hero power")}>{statDisplay(groupPower(team, role))}</span></h5>
                <ul className="svs-member-list">
                  {rows.map(slotRow)}
                  {!rows.length && <li className="svs-empty">{t(needle ? "No one matches that name." : "No one here yet.")}</li>}
                </ul>
              </div>;
            })}
          </section>;
          })}
        </div>

        <section className="storm-bench" aria-label={t("Not in this lineup")}>
          <h4 className="storm-bench-head"><button type="button" className="storm-bench-toggle" aria-expanded={benchShown} aria-controls="storm-bench-list"
            disabled={Boolean(needle)} onClick={() => setBenchOpen((open) => !open)}>
            <ChevronRight size={16} aria-hidden="true" />{t("Not in this lineup")} <span className="count-chip">{bench.length}</span></button></h4>
          <ul id="storm-bench-list" className="svs-member-list" hidden={!benchShown}>
            {bench.map((member) => {
              const parkedFrom = parked.get(member.id);
              return <li key={member.id} data-state={parkedFrom ? "parked" : "bench"}>
                <span className="svs-member"><MemberAvatar member={member} /><MemberName member={member} />
                  {parkedFrom
                    ? <span className="storm-flag" data-flag="parked"><CircleParking size={11} aria-hidden="true" />{t("Parked · from {date}", { date: shortDate(language, parkedFrom.date) })}</span>
                    : previous && !playedBefore.has(member.id) && <span className="storm-flag" data-flag="due">{t("Sat out last week")}</span>}
                </span>
                <span className="storm-power">{memberStats(member).heroPowerDisplay}</span>
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
      <div className="panel-head"><h3>{t("Storm record")} <span className="count-chip">{t(kindWeeks.length === 1 ? "1 week" : "{count} weeks", { count: kindWeeks.length })}</span></h3></div>
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
      <button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setDraft(undefined); setAppliedJobIds([]); setError(""); setConfirm(null); }}>{t("Discard")}</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => { if (draft) void persist(draft); }}>{t(busy ? "Saving…" : "Save lineup")}</button>
    </div>}
    {error && <p className="form-error-box" role="alert">{error}</p>}
  </div>;
}
