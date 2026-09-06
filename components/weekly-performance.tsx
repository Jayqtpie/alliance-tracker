"use client";

import { ArrowDownRight, Award, Trophy } from "lucide-react";
import { useId } from "react";
import { CommanderIdentity } from "./score-rows";
import { weeklyPerformance } from "@/lib/weekly-performance";
import type { Snapshot, TrackerState } from "@/lib/types";

const score = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const identity = (text: string) => text;

export function WeeklyPerformance({ state, selected, onOpenMember, translate = identity, section = "all" }: {
  state: TrackerState;
  selected: Snapshot;
  onOpenMember: (id: string) => void;
  translate?: (text: string) => string;
  section?: "all" | "spotlight" | "cards";
}) {
  const descriptionId = useId();
  const t = translate;
  const performance = weeklyPerformance(state, selected);
  const { winner, previous, leaders, declines } = performance;
  const live = selected.status === "live";
  const improvementEmpty = live
    ? t("A final capture is needed before comparing completed weeks.")
    : !previous ? t("Import a previous final week to compare performance.")
      : !performance.comparedCount ? t("No verified members appear in both final captures.")
        : t("No point declines among members with comparable final scores.");

  return <section className="weekly-performance-grid" aria-label={t(section === "spotlight" ? "WEEKLY SPOTLIGHT" : "Weekly performance")}>
    {section !== "cards" && <article className="panel performer-spotlight" aria-describedby={descriptionId}>
      <span className="performance-icon spotlight-icon"><Trophy size={22} aria-hidden="true" /></span>
      <div className="spotlight-person">
        <h3>{t("Top performer of the week")}</h3>
        {winner ? <button type="button" className="performer-profile" onClick={() => onOpenMember(winner.member.id)} aria-label={`${t("View profile")}: ${winner.member.canonicalName}`}>
          <CommanderIdentity member={winner.member} name={winner.entry.displayName} />
        </button> : <p className="spotlight-pending">{t("Awaiting verified scores")}</p>}
      </div>
      <div className="spotlight-summary" title={`${t("Week of")} ${selected.weekStart}`}>
        <span>{t(winner ? live ? "Provisional" : "Weekly scores" : "Needs review")}</span>
        <strong>{winner ? score(winner.entry.points) : "—"}</strong>
      </div>
      <p id={descriptionId} className="sr-only">{t("Week of")} {selected.weekStart}. {winner ? performance.tiedLeaders > 1 ? t("Joint highest verified score in this capture.") : t("Highest verified score among active members in this capture.") : t("Verified scores from linked, active members will appear here.")}</p>
    </article>}

    {section !== "spotlight" && <div className="performance-cards-grid">
    <article className="panel performance-card top-performers">
      <div className="performance-card-heading"><span className="performance-icon"><Award size={20} aria-hidden="true" /></span><span className="performance-status">{t(live ? "Live scores" : "Weekly scores")}</span></div>
      <h3>{t("Top performers")}</h3>
      <p className="performance-basis">{t("Highest points in the selected capture")}</p>
      {leaders.length ? <ol className="performance-list">{leaders.slice(0, 3).map((row, index) => <li key={row.member.id}>
        <button type="button" className="performance-row" onClick={() => onOpenMember(row.member.id)} aria-label={`${t("View profile")}: ${row.member.canonicalName}`}>
          <span className="performance-position">{index + 1}</span>
          <CommanderIdentity member={row.member} name={row.entry.displayName} />
          <span className="performance-value"><strong>{score(row.entry.points)}</strong><small>{t("points")}</small></span>
        </button>
      </li>)}</ol> : <p className="performance-empty">{t("No verified active-member scores in this capture yet.")}</p>}
      <p className="performance-footnote">{t("Unlinked, inactive and unresolved review entries are excluded.")}</p>
    </article>

    <article className="panel performance-card needs-improvement">
      <div className="performance-card-heading"><span className="performance-icon"><ArrowDownRight size={20} aria-hidden="true" /></span><span className="performance-status">{t("Final-week comparison")}</span></div>
      <h3>{t("Needs improvement")}</h3>
      <p className="performance-basis">{previous ? `${t("Compared with final week of")} ${previous.weekStart}` : t("Based on comparable completed weeks")}</p>
      {declines.length ? <ol className="performance-list">{declines.slice(0, 3).map((row) => <li key={row.member.id}>
        <button type="button" className="performance-row" onClick={() => onOpenMember(row.member.id)} aria-label={`${t("View profile")}: ${row.member.canonicalName}`}>
          <CommanderIdentity member={row.member} name={row.entry.displayName} />
          <span className="performance-value negative"><strong>{score(row.pointChange!)}</strong><small>{t("points")}{row.percentChange !== undefined ? ` · ${row.percentChange.toFixed(1)}%` : ""}</small></span>
        </button>
      </li>)}</ol> : <p className="performance-empty">{improvementEmpty}</p>}
      <p className="performance-footnote">{t("Largest point declines. Missing scores are never treated as zero.")}</p>
    </article>
    </div>}
  </section>;
}
