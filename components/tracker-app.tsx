"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Cloud,
  Download,
  FileImage,
  History,
  LayoutDashboard,
  LogOut,
  PencilLine,
  Search,
  Shield,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExtractedRow, Member, RankingEntry, Snapshot, TrackerState } from "@/lib/types";
import { dedupeRows, snapshotComparison } from "@/lib/tracker";

type View = "overview" | "import" | "snapshots" | "members";

function compact(value: number) {
  const units = [
    { threshold: 1_000_000_000, suffix: "bn" },
    { threshold: 1_000_000, suffix: "m" },
    { threshold: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => Math.abs(value) >= item.threshold);
  if (!unit) return String(Math.round(value));
  return `${(value / unit.threshold).toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
}

function full(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function signed(value?: number, suffix = "") {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function statusTone(value?: number) {
  if (!value) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function exportSnapshot(snapshot: Snapshot) {
  const lines = ["rank,commander,points"];
  snapshot.entries.forEach((entry) => {
    const safe = `"${entry.displayName.replaceAll('"', '""')}"`;
    lines.push(`${entry.rank},${safe},${entry.points}`);
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rscl-${snapshot.capturedAt.slice(0, 10)}-${snapshot.status}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TrackerApp({
  initialState,
  storageMode,
  ocrConfigured,
}: {
  initialState: TrackerState;
  storageMode: string;
  ocrConfigured: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [view, setView] = useState<View>("overview");
  const [editingSnapshot, setEditingSnapshot] = useState<Snapshot>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(
    [...initialState.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]?.id || "",
  );
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const selected = state.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) || state.snapshots[0];
  const comparison = useMemo(
    () => (selected ? snapshotComparison(selected, state.snapshots) : undefined),
    [selected, state.snapshots],
  );

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const nav = [
    ["overview", "Overview", LayoutDashboard],
    ["import", "New import", UploadCloud],
    ["snapshots", "Snapshots", History],
    ["members", "Roster", Users],
  ] as const;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark small">R</div>
          <div><strong>Rascals Command</strong><span>RSCL · Server 927</span></div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => { if (id === "import") setEditingSnapshot(undefined); setView(id); }}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`system-chip ${storageMode === "vercel-blob" ? "online" : "local"}`}>
            <Cloud size={14} /> {storageMode === "vercel-blob" ? "Shared data online" : "Local preview data"}
          </div>
          <button className="nav-item" onClick={logout}><LogOut size={18} /> Sign out</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">ALLIANCE PERFORMANCE</p>
            <h1>{view === "overview" ? "Command overview" : nav.find(([id]) => id === view)?.[1]}</h1>
          </div>
          <div className="topbar-meta"><span className="live-dot" /> Transfer period active</div>
        </header>

        {view === "overview" && selected && comparison && (
          <Overview
            state={state}
            selected={selected}
            setSelected={setSelectedSnapshotId}
            comparison={comparison}
            query={query}
            setQuery={setQuery}
          />
        )}
        {view === "import" && (
          <Importer
            state={state}
            setState={setState}
            ocrConfigured={ocrConfigured}
            editingSnapshot={editingSnapshot}
            onPublished={(snapshot) => {
              setEditingSnapshot(undefined);
              setSelectedSnapshotId(snapshot.id);
              setView("overview");
              showNotice("Snapshot published successfully.");
            }}
          />
        )}
        {view === "snapshots" && (
          <Snapshots
            snapshots={state.snapshots}
            onOpen={(snapshot) => { setSelectedSnapshotId(snapshot.id); setView("overview"); }}
            onEdit={(snapshot) => {
              setEditingSnapshot(snapshot);
              setView("import");
            }}
          />
        )}
        {view === "members" && <Roster state={state} setState={setState} notify={showNotice} />}
      </main>
      {notice && <div className="toast"><Check size={17} /> {notice}</div>}
    </div>
  );
}

