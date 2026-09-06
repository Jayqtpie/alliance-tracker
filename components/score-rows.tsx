"use client";

import { MemberAvatar } from "./alliance-roster";
import { MemberName } from "./member-name";
import { useLanguage } from "./language-selector";
import { languageDirection } from "@/lib/i18n";
import type { Member } from "@/lib/types";
import type { snapshotComparison } from "@/lib/tracker";

import { requiresHumanReview } from "@/lib/review";

type ScoreRow = ReturnType<typeof snapshotComparison>["rows"][number];
const fullScore = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const shortScore = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function CommanderIdentity({ member, name, needsReview, showRank = true }: { member?: Member; name: string; needsReview?: boolean; showRank?: boolean }) {
  const { t } = useLanguage();
  return <span className="score-identity" title={member && name !== member.canonicalName ? t("Captured as {name}", { name }) : name}>
    <MemberAvatar member={member ?? { id: "unlinked", canonicalName: name, aliases: [], active: false }} />
    <MemberName member={member} name={name} />
    {showRank && member?.gameProfile && <b className="alliance-rank" data-rank={member.gameProfile.rank}>{member.gameProfile.rank}</b>}
    {needsReview && <span className="score-review-marker" title={t("Captured name needs review")} aria-label={t("Name needs review")}>!</span>}
  </span>;
}

function Movement({ value, rank = false }: { value?: number; rank?: boolean }) {
  const { t } = useLanguage();
  if (value === undefined) return <span className="score-movement unavailable" title={t("No matching prior score")}>—</span>;
  return <span className={`score-movement ${value > 0 ? "positive" : value < 0 ? "negative" : "unchanged"}`} title={rank ? value === 0 ? t("No rank change") : t(value > 0 ? "{count} rank places up" : "{count} rank places down", { count: Math.abs(value) }) : t("{value} points", { value: `${value > 0 ? "+" : ""}${fullScore(value)}` })}>
    {value > 0 ? "+" : ""}{rank ? value : shortScore(value)}{rank && <span className="score-places"> {t("places")}</span>}
  </span>;
}

export function ScoreRows({ rows, members, onOpenMember, scroll = false }: {
  rows: ScoreRow[]; members: Member[]; onOpenMember: (id: string) => void; scroll?: boolean;
}) {
  const { language, t } = useLanguage();
  const memberById = new Map(members.map((member) => [member.id, member]));
  return <div className={`score-rows${scroll ? " full-capture" : ""}`} lang={language} dir={languageDirection(language)}>
    <div className="score-columns" aria-hidden="true"><span>{t("Commander")}</span><span>{t("Rank")}</span><span>{t("Points")}</span><span>{t("Score change")}</span><span>{t("Rank move")}</span></div>
    <ol className={`score-list${scroll ? " scroll" : ""}`}>{rows.map((row) => {
      const member = memberById.get(row.memberId ?? "");
      const rowClass = `score-row${row.pointChange === undefined && row.rankChange === undefined ? " no-comparison" : ""}`;
      const content = <>
        <span className="score-commander"><span className={`alliance-position${row.rank <= 3 ? ` podium-rank podium-${row.rank}` : ""}`} title={row.rank <= 3 ? t(["Gold · first place", "Silver · second place", "Bronze · third place"][row.rank - 1]) : undefined}>{row.rank}</span><CommanderIdentity member={member} name={row.displayName} needsReview={requiresHumanReview(row)} showRank={false} /></span>
        <span className="member-rank-cell">{member?.gameProfile && <b className="alliance-rank" data-rank={member.gameProfile.rank}>{member.gameProfile.rank}</b>}</span>
        <span className="score-value"><strong>{fullScore(row.points)}</strong>{row.pointChange !== undefined && <span className="score-mobile-change"><span className="sr-only">{t("Score change")}: </span><Movement value={row.pointChange} /></span>}</span>
        <span className="score-desktop-change"><Movement value={row.pointChange} /></span>
        <span className={`score-rank-change${row.rankChange === undefined ? " no-comparison" : ""}`}><span className="score-mobile-label">{t("Rank")} </span><Movement value={row.rankChange} rank /></span>
      </>;
      return <li key={row.id}>{member
        ? <button className={rowClass} data-rank={member.gameProfile?.rank} onClick={() => onOpenMember(member.id)} aria-label={t("View {name}, rank {rank}, {points} points", { name: member.canonicalName, rank: row.rank, points: fullScore(row.points) })}>{content}</button>
        : <div className={`${rowClass} unlinked`}>{content}</div>}
      </li>;
    })}</ol>
    {!rows.length && <div className="leaderboard-empty"><strong>{t("No commanders found")}</strong><span>{t("Try another name or filter.")}</span></div>}
  </div>;
}
