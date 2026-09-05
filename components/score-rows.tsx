"use client";

import { MemberAvatar } from "./alliance-roster";
import type { Member } from "@/lib/types";
import type { snapshotComparison } from "@/lib/tracker";

type ScoreRow = ReturnType<typeof snapshotComparison>["rows"][number];
const fullScore = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const shortScore = (value: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function CommanderIdentity({ member, name, needsReview }: { member?: Member; name: string; needsReview?: boolean }) {
  return <span className="score-identity" title={member && name !== member.canonicalName ? `Captured as ${name}` : name}>
    <MemberAvatar member={member ?? { id: "unlinked", canonicalName: name, aliases: [], active: false }} />
    <span className="alliance-member-name">{member?.canonicalName ?? name}</span>
    {member?.gameProfile && <b className={`alliance-rank${member.gameProfile.rank === "R5" ? " leader" : ""}`}>{member.gameProfile.rank}</b>}
    {needsReview && <span className="score-review-marker" title="Captured name needs review" aria-label="Name needs review">!</span>}
  </span>;
}

function Movement({ value, rank = false }: { value?: number; rank?: boolean }) {
  if (value === undefined) return <span className="score-movement unavailable" title="No matching prior score">—</span>;
  return <span className={`score-movement ${value > 0 ? "positive" : value < 0 ? "negative" : "unchanged"}`} title={rank ? `${Math.abs(value)} rank places ${value >= 0 ? "up" : "down"}` : `${value > 0 ? "+" : ""}${fullScore(value)} points`}>
    {value > 0 ? "+" : ""}{rank ? value : shortScore(value)}{rank && <span className="score-places"> places</span>}
  </span>;
}

export function ScoreRows({ rows, members, onOpenMember, scroll = false }: {
  rows: ScoreRow[]; members: Member[]; onOpenMember: (id: string) => void; scroll?: boolean;
}) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  return <div className="score-rows">
    <div className="score-columns" aria-hidden="true"><span>Commander</span><span>Points</span><span>Score change</span><span>Rank move</span></div>
    <ol className={`score-list${scroll ? " scroll" : ""}`}>{rows.map((row) => {
      const member = memberById.get(row.memberId ?? "");
      const rowClass = `score-row${row.pointChange === undefined && row.rankChange === undefined ? " no-comparison" : ""}`;
      const content = <>
        <span className="score-commander"><span className="alliance-position">{row.rank}</span><CommanderIdentity member={member} name={row.displayName} needsReview={row.needsReview} /></span>
        <span className="score-value"><strong>{fullScore(row.points)}</strong>{row.pointChange !== undefined && <span className="score-mobile-change"><span className="sr-only">Score change: </span><Movement value={row.pointChange} /></span>}</span>
        <span className="score-desktop-change"><Movement value={row.pointChange} /></span>
        <span className={`score-rank-change${row.rankChange === undefined ? " no-comparison" : ""}`}><span className="score-mobile-label">Rank </span><Movement value={row.rankChange} rank /></span>
      </>;
      return <li key={row.id}>{member
        ? <button className={rowClass} onClick={() => onOpenMember(member.id)} aria-label={`View ${member.canonicalName}, rank ${row.rank}, ${fullScore(row.points)} points`}>{content}</button>
        : <div className={`${rowClass} unlinked`}>{content}</div>}
      </li>;
    })}</ol>
    {!rows.length && <div className="leaderboard-empty"><strong>No commanders found</strong><span>Try another name or filter.</span></div>}
  </div>;
}
