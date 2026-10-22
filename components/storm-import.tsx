"use client";

import { Check, Cloud, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BridgeJobKind, BridgeJobView } from "@/lib/bridge-types";
import { uploadBridgeFrames } from "@/lib/bridge-upload";
import { applyStormImport, planStormImport, rebuildTeamFromResults, type StormImportRow, type StormRowChoices, type StormRowStatus } from "@/lib/storm-import";
import { STORM_TEAMS } from "@/lib/storms";
import type { Member, StormTeam, StormWeek } from "@/lib/types";
import { useLanguage } from "./language-selector";
import { StormLineupReview } from "./storm-lineup-review";

const STATUS_LABELS: Record<StormRowStatus, string> = {
  team: "Played",
  "other-team": "On team {team}",
  "not-in-lineup": "Not in lineup",
  unmatched: "No match",
  duplicate: "Matched twice",
  skipped: "Left out",
};

type StormImportKind = Extract<BridgeJobKind, "storm" | "storm-lineup">;

/** What each import says. The lineup import confirms a team against the game; the results import records who played. */
const COPY: Record<StormImportKind, { title: string; help: string; files: string; applied: string }> = {
  "storm-lineup": {
    title: "Confirm a team from the game",
    help: "Before the battle, upload one Task Force's \"View Participants\" screenshots, scrolled from top to bottom. The team here becomes exactly the game's list, and only a confirmed team has starters marked missed by its results.",
    files: "Lineup screenshots",
    applied: "Team {team} confirmed from the game. Save the lineup to keep it.",
  },
  storm: {
    title: "Import results from screenshots",
    help: "Upload one team's \"Battle Results!\" mail. Everyone listed played; if the team's lineup is confirmed against the game, its starters who aren't listed are marked missed.",
    files: "Results screenshots",
    applied: "Team {team} results applied. Save the lineup to keep them.",
  },
};

/** This week's storm imports of one kind. The job list is the newest ten of every kind. */
async function weekJobs(weekId: string, kind: StormImportKind) {
  const response = await fetch("/api/bridge/jobs");
  if (!response.ok) throw new Error(`Job list failed (${response.status}).`);
  const body = await response.json() as { jobs: BridgeJobView[] };
  return body.jobs.filter((job) => job.kind === kind && job.storm?.weekId === weekId);
}

