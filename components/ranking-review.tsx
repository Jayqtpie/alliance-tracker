"use client";

import { memo, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { Member } from "@/lib/types";
import { requiresHumanReview, type ReviewRow } from "@/lib/review";

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
  const [search, setSearch] = useState("");
  const choices = useMemo(() => options.filter((option) => option.id === member?.id || [option.canonicalName, ...option.aliases].some((name) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [options, member?.id, search]);
  return <tr className={requiresHumanReview(row) || blocker ? "needs-review" : ""}>
    <td data-label="Rank"><input aria-label={`Rank for row ${index + 1}`} className="tiny" type="number" min="1" value={row.rank} onChange={(event) => onUpdate(index, { rank: Number(event.target.value) })} /></td>
    <td data-label="Captured name"><input aria-label={`Commander for rank ${row.rank}`} maxLength={100} value={row.displayName} onChange={(event) => onUpdate(index, { displayName: event.target.value })} /></td>
    <td data-label="Points"><input aria-label={`Points for rank ${row.rank}`} className="points-input" inputMode="numeric" value={row.points} onChange={(event) => onUpdate(index, { points: Number(event.target.value.replace(/\D/g, "")) })} /></td>
    <td data-label="Roster player">
      <div className="review-identity-picker">
        <input type="search" aria-label={`Find player for rank ${row.rank}`} placeholder="Find a roster player…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={`Identity for rank ${row.rank}`} value={row.createMember ? "__new__" : member?.id || ""} onChange={(event) => onUpdate(index, { memberId: event.target.value && event.target.value !== "__new__" ? event.target.value : undefined, createMember: event.target.value === "__new__" })}>
          <option value="">Choose an identity…</option><option value="__new__">Confirm as a new member</option>
          {choices.map((option) => <option key={option.id} value={option.id}>{option.active ? "" : "[Departed] "}{option.canonicalName}</option>)}
        </select>
      </div>
      {member && !member.active && <label className="review-check"><input type="checkbox" aria-label={`Confirm returned for rank ${row.rank}`} checked={Boolean(row.confirmReturned)} onChange={(event) => onUpdate(index, { confirmReturned: event.target.checked })} />Confirm returned to the roster</label>}
      <label className={`review-check review-verify ${row.reviewed ? "is-verified" : ""}`}>
        <input type="checkbox" aria-label={`Verified rank ${row.rank}`} checked={Boolean(row.reviewed)} disabled={busy || Boolean(blocker)} onChange={(event) => onVerify(index, event.target.checked)} />
        {row.reviewed ? <><Check size={16} /> Verified</> : "Mark verified"}
      </label>
      {onVerifyNext && <button className="button secondary review-next" disabled={busy || Boolean(blocker)} onClick={onVerifyNext}>{row.reviewed ? "Next player" : "Verify & next"}<ChevronRight size={16} /></button>}
      {blocker ? <small className="review-row-note">{blocker}</small> : requiresHumanReview(row) && <small className="review-row-note">Check the captured name and score.</small>}
    </td>
    <td><button className="icon-button" aria-label={`Remove rank ${row.rank}`} title="Remove row" disabled={busy} onClick={() => onRemove(index)}><X size={16} /></button></td>
  </tr>;
});

export function RankingReview(props: Props) {
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
    <span>{filtered.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}` : "No matching rows"}</span>
    <div><button className="button secondary" aria-label="Previous review page" disabled={currentPage === 0} onClick={() => goToPage(currentPage - 1)}><ChevronLeft size={16} /> Previous</button><button className="button secondary" aria-label="Next review page" disabled={currentPage >= pages - 1} onClick={() => goToPage(currentPage + 1)}>Next <ChevronRight size={16} /></button></div>
  </div>;
  return <div ref={top} className="ranking-review">
    <div className="review-toolbar">
      <label className="review-search"><Search size={17} /><input aria-label="Search review rows" type="search" placeholder="Find a name or rank" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      <div className="review-filters" aria-label="Filter review rows">{[["all", `All ${rows.length}`], ["pending", `Needs review ${pending}`], ["unmatched", `Unmatched ${identities.filter((member) => !member).length}`]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{label}</button>)}</div>
    </div>
    {navigation}
    <div className="table-scroll"><table className="review-table"><thead><tr><th>Rank</th><th>Captured name</th><th>Points</th><th>Roster player &amp; verification</th><th /></tr></thead><tbody>
      {visible.map(({ row, index }) => <RankingReviewRow key={row.id ?? index} row={row} index={index} member={identities[index]} blocker={blockers[index]} options={options} busy={props.busy} onUpdate={props.onUpdate} onVerify={props.onVerify} onRemove={props.onRemove} onVerifyNext={mobile ? () => { props.onVerify(index, true); goToPage(filter === "pending" ? currentPage : Math.min(currentPage + 1, pages - 1)); } : undefined} />)}
    </tbody></table></div>
    {!visible.length && <p className="review-empty">{rows.length ? filter === "pending" && !query.trim() ? "No rows need review. Confident matches are ready to publish." : "No rows match this view." : "Upload a capture to start reviewing."}</p>}
    {navigation}
  </div>;
}