function Overview({
  state,
  selected,
  setSelected,
  comparison,
  query,
  setQuery,
}: {
  state: TrackerState;
  selected: Snapshot;
  setSelected: (id: string) => void;
  comparison: ReturnType<typeof snapshotComparison>;
  query: string;
  setQuery: (query: string) => void;
}) {
  const total = selected.entries.reduce((sum, entry) => sum + entry.points, 0);
  const average = selected.entries.length ? total / selected.entries.length : 0;
  const sortedPoints = selected.entries.map((entry) => entry.points).sort((a, b) => a - b);
  const median = sortedPoints.length ? sortedPoints[Math.floor(sortedPoints.length / 2)] : 0;
  const previousTotal = comparison.previous?.entries.reduce((sum, entry) => sum + entry.points, 0);
  const rows = comparison.rows.filter((row) => row.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const maxPoints = Math.max(...selected.entries.map((entry) => entry.points), 1);
  const reviewCount = selected.entries.filter((entry) => entry.needsReview).length;

  return (
    <div className="page-stack">
      <section className="snapshot-hero">
        <div>
          <div className="snapshot-title-row">
            <span className={`status-pill ${selected.status}`}>{selected.status}</span>
            <span>{selected.dayLabel}, {dateLabel(selected.capturedAt)}</span>
          </div>
          <h2>{selected.entries.length} commanders on the board</h2>
          <p>{comparison.previous ? `Compared with ${comparison.previous.dayLabel}, ${dateLabel(comparison.previous.capturedAt)}` : "First recorded snapshot — comparisons begin with the next matching capture."}</p>
        </div>
        <label className="select-wrap">
          <CalendarDays size={17} />
          <select value={selected.id} onChange={(event) => setSelected(event.target.value)}>
            {[...state.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>{snapshot.dayLabel} · {snapshot.capturedAt.slice(0, 10)} · {snapshot.status}</option>
            ))}
          </select>
          <ChevronDown size={15} />
        </label>
      </section>

      {reviewCount > 0 && (
        <div className="review-banner"><CircleAlert size={18} /><span><strong>{reviewCount} seeded names need confirmation.</strong> Scores are saved; decorated characters can be corrected from the roster or snapshot editor.</span></div>
      )}

      <section className="metric-grid">
        <Metric icon={Activity} label="Alliance points" value={compact(total)} detail={previousTotal === undefined ? "Baseline capture" : `${signed(total - previousTotal)} vs prior`} tone={statusTone(previousTotal === undefined ? undefined : total - previousTotal)} />
        <Metric icon={Users} label="Ranked members" value={String(selected.entries.length)} detail="Out of 100 roster places" />
        <Metric icon={BarChart3} label="Average score" value={compact(average)} detail={`Median ${compact(median)}`} />
        <Metric icon={Shield} label="Top 25 share" value={`${Math.round(selected.entries.filter((entry) => entry.rank <= 25).reduce((sum, entry) => sum + entry.points, 0) / total * 100)}%`} detail="Of all recorded points" />
      </section>

      <section className="content-grid">
        <div className="panel leaderboard-panel">
          <div className="panel-head">
            <div><p className="eyebrow">RANKINGS</p><h3>Commander performance</h3></div>
            <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find commander" /></div>
          </div>
          <div className="table-scroll">
            <table className="ranking-table">
              <thead><tr><th>Rank</th><th>Commander</th><th>Points</th><th>Score change</th><th>Rank move</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><span className={row.rank <= 3 ? `rank-badge top-${row.rank}` : "rank-badge"}>{row.rank}</span></td>
                    <td><div className="commander-cell"><span className="avatar-fallback">{row.displayName.slice(0, 1).toLocaleUpperCase()}</span><span>{row.displayName}{row.needsReview && <i title="Name needs review">!</i>}</span></div></td>
                    <td><strong>{full(row.points)}</strong><div className="score-bar"><span style={{ width: `${Math.max(4, row.points / maxPoints * 100)}%` }} /></div></td>
                    <td><Delta value={row.pointChange} format={(value) => compact(Math.abs(value))} /></td>
                    <td><Delta value={row.rankChange} format={(value) => `${Math.abs(value)} place${Math.abs(value) === 1 ? "" : "s"}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="panel insight-panel">
          <div className="panel-head"><div><p className="eyebrow">DISTRIBUTION</p><h3>Score bands</h3></div></div>
          <ScoreBands entries={selected.entries} />
          <div className="insight-rule" />
          <p className="eyebrow">CAPTURE NOTE</p>
          <p className="capture-note">{selected.notes || "No note added for this snapshot."}</p>
          <button className="button secondary wide" onClick={() => exportSnapshot(selected)}><Download size={16} /> Export CSV</button>
        </aside>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, tone = "neutral" }: { icon: typeof Activity; label: string; value: string; detail: string; tone?: string }) {
  return <div className="metric-card"><div className="metric-icon"><Icon size={19} /></div><div><span>{label}</span><strong>{value}</strong><small className={tone}>{detail}</small></div></div>;
}

function Delta({ value, format }: { value?: number; format: (value: number) => string }) {
  if (value === undefined) return <span className="delta neutral">—</span>;
  if (value === 0) return <span className="delta neutral">No change</span>;
  const positive = value > 0;
  return <span className={`delta ${positive ? "positive" : "negative"}`}>{positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{format(value)}</span>;
}

function ScoreBands({ entries }: { entries: RankingEntry[] }) {
  const bands = [
    ["30m+", (points: number) => points >= 30_000_000],
    ["20–30m", (points: number) => points >= 20_000_000 && points < 30_000_000],
    ["15–20m", (points: number) => points >= 15_000_000 && points < 20_000_000],
    ["Under 15m", (points: number) => points < 15_000_000],
  ] as const;
  const max = Math.max(...bands.map(([, test]) => entries.filter((entry) => test(entry.points)).length), 1);
  return <div className="bands">{bands.map(([label, test]) => { const count = entries.filter((entry) => test(entry.points)).length; return <div className="band" key={label}><div><span>{label}</span><strong>{count}</strong></div><div className="band-track"><span style={{ width: `${count / max * 100}%` }} /></div></div>; })}</div>;
}

function Importer({ state, setState, ocrConfigured, editingSnapshot, onPublished }: { state: TrackerState; setState: (state: TrackerState) => void; ocrConfigured: boolean; editingSnapshot?: Snapshot; onPublished: (snapshot: Snapshot) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Array<ExtractedRow & { memberId?: string; id?: string }>>(() => editingSnapshot?.entries || []);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(editingSnapshot?.capturedAt.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<"live" | "final">(editingSnapshot?.status || "live");
  const [notes, setNotes] = useState(editingSnapshot?.notes || "");
  const [snapshotId] = useState<string | undefined>(editingSnapshot?.id);
  const input = useRef<HTMLInputElement>(null);

  function addFiles(incoming: File[]) {
    const images = incoming.filter((file) => file.type.startsWith("image/"));
    setFiles((current) => [...current, ...images].slice(0, 25));
  }

  async function extract() {
    if (!files.length) return;
    setBusy(true); setError("");
    const results: ExtractedRow[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const batch = await Promise.all([file].map(async (item) => {
        const form = new FormData();
        form.append("files", item);
        const response = await fetch("/api/extract", { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(`${item.name}: ${body.error || "extraction failed"}`);
        return body.rows as ExtractedRow[];
      }).map((promise) => promise.catch((reason) => { failures.push(reason.message); return []; })));
      results.push(...batch.flat());
    }
    const merged = dedupeRows(results);
    setRows(merged.rows);
    setWarnings([...merged.warnings, ...failures]);
    if (!results.length && failures.length) setError(failures[0]);
    setBusy(false);
  }

  function parseManual() {
    const parsed: ExtractedRow[] = [];
    const failed: number[] = [];
    manual.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim() || /^rank[\t,]/i.test(line)) return;
      const match = line.match(/^\s*(\d+)\s*[\t,]\s*(.+?)\s*[\t,]\s*([\d,]+)\s*$/);
      if (!match) { failed.push(index + 1); return; }
      parsed.push({ rank: Number(match[1]), displayName: match[2], points: Number(match[3].replaceAll(",", "")), confidence: 1 });
    });
    setRows(parsed.sort((a, b) => a.rank - b.rank));
    setWarnings(failed.length ? [`Could not read pasted line${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}`] : []);
  }

  function updateRow(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch, needsReview: false } : row));
  }

  async function publish() {
    setBusy(true); setError("");
    const response = await fetch("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId, capturedDate: date, status, notes, rows }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "Could not publish snapshot");
    else { setState(body.state); onPublished(body.snapshot); }
    setBusy(false);
  }

  return (
    <div className="page-stack narrow-page">
      <section className="section-heading"><div><p className="eyebrow">{snapshotId ? "EDIT SNAPSHOT" : "NEW CAPTURE"}</p><h2>{snapshotId ? "Correct published results" : "Import weekly rankings"}</h2><p>Upload overlapping screenshots or paste rows manually, then verify the result before publishing.</p></div></section>
      {!ocrConfigured && <div className="review-banner warning"><CircleAlert size={18} /><span><strong>Automatic extraction is not configured locally.</strong> Add OPENAI_API_KEY or use manual paste. The Vercel deployment guide covers this.</span></div>}
      <section className="panel import-meta">
        <label><span>Capture date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setStatus(new Date(`${event.target.value}T12:00:00Z`).getUTCDay() === 6 ? "final" : "live"); }} /></label>
        <label><span>Snapshot type</span><select value={status} onChange={(event) => setStatus(event.target.value as "live" | "final")}><option value="live">Live Mon–Fri</option><option value="final">Final Saturday</option></select></label>
        <label className="grow"><span>Officer note</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Transfer week, incomplete roster…" /></label>
      </section>
      {!snapshotId && <section className="import-grid">
        <div className="panel uploader" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}>
          <div className="upload-icon"><UploadCloud size={26} /></div><h3>Drop leaderboard screenshots</h3><p>PNG, JPG or HEIC · up to 25 images · 4 MB each</p>
          <input ref={input} hidden multiple type="file" accept="image/*" onChange={(event) => addFiles([...(event.target.files || [])])} />
          <button className="button secondary" onClick={() => input.current?.click()}>Choose screenshots</button>
          {files.length > 0 && <div className="file-list"><div><FileImage size={16} /><strong>{files.length} screenshot{files.length === 1 ? "" : "s"} ready</strong></div><button onClick={() => setFiles([])}><X size={15} /> Clear</button></div>}
          <button className="button primary wide" disabled={!files.length || busy || !ocrConfigured} onClick={extract}>{busy ? "Reading screenshots…" : <><Sparkles size={16} /> Extract rankings</>}</button>
        </div>
        <div className="panel manual-paste"><p className="eyebrow">MANUAL FALLBACK</p><h3>Paste rank, name and points</h3><p>Accepts CSV or tab-separated rows copied from a spreadsheet.</p><textarea value={manual} onChange={(event) => setManual(event.target.value)} placeholder={'1,Super McNasty,74,831,650\n2,Retired Goblin,49,744,827'} /><button className="button secondary wide" disabled={!manual.trim()} onClick={parseManual}>Build review table</button></div>
      </section>}
      {error && <div className="form-error-box"><CircleAlert size={17} />{error}</div>}
      {warnings.length > 0 && <div className="warning-list">{warnings.slice(0, 8).map((warning) => <span key={warning}><CircleAlert size={14} />{warning}</span>)}</div>}
      {rows.length > 0 && <section className="panel review-panel">
        <div className="panel-head"><div><p className="eyebrow">HUMAN REVIEW</p><h3>{rows.length} extracted rows</h3></div><span className="retention-note">Originals expire after 5 days</span></div>
        <div className="table-scroll"><table className="review-table"><thead><tr><th>Rank</th><th>Commander as shown</th><th>Points</th><th>Identity</th><th /></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.rank}-${index}`} className={row.needsReview || row.confidence < .86 ? "needs-review" : ""}><td><input className="tiny" type="number" value={row.rank} onChange={(event) => updateRow(index, { rank: Number(event.target.value) })} /></td><td><input value={row.displayName} onChange={(event) => updateRow(index, { displayName: event.target.value })} /></td><td><input className="points-input" inputMode="numeric" value={row.points} onChange={(event) => updateRow(index, { points: Number(event.target.value.replace(/\D/g, "")) })} /></td><td><select value={row.memberId || ""} onChange={(event) => updateRow(index, { memberId: event.target.value || undefined })}><option value="">Match by name / create new</option>{state.members.map((member) => <option key={member.id} value={member.id}>{member.canonicalName}</option>)}</select></td><td><button className="icon-button" title="Remove row" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button></td></tr>)}</tbody></table></div>
        <div className="publish-row"><div><strong>Ready to publish?</strong><span>Rank and score changes will calculate automatically once a matching prior capture exists.</span></div><button className="button primary" disabled={busy || !date || !rows.length} onClick={publish}>{busy ? "Saving…" : snapshotId ? "Save corrections" : "Publish snapshot"}</button></div>
      </section>}
    </div>
  );
}

