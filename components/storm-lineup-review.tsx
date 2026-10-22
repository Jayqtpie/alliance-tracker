"use client";

import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import type { BridgeJobView } from "@/lib/bridge-types";
import { statDisplay } from "@/lib/member-stats";
import { applyLineupImport, planLineupImport, type LineupImportRow, type LineupRowChoices, type LineupRowStatus } from "@/lib/storm-lineup-import";
import { STORM_TEAMS } from "@/lib/storms";
import type { Member, StormWeek } from "@/lib/types";
import { useLanguage } from "./language-selector";

const STATUS_LABELS: Record<Exclude<LineupRowStatus, "matched">, string> = {
  unmatched: "No match",
  duplicate: "Matched twice",
  skipped: "Left out",
};

/** One team's game list, read from screenshots: match every row to a member, then make it the team's lineup. */
export function StormLineupReview({ job, week, members, onApply, onDiscard }: {
  job: BridgeJobView; week: StormWeek; members: Member[]; onApply: (next: StormWeek) => void; onDiscard: () => void;
}) {
  const { t } = useLanguage();
  const team = job.storm!.team;
  const header = job.lineup ?? {};
  const [choices, setChoices] = useState<LineupRowChoices>({});
  const plan = planLineupImport(week, team, job.rows ?? [], members, header, choices);
  const byId = new Map(members.map((member) => [member.id, member]));
  const roster = [...members].sort((a, b) => Number(b.active) - Number(a.active) || a.canonicalName.localeCompare(b.canonicalName));
  const otherTeam = STORM_TEAMS.find((value) => value !== team)!;
  const unresolved = plan.rows.some((entry) => entry.status === "unmatched" || entry.status === "duplicate");

  function choose(rank: number, value: string) {
    setChoices((current) => ({ ...current, [rank]: value === "skip" ? null : value }));
  }

  function rowItem({ row, status, member, suggestion, suggestedBy, fromOtherTeam }: LineupImportRow) {
    const value = status === "skipped" ? "skip" : member?.id ?? "";
    return <li key={row.rank} data-status={status === "matched" ? "team" : status}>
      <span className="storm-import-rank">{row.rank}</span>
      <span className="storm-import-read"><strong>{row.displayName}</strong><small>{t("{power} hero power", { power: statDisplay(row.points) })}</small></span>
      <span className="storm-import-match">
        <select aria-label={t("Member for row {rank}", { rank: row.rank })} value={value} onChange={(event) => choose(row.rank, event.target.value)}>
          <option value="" disabled>{t("Choose a member…")}</option>
          {suggestion && <option value={suggestion.id}>{suggestedBy === "hero power"
            ? t("Similar hero power: {name}", { name: suggestion.canonicalName })
            : t("Suggested: {name}", { name: suggestion.canonicalName })}</option>}
          {roster.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.active ? candidate.canonicalName : t("{name} (left)", { name: candidate.canonicalName })}</option>)}
          <option value="skip">{t("Leave this row out")}</option>
        </select>
        {status === "matched"
          ? <span className="storm-flag" data-flag="team">{t(row.role === "starter" ? "Starter" : "Sub")}</span>
          : <span className="storm-flag" data-flag={status}>{t(STATUS_LABELS[status])}</span>}
        {fromOtherTeam && status === "matched" && <span className="storm-flag" data-flag="other-team">{t("Moves from team {team}", { team: otherTeam })}</span>}
        {member && !member.active && <span className="storm-flag" data-flag="left">{t("Left the alliance")}</span>}
        {row.needsReview && status !== "skipped" && <span className="storm-flag" data-flag="review">{t("Check this name")}</span>}
      </span>
    </li>;
  }

  return <div className="storm-import-review">
    <div className="storm-import-summary">
      <strong>{t("Team {team} in the game", { team })}</strong>
      <span>{t("{starters} starters and {subs} subs", { starters: plan.counts.starter, subs: plan.counts.sub })}{header.battleTime ? ` · ${header.battleTime}` : ""}</span>
    </div>
    {plan.problems.map((problem) => <p key={problem} className="form-error-box" role="alert">{t(problem)}</p>)}
    {plan.warnings.map((warning) => <p key={warning} className="storm-import-unconfirmed">{t(warning)}</p>)}
    <ol className="storm-import-rows">{plan.rows.map(rowItem)}</ol>
    {plan.leaving.length > 0 && <div className="storm-import-missed">
      <h5>{t("In team {team} here, but not in the game", { team })}</h5>
      <p>{t("Confirming takes them out of this week. Nobody is marked missed.")}</p>
      <ul>{plan.leaving.map((memberId) => <li key={memberId}><span>{byId.get(memberId)?.canonicalName ?? memberId}</span></li>)}</ul>
    </div>}
    {unresolved && <p className="form-error-box" role="alert">{t("Pick a member, or leave the row out, for every row marked No match or Matched twice.")}</p>}
    <div className="storm-import-actions">
      <button type="button" className="button ghost" onClick={onDiscard}><Trash2 size={14} />{t("Discard")}</button>
      <button type="button" className="button primary" disabled={plan.blocked} onClick={() => onApply(applyLineupImport(week, team, plan, header))}>
        <Check size={14} />{t("Confirm team {team} from the game", { team })}
      </button>
    </div>
  </div>;
}