/** Officers' screenshot import for one week: upload a team's screens, review the read, apply it to the draft. */
export function StormImport({ kind, week, members, appliedJobIds, refreshKey, onApply }: {
  kind: StormImportKind;
  week: StormWeek;
  members: Member[];
  /** Jobs already applied to the unsaved draft: they wait for the save, which deletes them. */
  appliedJobIds: string[];
  /** Changes when the saved state does, so deleted jobs drop out of the list. */
  refreshKey: number;
  onApply: (jobId: string, next: StormWeek) => void;
}) {
  const { t } = useLanguage();
  const [jobs, setJobs] = useState<BridgeJobView[]>([]);
  const [team, setTeam] = useState<StormTeam>("A");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number>();
  const [dispatchError, setDispatchError] = useState("");
  const [error, setError] = useState("");

  // Not keyed on t: useLanguage hands out a new one every render, which would refetch on every render.
  useEffect(() => {
    let active = true;
    weekJobs(week.id, kind)
      .then((found) => { if (active) setJobs(found); })
      .catch(() => { if (active) setError("Could not load the screenshot imports."); });
    return () => { active = false; };
  }, [week.id, kind, refreshKey]);

  const reading = jobs.some((job) => job.status === "pending" || job.status === "processing");
  useEffect(() => {
    if (!reading) return;
    const timer = window.setInterval(() => { weekJobs(week.id, kind).then(setJobs).catch(() => {}); }, 10_000);
    return () => window.clearInterval(timer);
  }, [reading, week.id, kind]);

  async function queue() {
    if (!files.length) return;
    setProgress(0); setError(""); setDispatchError("");
    try {
      const jobId = crypto.randomUUID();
      const uploaded = await uploadBridgeFrames(jobId, files, setProgress);
      const response = await fetch("/api/bridge/jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: jobId, files: uploaded, kind, storm: { weekId: week.id, team } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Could not create the extraction job."));
      setJobs((current) => [body.job as BridgeJobView, ...current]);
      setDispatchError(body.dispatchError ?? "");
      setFiles([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not queue these screenshots."));
    } finally {
      setProgress(undefined);
    }
  }

  async function retry(job: BridgeJobView) {
    setError(""); setDispatchError("");
    const response = await fetch("/api/bridge/jobs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || t("Could not retry this extraction.")); return; }
    setJobs((current) => current.map((item) => item.id === job.id ? body.job as BridgeJobView : item));
    setDispatchError(body.dispatchError ?? "");
  }

  async function discard(job: BridgeJobView) {
    setError("");
    const response = await fetch(`/api/bridge/jobs?id=${encodeURIComponent(job.id)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && body.error !== "Bridge job not found.") { setError(body.error || t("Could not discard this upload.")); return; }
    setJobs((current) => current.filter((item) => item.id !== job.id));
  }

  const copy = COPY[kind];
  return <section className="storm-import" aria-label={t(copy.title)}>
    <h4>{t(copy.title)}</h4>
    <p className="storm-import-help">{t(copy.help)}</p>
    <form className="storm-import-form" onSubmit={(event) => { event.preventDefault(); void queue(); }}>
      <select aria-label={t("Team")} value={team} onChange={(event) => setTeam(event.target.value as StormTeam)}>
        {STORM_TEAMS.map((value) => <option key={value} value={value}>{t("Team {team}", { team: value })}</option>)}
      </select>
      <input type="file" aria-label={t(copy.files)} multiple accept="image/png,image/jpeg,image/webp"
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      <button type="submit" className="button secondary" disabled={!files.length || progress !== undefined}>
        {progress !== undefined ? t("Uploading… {percent}%", { percent: progress }) : <><Cloud size={14} />{t("Read with Claude")}</>}
      </button>
    </form>
    {dispatchError && <p className="form-error-box" role="alert">{dispatchError}</p>}
    {error && <p className="form-error-box" role="alert">{t(error)}</p>}

    {jobs.map((job) => {
      const jobTeam = job.storm!.team;
      if (appliedJobIds.includes(job.id)) {
        return <p key={job.id} className="storm-import-status" data-state="applied"><Check size={14} aria-hidden="true" />{t(copy.applied, { team: jobTeam })}</p>;
      }
      if (job.status === "completed") {
        return kind === "storm-lineup"
          ? <StormLineupReview key={job.id} job={job} week={week} members={members} onApply={(next) => onApply(job.id, next)} onDiscard={() => void discard(job)} />
          : <StormImportReview key={job.id} job={job} week={week} members={members} onApply={(next) => onApply(job.id, next)} onDiscard={() => void discard(job)} />;
      }
      return <div key={job.id} className="storm-import-status" data-state={job.status}>
        {job.status === "failed"
          ? <span>{t("Team {team}: reading the screenshots failed.", { team: jobTeam })}</span>
          : <span><LoaderCircle size={14} className="spin" aria-hidden="true" />{t("Team {team}: reading {count} screenshots. This takes a few minutes.", { team: jobTeam, count: job.fileCount })}</span>}
        {(job.status === "failed" || (job.status === "pending" && dispatchError)) && <button type="button" className="button ghost" onClick={() => void retry(job)}><RotateCcw size={14} />{t("Retry")}</button>}
        {job.status !== "processing" && <button type="button" className="button ghost" onClick={() => void discard(job)}><Trash2 size={14} />{t("Discard")}</button>}
      </div>;
    })}
  </section>;
}

export function StormImportReview({ job, week, members, onApply, onDiscard }: {
  job: BridgeJobView; week: StormWeek; members: Member[]; onApply: (next: StormWeek) => void; onDiscard: () => void;
}) {
  const { t } = useLanguage();
  const team = job.storm!.team;
  const [choices, setChoices] = useState<StormRowChoices>({});
  const [add, setAdd] = useState<Set<string>>(() => new Set());
  const [remove, setRemove] = useState<Set<string>>(() => new Set());
  // For a week whose lineup here wasn't the one played: the team becomes the results instead.
  const [rebuild, setRebuild] = useState(false);
  const plan = planStormImport(week, team, job.rows ?? [], members, choices);
  // Worked out on every change, so Apply is only offered when everyone ticked has a seat.
  const preview = plan.blocked ? undefined : rebuild ? rebuildTeamFromResults(week, team, plan) : applyStormImport(week, team, plan, add, remove);
  const unplaced = preview?.unplaced ?? [];
  const byId = new Map(members.map((member) => [member.id, member]));
  const roster = [...members].sort((a, b) => Number(b.active) - Number(a.active) || a.canonicalName.localeCompare(b.canonicalName));
  const names = (ids: string[]) => ids.map((id) => byId.get(id)?.canonicalName ?? id).join(", ");
  const otherTeam = STORM_TEAMS.find((value) => value !== team)!;
  const outsiders = plan.rows.filter((entry) => entry.status === "other-team" || entry.status === "not-in-lineup");
  const adding = outsiders.filter((entry) => add.has(entry.member!.id)).length;
  // Most of the mail outside the lineup means the lineup here was probably not the one played.
  const suggestRebuild = outsiders.length > plan.played.length;
  const seated = (role: "starter" | "sub") => preview?.week.slots.filter((slot) => slot.team === team && slot.role === role).length ?? 0;

  function choose(rank: number, value: string) {
    setChoices((current) => ({ ...current, [rank]: value === "skip" ? null : value }));
  }

  const toggle = (set: typeof setAdd, memberId: string) => set((current) => {
    const next = new Set(current);
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
    return next;
  });

  function apply() {
    if (preview && !preview.unplaced.length) onApply(preview.week);
  }

  function rowItem({ row, status, member, suggestion }: StormImportRow) {
    const value = status === "skipped" ? "skip" : member?.id ?? "";
    const outside = !rebuild && (status === "other-team" || status === "not-in-lineup") && member;
    // A rebuild seats everyone matched, so where the lineup had them no longer matters.
    const shown: StormRowStatus = rebuild && (status === "other-team" || status === "not-in-lineup") ? "team" : status;
    return <li key={row.rank} data-status={shown}>
      <span className="storm-import-rank">{row.rank}</span>
      <span className="storm-import-read"><strong>{row.displayName}</strong><small>{row.points.toLocaleString()}</small></span>
      <span className="storm-import-match">
        <select aria-label={t("Member for rank {rank}", { rank: row.rank })} value={value} onChange={(event) => choose(row.rank, event.target.value)}>
          <option value="" disabled>{t("Choose a member…")}</option>
          {suggestion && <option value={suggestion.id}>{t("Suggested: {name}", { name: suggestion.canonicalName })}</option>}
          {roster.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.active ? candidate.canonicalName : t("{name} (left)", { name: candidate.canonicalName })}</option>)}
          <option value="skip">{t("Leave this row out")}</option>
        </select>
        <span className="storm-flag" data-flag={shown}>{t(STATUS_LABELS[shown], { team: otherTeam })}</span>
        {member && !member.active && <span className="storm-flag" data-flag="left">{t("Left the alliance")}</span>}
        {outside && <label className="storm-import-add"><input type="checkbox" checked={add.has(member.id)} onChange={() => toggle(setAdd, member.id)} />{t("Add to team {team} as played", { team })}</label>}
      </span>
    </li>;
  }

  return <div className="storm-import-review">
    <div className="storm-import-summary">
      <strong>{t("Team {team} results", { team })}</strong>
      <span>{rebuild
        ? t("{rows} in the results · {starters} starters and {subs} subs, all played · nobody missed", { rows: plan.rows.length, starters: seated("starter"), subs: seated("sub") })
        : plan.confirmed
          ? t("{rows} in the results · {played} played · {missed} starters missed", { rows: plan.rows.length, played: plan.played.length + adding, missed: plan.missed.filter((memberId) => !remove.has(memberId)).length })
          : t("{rows} in the results · {played} played · nobody marked missed", { rows: plan.rows.length, played: plan.played.length + adding })}</span>
    </div>
    {!rebuild && !plan.confirmed && <p className="storm-import-unconfirmed">{t("Team {team}'s lineup isn't confirmed against the game, so starters who aren't listed stay unrecorded instead of being marked missed. Confirm the lineup from the game first to record who missed.", { team })}</p>}
    <label className="storm-import-rebuild" data-suggested={suggestRebuild && !rebuild ? "" : undefined}>
      <input type="checkbox" checked={rebuild} onChange={(event) => setRebuild(event.target.checked)} />
      <span><strong>{t("Rebuild team {team} from these results", { team })}</strong>
        <small>{t(suggestRebuild
          ? "Most of these players aren't in team {team}'s lineup here. If this lineup wasn't the one played, rebuild it: everyone listed plays, the top 20 by points start, the team's other members go back to the bench, and nobody is marked missed."
          : "For a week whose lineup here wasn't the one played: everyone listed plays, the top 20 by points start, the team's other members go back to the bench, and nobody is marked missed.", { team })}</small></span>
    </label>
    <ol className="storm-import-rows">{plan.rows.map(rowItem)}</ol>
    {!rebuild && plan.missed.length > 0 && <div className="storm-import-missed">
      <h5>{t("Team {team} starters not in the results", { team })}</h5>
      <p>{t("They are marked missed and parked next week. Tick anyone who was never in the game's lineup: they leave this week instead, and free their seat.")}</p>
      <ul>{plan.missed.map((memberId) => <li key={memberId}>
        <span>{byId.get(memberId)?.canonicalName ?? memberId}</span>
        <label className="storm-import-add"><input type="checkbox" checked={remove.has(memberId)} onChange={() => toggle(setRemove, memberId)} />{t("Not in the game lineup")}</label>
      </li>)}</ul>
    </div>}
    {plan.blocked && <p className="form-error-box" role="alert">{t("Pick a member, or leave the row out, for every row marked No match or Matched twice.")}</p>}
    {unplaced.length > 0 && <p className="form-error-box" role="alert">{rebuild
      ? t("A team has 30 seats. Leave out a row to make room for: {names}.", { names: names(unplaced) })
      : t("No free seat in team {team} for: {names}. Tick a starter who was never in the game lineup, or remove someone from the team.", { team, names: names(unplaced) })}</p>}
    <div className="storm-import-actions">
      <button type="button" className="button ghost" onClick={onDiscard}><Trash2 size={14} />{t("Discard")}</button>
      <button type="button" className="button primary" disabled={!preview || unplaced.length > 0} onClick={apply}><Check size={14} />{t("Apply to lineup")}</button>
    </div>
  </div>;
}