function Snapshots({ snapshots, onOpen, onEdit }: { snapshots: Snapshot[]; onOpen: (snapshot: Snapshot) => void; onEdit: (snapshot: Snapshot) => void }) {
  return <div className="page-stack narrow-page"><section className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>Recorded snapshots</h2><p>Live captures compare with the same weekday; Saturday finals compare week over week.</p></div></section><div className="snapshot-list">{[...snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).map((snapshot) => { const total = snapshot.entries.reduce((sum, entry) => sum + entry.points, 0); return <article className="panel snapshot-card" key={snapshot.id}><div className="snapshot-date"><span>{new Date(snapshot.capturedAt).getUTCDate()}</span><small>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(snapshot.capturedAt))}</small></div><div className="snapshot-card-main"><div><span className={`status-pill ${snapshot.status}`}>{snapshot.status}</span><strong>{snapshot.dayLabel} capture</strong></div><p>{snapshot.entries.length} ranked · {compact(total)} total points</p><small>{snapshot.notes || "No capture note"}</small></div><div className="snapshot-actions"><button className="button ghost" onClick={() => exportSnapshot(snapshot)}><Download size={15} /> CSV</button><button className="button ghost" onClick={() => onEdit(snapshot)}><PencilLine size={15} /> Edit</button><button className="button secondary" onClick={() => onOpen(snapshot)}>Open</button></div></article>; })}</div></div>;
}

