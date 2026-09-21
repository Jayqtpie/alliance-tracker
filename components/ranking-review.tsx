"use client";

import { memo, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { Member } from "@/lib/types";
import { requiresHumanReview, type ReviewRow } from "@/lib/review";
import { useLanguage } from "./language-selector";

const mobileQuery = "(max-width: 760px)";
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
type Props = {
  rows: ReviewRow[];
  members: Member[];
  identities: (Member | undefined)[];
  blockers: (string | undefined)[];
  busy: boolean;
  onUpdate: (index: number, patch: Partial<ReviewRow>) => void;
  onVerify: (index: number, checked: boolean) => void;
  onRemove: (index: number) => void;
};

const RankingReviewRow = memo(function RankingReviewRow({ row, index, member, blocker, options, busy, onUpdate, onVerify, onRemove, onVerifyNext }: {
  row: ReviewRow; index: number; member?: Member; blocker?: string; options: Member[]; onVerifyNext?: () => void;
} & Pick<Props, "busy" | "onUpdate" | "onVerify" | "onRemove">) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const choices = useMemo(() => options.filter((option) => option.id === member?.id || [option.canonicalName, ...option.aliases].some((name) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [options, member?.id, search]);
  return <tr className={requiresHumanReview(row) || blocker ? "needs-review" : ""}>
    <td data-label={t("Rank")}><input aria-label={t("Rank for row {row}", { row: index + 1 })} className="tiny" type="number" min="1" value={row.rank} onChange={(event) => onUpdate(index, { rank: Number(event.target.value) })} /></td>
    <td data-label={t("Captured name")}><input aria-label={t("Commander for rank {rank}", { rank: row.rank })} maxLength={100} value={row.displayName} onChange={(event) => onUpdate(index, { displayName: event.target.value })} /></td>
    <td data-label={t("Points")}><input aria-label={t("Points for rank {rank}", { rank: row.rank })} className="points-input" inputMode="numeric" value={row.points} onChange={(event) => onUpdate(index, { points: Number(event.target.value.replace(/\D/g, "")) })} /></td>
    <td data-label={t("Roster player")}>
      <div className="review-identity-picker">
        <input type="search" aria-label={t("Find player for rank {rank}", { rank: row.rank })} placeholder={t("Find a roster player…")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={t("Identity for rank {rank}", { rank: row.rank })} value={row.createMember ? "__new__" : member?.id || ""} onChange={(event) => onUpdate(index, { memberId: event.target.value && event.target.value !== "__new__" ? event.target.value : undefined, createMember: event.target.value === "__new__" })}>
          <option value="">{t("Choose an identity…")}</option><option value="__new__">{t("Confirm as a new member")}</option>
          {choices.map((option) => <option key={option.id} value={option.id}>{option.active ? "" : `[${t("Departed")}] `}{option.canonicalName}</option>)}
        </select>
      </div>
      {member && !member.active && <label className="review-check"><input type="checkbox" aria-label={t("Confirm returned for rank {rank}", { rank: row.rank })} checked={Boolean(row.confirmReturned)} onChange={(event) => onUpdate(index, { confirmReturned: event.target.checked })} />{t("Confirm returned to the roster")}</label>}
      <label className={`review-check review-verify ${row.reviewed ? "is-verified" : ""}`}>
        <input type="checkbox" aria-label={t("Verified rank {rank}", { rank: row.rank })} checked={Boolean(row.reviewed)} disabled={busy || Boolean(blocker)} onChange={(event) => onVerify(index, event.target.checked)} />
        {row.reviewed ? <><Check size={16} /> {t("Verified")}</> : t("Mark verified")}
      </label>
      {onVerifyNext && <button className="button secondary review-next" disabled={busy || Boolean(blocker)} onClick={onVerifyNext}>{t(row.reviewed ? "Next player" : "Verify & next")}<ChevronRight size={16} /></button>}
      {blocker ? <small className="review-row-note">{t(blocker)}</small> : requiresHumanReview(row) && <small className="review-row-note">{t("Check the captured name and score.")}</small>}
    </td>
    <td><button className="icon-button" aria-label={t("Remove rank {rank}", { rank: row.rank })} title={t("Remove row")} disabled={busy} onClick={() => onRemove(index)}><X size={16} /></button></td>
  </tr>;
});

export function RankingReview(props: Props) {
  const { t } = useLanguage();
  const { rows, members, identities, blockers } = props;
  const mobile = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(mobileQuery).matches, () => false);
  const pageSize = mobile ? 1 : 8;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("pending");
  const [page, setPage] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const options = useMemo(() => [...members].sort((a, b) => Number(b.active) - Number(a.active) || a.canonicalName.localeCompare(b.canonicalName)), [members]);
  const pending = rows.filter((row, index) => requiresHumanReview(row) || blockers[index]).length;
  const filtered = rows.map((row, index) => ({ row, index })).filter(({ row, index }) => {
    if (filter === "pending" && !requiresHumanReview(row) && !blockers[index]) return false;
    if (filter === "unmatched" && identities[index]) return false;
    const text = `${row.rank} ${row.displayName} ${identities[index]?.canonicalName || ""}`.toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase());
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function goToPage(next: number) {
    setPage(next);
    top.current?.scrollIntoView({ block: "start" });
  }
  const navigation = <div className="review-pagination">
    <span>{filtered.length ? t("{start}–{end} of {count}", { start: currentPage * pageSize + 1, end: Math.min((currentPage + 1) * pageSize, filtered.length), count: filtered.length }) : t("No matching rows")}</span>
    <div><button className="button secondary" aria-label={t("Previous review page")} disabled={currentPage === 0} onClick={() => goToPage(currentPage - 1)}><ChevronLeft size={16} /> {t("Previous")}</button><button className="button secondary" aria-label={t("Next review page")} disabled={currentPage >= pages - 1} onClick={() => goToPage(currentPage + 1)}>{t("Next")} <ChevronRight size={16} /></button></div>
  </div>;
  return <div ref={top} className="ranking-review">
    <div className="review-toolbar">
      <label className="review-search"><Search size={17} /><input aria-label={t("Search review rows")} type="search" placeholder={t("Find a name or rank")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      <div className="review-filters" aria-label={t("Filter review rows")}>{[["all", t("All {count}", { count: rows.length })], ["pending", t("Needs review {count}", { count: pending })], ["unmatched", t("Unmatched {count}", { count: identities.filter((member) => !member).length })]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{label}</button>)}</div>
    </div>
    {navigation}
    <div className="table-scroll"><table className="review-table"><thead><tr><th>{t("Rank")}</th><th>{t("Captured name")}</th><th>{t("Points")}</th><th>{t("Roster player & verification")}</th><th /></tr></thead><tbody>
      {visible.map(({ row, index }) => <RankingReviewRow key={row.id ?? index} row={row} index={index} member={identities[index]} blocker={blockers[index]} options={options} busy={props.busy} onUpdate={props.onUpdate} onVerify={props.onVerify} onRemove={props.onRemove} onVerifyNext={mobile ? () => { props.onVerify(index, true); goToPage(filter === "pending" ? currentPage : Math.min(currentPage + 1, pages - 1)); } : undefined} />)}
    </tbody></table></div>
    {!visible.length && <p className="review-empty">{t(rows.length ? filter === "pending" && !query.trim() ? "No rows need review. Confident matches are ready to publish." : "No rows match this view." : "Upload a capture to start reviewing.")}</p>}
    {navigation}
  </div>;
}