function Roster({ state, setState, notify }: { state: TrackerState; setState: (state: TrackerState) => void; notify: (message: string) => void }) {
  const [members, setMembers] = useState(state.members);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = members.filter((member) => [member.canonicalName, ...member.aliases].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  function update(id: string, patch: Partial<Member>) { setMembers((current) => current.map((member) => member.id === id ? { ...member, ...patch } : member)); }
  async function save() { setBusy(true); const response = await fetch("/api/members", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ members }) }); const body = await response.json(); if (response.ok) { setState(body); notify("Roster changes saved."); } setBusy(false); }

  return <div className="page-stack narrow-page"><section className="section-heading roster-heading"><div><p className="eyebrow">IDENTITY & MEMBERSHIP</p><h2>Alliance roster</h2><p>Aliases keep name changes connected to one commander history.</p></div><button className="button primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save roster"}</button></section><div className="review-banner warning"><CircleAlert size={18} /><span>Transfer period is active. Membership dates are intentionally left flexible until the post-transfer roster is supplied.</span></div><section className="panel"><div className="panel-head"><div><p className="eyebrow">{members.filter((member) => member.active).length} ACTIVE</p><h3>Commander identities</h3></div><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names or aliases" /></div></div><div className="table-scroll"><table className="roster-table"><thead><tr><th>Commander</th><th>Known aliases</th><th>Status</th><th>Joined</th></tr></thead><tbody>{filtered.map((member) => <tr key={member.id}><td><input value={member.canonicalName} onChange={(event) => update(member.id, { canonicalName: event.target.value })} /></td><td><input value={member.aliases.join(", ")} placeholder="Previous names, comma separated" onChange={(event) => update(member.id, { aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean) })} /></td><td><label className="toggle-label"><input type="checkbox" checked={member.active} onChange={(event) => update(member.id, { active: event.target.checked })} /><span>{member.active ? "Active" : "Departed"}</span></label></td><td><input type="date" value={member.joinedAt || ""} onChange={(event) => update(member.id, { joinedAt: event.target.value || undefined })} /></td></tr>)}</tbody></table></div></section></div>;
}
