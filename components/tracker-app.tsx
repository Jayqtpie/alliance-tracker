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
  FileVideo,
  GitMerge,
  History,
  LayoutDashboard,
  LineChart,
  LogOut,
  PencilLine,
  Search,
  Share2,
  Shield,
  Sparkles,
  UploadCloud,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExtractedRow, Member, RankingEntry, Snapshot, TrackerState } from "@/lib/types";
import { analyzeImport, analyzeLargeChanges, dedupeRows, matchMember, snapshotComparison } from "@/lib/tracker";

type View = "overview" | "import" | "reports" | "snapshots" | "members";

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportDetailedSnapshot(snapshot: Snapshot, state: TrackerState) {
  const comparison = snapshotComparison(snapshot, state.snapshots);
  const memberById = new Map(state.members.map((member) => [member.id, member]));
  const lines = ["rank,commander,displayed_name,points,previous_points,point_change,previous_rank,rank_change,status"];
  comparison.rows.forEach((entry) => {
    const member = entry.memberId ? memberById.get(entry.memberId) : undefined;
    const values = [
      entry.rank,
      member?.canonicalName || entry.displayName,
      entry.displayName,
      entry.points,
      entry.priorPoints ?? "",
      entry.pointChange ?? "",
      entry.priorRank ?? "",
      entry.rankChange ?? "",
      member?.active === false ? "departed" : "active",
    ];
    lines.push(values.map((value) => typeof value === "string" ? `"${value.replaceAll('"', '""')}"` : value).join(","));
  });
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `rscl-report-${snapshot.capturedAt.slice(0, 10)}.csv`);
}

function exportReportImage(snapshot: Snapshot, state: TrackerState) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1500;
  const context = canvas.getContext("2d");
  if (!context) return;
  const comparison = snapshotComparison(snapshot, state.snapshots);
  const total = snapshot.entries.reduce((sum, entry) => sum + entry.points, 0);
  const activeIds = new Set(snapshot.entries.map((entry) => entry.memberId));
  const missing = state.members.filter((member) => member.active && !activeIds.has(member.id)).length;
  const improvers = comparison.rows.filter((row) => row.pointChange !== undefined).sort((a, b) => (b.pointChange || 0) - (a.pointChange || 0)).slice(0, 5);

  context.fillStyle = "#101b28";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f08b2d";
  context.fillRect(0, 0, 20, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "800 62px Arial";
  context.fillText("RSCL WEEKLY REPORT", 80, 105);
  context.fillStyle = "#9fb0c1";
  context.font = "28px Arial";
  context.fillText(`${snapshot.dayLabel}, ${dateLabel(snapshot.capturedAt)} · ${snapshot.status.toUpperCase()}`, 82, 155);

  const cards = [
    ["ALLIANCE POINTS", full(total)],
    ["RANKED", String(snapshot.entries.length)],
    ["NOT ON BOARD", String(missing)],
  ];
  cards.forEach(([label, value], index) => {
    const x = 80 + index * 355;
    context.fillStyle = "#1d2c3d";
    context.fillRect(x, 210, 320, 155);
    context.fillStyle = "#91a4b7";
    context.font = "700 20px Arial";
    context.fillText(label, x + 24, 255);
    context.fillStyle = "#ffffff";
    context.font = "800 35px Arial";
    context.fillText(value, x + 24, 320);
  });

  context.fillStyle = "#f08b2d";
  context.font = "800 28px Arial";
  context.fillText("TOP 10 COMMANDERS", 80, 440);
  snapshot.entries.slice(0, 10).forEach((entry, index) => {
    const y = 500 + index * 62;
    context.fillStyle = index % 2 ? "#172638" : "#1b2b3d";
    context.fillRect(80, y - 38, 1040, 52);
    context.fillStyle = "#f4a75f";
    context.font = "800 23px Arial";
    context.fillText(String(entry.rank), 105, y - 3);
    context.fillStyle = "#ffffff";
    context.fillText(entry.displayName.slice(0, 34), 170, y - 3);
    context.textAlign = "right";
    context.fillText(full(entry.points), 1090, y - 3);
    context.textAlign = "left";
  });

  context.fillStyle = "#f08b2d";
  context.font = "800 28px Arial";
  context.fillText(comparison.previous ? "BIGGEST POINT GAINS" : "COMPARISONS BEGIN NEXT MATCHING CAPTURE", 80, 1165);
  improvers.forEach((entry, index) => {
    const y = 1220 + index * 48;
    context.fillStyle = "#ffffff";
    context.font = "700 22px Arial";
    context.fillText(entry.displayName.slice(0, 30), 95, y);
    context.fillStyle = "#64d39a";
    context.textAlign = "right";
    context.fillText(`+${full(entry.pointChange || 0)}`, 1090, y);
    context.textAlign = "left";
  });
  context.fillStyle = "#70869b";
  context.font = "18px Arial";
  context.fillText("Generated by Rascals Command · Server 927", 80, 1450);
  canvas.toBlob((blob) => blob && downloadBlob(blob, `rscl-report-${snapshot.capturedAt.slice(0, 10)}.png`), "image/png");
}

function waitForVideoEvent(video: HTMLVideoElement, event: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("The video took too long to decode.")), 15000);
    const complete = () => { window.clearTimeout(timer); cleanup(); resolve(); };
    const fail = () => { window.clearTimeout(timer); cleanup(); reject(new Error("This video format could not be decoded in this browser.")); };
    const cleanup = () => { video.removeEventListener(event, complete); video.removeEventListener("error", fail); };
    video.addEventListener(event, complete, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

async function extractVideoFrames(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    if (video.readyState < 1) await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The recording duration could not be read.");
    const frameCount = Math.min(18, Math.max(6, Math.ceil(video.duration / 2.5)));
    const width = Math.min(video.videoWidth, 1170);
    const height = Math.round(video.videoHeight * (width / video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Video frame extraction is unavailable in this browser.");
    const frames: File[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(video.duration - 0.05, ((index + 0.5) / frameCount) * video.duration);
      const seeked = waitForVideoEvent(video, "seeked");
      video.currentTime = Math.max(0, time);
      await seeked;
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not create a frame.")), "image/jpeg", 0.86));
      frames.push(new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-frame-${String(index + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
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
    ["reports", "Reports", LineChart],
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
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => {
              if (id === "import") setEditingSnapshot(undefined);
              setView(id);
              window.scrollTo(0, 0);
            }}>
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
        {view === "reports" && <Reports state={state} />}
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
          <button className="button secondary wide" onClick={() => exportDetailedSnapshot(selected, state)}><Download size={16} /> Detailed CSV</button>
          <button className="button secondary wide report-image-button" onClick={() => exportReportImage(selected, state)}><Share2 size={16} /> Shareable image</button>
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
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(editingSnapshot?.capturedAt.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<"live" | "final">(editingSnapshot?.status || "live");
  const [sourceType, setSourceType] = useState<Snapshot["sourceType"]>(editingSnapshot?.sourceType || "screenshots");
  const [notes, setNotes] = useState(editingSnapshot?.notes || "");
  const [snapshotId] = useState<string | undefined>(editingSnapshot?.id);
  const input = useRef<HTMLInputElement>(null);
  const diagnosticWarnings = useMemo(() => rows.length ? analyzeImport(rows, state.members) : [], [rows, state.members]);
  const changeWarnings = useMemo(() => rows.length && date ? analyzeLargeChanges(rows, state.members, state.snapshots, date, status) : [], [rows, state.members, state.snapshots, date, status]);
  const allWarnings = [...new Set([...warnings, ...diagnosticWarnings, ...changeWarnings])];
  const linkedMemberIds = new Set(rows.map((row) => row.memberId || matchMember(row.displayName, state.members)?.id).filter(Boolean));
  const missingActive = state.members.filter((member) => member.active && !linkedMemberIds.has(member.id)).length;
  const unmatched = rows.filter((row) => !row.memberId && !matchMember(row.displayName, state.members)).length;

  async function addFiles(incoming: File[]) {
    setError("");
    const images = incoming.filter((file) => file.type.startsWith("image/"));
    if (images.length) setFiles((current) => [...current, ...images].slice(0, 25));
    const videos = incoming.filter((file) => file.type.startsWith("video/"));
    if (!videos.length) return;
    setPreparingVideo(true);
    try {
      const frameGroups = [];
      for (const video of videos.slice(0, 2)) frameGroups.push(await extractVideoFrames(video));
      const frames = frameGroups.flat();
      setFiles((current) => [...current, ...frames].slice(0, 25));
      setSourceType("video");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the screen recording.");
    } finally {
      setPreparingVideo(false);
    }
  }

  async function extract() {
    if (!files.length) return;
    setBusy(true); setError("");
    const results: ExtractedRow[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("files", file);
      try {
        const response = await fetch("/api/extract", { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(`${file.name}: ${body.error || "extraction failed"}`);
        results.push(...body.rows as ExtractedRow[]);
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : `${file.name}: extraction failed`);
      }
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
    setSourceType("manual");
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
      body: JSON.stringify({ snapshotId, capturedDate: date, status, sourceType, notes, rows }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "Could not publish snapshot");
    else { setState(body.state); onPublished(body.snapshot); }
    setBusy(false);
  }

  return (
    <div className="page-stack narrow-page">
      <section className="section-heading"><div><p className="eyebrow">{snapshotId ? "EDIT SNAPSHOT" : "NEW CAPTURE"}</p><h2>{snapshotId ? "Correct published results" : "Import weekly rankings"}</h2><p>Upload overlapping screenshots, select an iPhone screen recording, or paste rows manually.</p></div></section>
      {!ocrConfigured && <div className="review-banner warning"><CircleAlert size={18} /><span><strong>Automatic extraction is not configured.</strong> Add OPENAI_API_KEY or use manual paste.</span></div>}
      <section className="panel import-meta">
        <label><span>Capture date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setStatus(new Date(`${event.target.value}T12:00:00Z`).getUTCDay() === 6 ? "final" : "live"); }} /></label>
        <label><span>Snapshot type</span><select value={status} onChange={(event) => setStatus(event.target.value as "live" | "final")}><option value="live">Live Mon–Fri</option><option value="final">Final Saturday</option></select></label>
        <label className="grow"><span>Officer note</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Transfer week, incomplete roster…" /></label>
      </section>
      {!snapshotId && <section className="import-grid">
        <div className="panel uploader" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles([...event.dataTransfer.files]); }}>
          <div className="upload-icon">{preparingVideo ? <FileVideo size={26} /> : <UploadCloud size={26} />}</div><h3>Screenshots or screen recording</h3><p>Images stay under 4 MB. Video is converted into up to 18 frames on your device before upload.</p>
          <input ref={input} hidden multiple type="file" accept="image/*,video/*" onChange={(event) => void addFiles([...(event.target.files || [])])} />
          <button className="button secondary" disabled={preparingVideo} onClick={() => input.current?.click()}>{preparingVideo ? "Preparing recording…" : "Choose screenshots or video"}</button>
          {files.length > 0 && <div className="file-list"><div>{sourceType === "video" ? <FileVideo size={16} /> : <FileImage size={16} />}<strong>{files.length} frame{files.length === 1 ? "" : "s"} ready</strong></div><button onClick={() => { setFiles([]); setSourceType("screenshots"); }}><X size={15} /> Clear</button></div>}
          <button className="button primary wide" disabled={!files.length || busy || preparingVideo || !ocrConfigured} onClick={extract}>{busy ? `Reading ${files.length} frame${files.length === 1 ? "" : "s"}…` : <><Sparkles size={16} /> Extract rankings</>}</button>
        </div>
        <div className="panel manual-paste"><p className="eyebrow">MANUAL FALLBACK</p><h3>Paste rank, name and points</h3><p>Accepts CSV or tab-separated rows copied from a spreadsheet.</p><textarea value={manual} onChange={(event) => setManual(event.target.value)} placeholder={'1,Super McNasty,74,831,650\n2,Retired Goblin,49,744,827'} /><button className="button secondary wide" disabled={!manual.trim()} onClick={parseManual}>Build review table</button></div>
      </section>}
      {error && <div className="form-error-box"><CircleAlert size={17} />{error}</div>}
      {allWarnings.length > 0 && <div className="warning-list">{allWarnings.slice(0, 12).map((warning) => <span key={warning}><CircleAlert size={14} />{warning}</span>)}</div>}
      {rows.length > 0 && <section className="panel review-panel">
        <div className="panel-head"><div><p className="eyebrow">HUMAN REVIEW</p><h3>{rows.length} extracted rows</h3></div><span className="retention-note">{unmatched} unmatched · {missingActive} active members not on board · originals expire after 5 days</span></div>
        <div className="table-scroll"><table className="review-table"><thead><tr><th>Rank</th><th>Commander as shown</th><th>Points</th><th>Identity</th><th /></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.rank}-${index}`} className={row.needsReview || row.confidence < .86 || (!row.memberId && !matchMember(row.displayName, state.members)) ? "needs-review" : ""}><td><input className="tiny" type="number" value={row.rank} onChange={(event) => updateRow(index, { rank: Number(event.target.value) })} /></td><td><input value={row.displayName} onChange={(event) => updateRow(index, { displayName: event.target.value })} /></td><td><input className="points-input" inputMode="numeric" value={row.points} onChange={(event) => updateRow(index, { points: Number(event.target.value.replace(/\D/g, "")) })} /></td><td><select value={row.memberId || matchMember(row.displayName, state.members)?.id || ""} onChange={(event) => updateRow(index, { memberId: event.target.value || undefined })}><option value="">Create as a new member</option>{[...state.members].sort((a, b) => Number(b.active) - Number(a.active) || a.canonicalName.localeCompare(b.canonicalName)).map((member) => <option key={member.id} value={member.id}>{member.active ? "" : "[Departed] "}{member.canonicalName}</option>)}</select></td><td><button className="icon-button" title="Remove row" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button></td></tr>)}</tbody></table></div>
        <div className="publish-row"><div><strong>Ready to publish?</strong><span>Unmatched names become new members; selected identities record the displayed name as an alias.</span></div><button className="button primary" disabled={busy || !date || !rows.length} onClick={publish}>{busy ? "Saving…" : snapshotId ? "Save corrections" : "Publish snapshot"}</button></div>
      </section>}
    </div>
  );
}

function Reports({ state }: { state: TrackerState }) {
  const ordered = [...state.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const [selectedId, setSelectedId] = useState(ordered[0]?.id || "");
  const [threshold, setThreshold] = useState(15_000_000);
  const selected = state.snapshots.find((snapshot) => snapshot.id === selectedId) || ordered[0];
  if (!selected) return <div className="page-stack"><div className="review-banner warning">Publish a snapshot to create reports.</div></div>;
  const comparison = snapshotComparison(selected, state.snapshots);
  const total = selected.entries.reduce((sum, entry) => sum + entry.points, 0);
  const previousTotal = comparison.previous?.entries.reduce((sum, entry) => sum + entry.points, 0);
  const onBoard = new Set(selected.entries.map((entry) => entry.memberId).filter(Boolean));
  const missing = state.members.filter((member) => member.active && !onBoard.has(member.id));
  const newOnBoard = comparison.previous
    ? comparison.rows.filter((row) => row.priorPoints === undefined)
    : [];
  const improvers = comparison.rows.filter((row) => row.pointChange !== undefined).sort((a, b) => (b.pointChange || 0) - (a.pointChange || 0));
  const rankMovers = comparison.rows.filter((row) => row.rankChange !== undefined).sort((a, b) => (b.rankChange || 0) - (a.rankChange || 0));
  const meetingThreshold = selected.entries.filter((entry) => entry.points >= threshold).length;
  const week = state.snapshots.filter((snapshot) => snapshot.weekStart === selected.weekStart).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const maxWeeklyTotal = Math.max(...week.map((snapshot) => snapshot.entries.reduce((sum, entry) => sum + entry.points, 0)), 1);

  return (
    <div className="page-stack">
      <section className="section-heading report-heading">
        <div><p className="eyebrow">OFFICER REPORTING</p><h2>Weekly performance report</h2><p>Participation, movement and share-ready summaries from the selected capture.</p></div>
        <div className="report-actions">
          <button className="button secondary" onClick={() => exportDetailedSnapshot(selected, state)}><Download size={15} /> Detailed CSV</button>
          <button className="button primary" onClick={() => exportReportImage(selected, state)}><Share2 size={15} /> Report image</button>
        </div>
      </section>
      <section className="panel report-controls">
        <label className="select-wrap"><CalendarDays size={17} /><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{ordered.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.dayLabel} · {snapshot.capturedAt.slice(0, 10)} · {snapshot.status}</option>)}</select><ChevronDown size={15} /></label>
        <label><span>Participation target</span><input type="number" min="0" step="1000000" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /></label>
      </section>
      <section className="metric-grid">
        <Metric icon={Activity} label="Alliance points" value={compact(total)} detail={previousTotal === undefined ? "No matching prior capture" : `${signed(total - previousTotal)} vs prior`} tone={statusTone(previousTotal === undefined ? undefined : total - previousTotal)} />
        <Metric icon={Shield} label="Meeting target" value={`${meetingThreshold}/${selected.entries.length}`} detail={`At least ${compact(threshold)} points`} />
        <Metric icon={Users} label="Not on board" value={String(missing.length)} detail="Active roster members" tone={missing.length ? "negative" : "positive"} />
        <Metric icon={UserPlus} label="New on board" value={String(newOnBoard.length)} detail={comparison.previous ? "Not present in comparison" : "Baseline capture"} />
      </section>
      <section className="panel progression-panel">
        <div className="panel-head"><div><p className="eyebrow">MONDAY–SATURDAY</p><h3>Week progression</h3></div><span className="retention-note">Week of {selected.weekStart}</span></div>
        <div className="progression-grid">{week.map((snapshot) => { const dayTotal = snapshot.entries.reduce((sum, entry) => sum + entry.points, 0); return <div className="progression-day" key={snapshot.id}><div><strong>{snapshot.dayLabel.slice(0, 3)}</strong><span>{snapshot.entries.length} ranked</span></div><b>{compact(dayTotal)}</b><div className="progression-track"><span style={{ width: `${dayTotal / maxWeeklyTotal * 100}%` }} /></div></div>; })}</div>
      </section>
      <section className="report-grid">
        <ReportList title="Biggest point gains" empty="A matching prior capture is needed." rows={improvers.slice(0, 8).map((row) => ({ name: row.displayName, value: signed(row.pointChange) }))} />
        <ReportList title="Biggest rank climbs" empty="A matching prior capture is needed." rows={rankMovers.filter((row) => (row.rankChange || 0) > 0).slice(0, 8).map((row) => ({ name: row.displayName, value: `+${row.rankChange} places` }))} />
        <ReportList title="New or returning" empty="No newly ranked members detected." rows={newOnBoard.slice(0, 12).map((row) => ({ name: row.displayName, value: `Rank ${row.rank}` }))} />
        <ReportList title="Active members not ranked" empty="Every active member appears on the board." rows={missing.slice(0, 20).map((member) => ({ name: member.canonicalName, value: member.joinedAt ? `Joined ${member.joinedAt}` : "No score recorded" }))} />
      </section>
    </div>
  );
}

function ReportList({ title, rows, empty }: { title: string; rows: Array<{ name: string; value: string }>; empty: string }) {
  return <section className="panel report-list"><div className="panel-head"><h3>{title}</h3></div>{rows.length ? <ol>{rows.map((row, index) => <li key={`${row.name}-${index}`}><span>{row.name}</span><strong>{row.value}</strong></li>)}</ol> : <p className="empty-copy">{empty}</p>}</section>;
}

function Snapshots({ snapshots, onOpen, onEdit }: { snapshots: Snapshot[]; onOpen: (snapshot: Snapshot) => void; onEdit: (snapshot: Snapshot) => void }) {
  return <div className="page-stack narrow-page"><section className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>Recorded snapshots</h2><p>Live captures compare with the same weekday; Saturday finals compare week over week.</p></div></section><div className="snapshot-list">{[...snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).map((snapshot) => { const total = snapshot.entries.reduce((sum, entry) => sum + entry.points, 0); return <article className="panel snapshot-card" key={snapshot.id}><div className="snapshot-date"><span>{new Date(snapshot.capturedAt).getUTCDate()}</span><small>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(snapshot.capturedAt))}</small></div><div className="snapshot-card-main"><div><span className={`status-pill ${snapshot.status}`}>{snapshot.status}</span><strong>{snapshot.dayLabel} capture</strong></div><p>{snapshot.entries.length} ranked · {compact(total)} total points</p><small>{snapshot.notes || "No capture note"}</small></div><div className="snapshot-actions"><button className="button ghost" onClick={() => exportSnapshot(snapshot)}><Download size={15} /> CSV</button><button className="button ghost" onClick={() => onEdit(snapshot)}><PencilLine size={15} /> Edit</button><button className="button secondary" onClick={() => onOpen(snapshot)}>Open</button></div></article>; })}</div></div>;
}

function Roster({ state, setState, notify }: { state: TrackerState; setState: (state: TrackerState) => void; notify: (message: string) => void }) {
  const [members, setMembers] = useState(state.members);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "departed">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [primaryId, setPrimaryId] = useState("");
  const [duplicateId, setDuplicateId] = useState("");
  const filtered = members.filter((member) =>
    (filter === "all" || (filter === "active" ? member.active : !member.active)) &&
    [member.canonicalName, ...member.aliases].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  function update(id: string, patch: Partial<Member>) { setMembers((current) => current.map((member) => member.id === id ? { ...member, ...patch } : member)); }
  function addMember() {
    const member: Member = { id: crypto.randomUUID(), canonicalName: "New member", aliases: [], active: true, joinedAt: new Date().toISOString().slice(0, 10) };
    setMembers((current) => [member, ...current]);
    setFilter("all");
    setQuery("");
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/members", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ members }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save roster changes.");
      setState(body); setMembers(body.members); notify("Roster changes saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save roster changes."); }
    setBusy(false);
  }
  async function merge() {
    if (!primaryId || !duplicateId || primaryId === duplicateId) { setError("Choose two different identities to merge."); return; }
    const primary = members.find((member) => member.id === primaryId);
    const duplicate = members.find((member) => member.id === duplicateId);
    if (!primary || !duplicate || !window.confirm(`Merge ${duplicate.canonicalName} into ${primary.canonicalName}? Historical entries will be reassigned.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ primaryId, duplicateId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not merge identities.");
      setState(body); setMembers(body.members); setPrimaryId(""); setDuplicateId(""); notify("Member identities merged.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not merge identities."); }
    setBusy(false);
  }

  return <div className="page-stack narrow-page">
    <section className="section-heading roster-heading"><div><p className="eyebrow">IDENTITY & MEMBERSHIP</p><h2>Alliance roster</h2><p>Permanent identities keep name changes, departures and returns connected to one history.</p></div><div className="report-actions"><button className="button secondary" onClick={addMember}><UserPlus size={15} /> Add member</button><button className="button primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save roster"}</button></div></section>
    <div className="review-banner warning"><CircleAlert size={18} /><span>Transfer period is active. Mark departures and arrivals here after the final roster is supplied; historical scores will remain attached.</span></div>
    {error && <div className="form-error-box"><CircleAlert size={17} />{error}</div>}
    <section className="panel merge-panel"><div><GitMerge size={20} /><span><strong>Merge duplicate identities</strong><small>Keep the first identity; the second becomes aliases and all historical entries are reassigned.</small></span></div><select value={primaryId} onChange={(event) => setPrimaryId(event.target.value)}><option value="">Identity to keep</option>{members.map((member) => <option key={member.id} value={member.id}>{member.canonicalName}</option>)}</select><select value={duplicateId} onChange={(event) => setDuplicateId(event.target.value)}><option value="">Duplicate identity</option>{members.filter((member) => member.id !== primaryId).map((member) => <option key={member.id} value={member.id}>{member.canonicalName}</option>)}</select><button className="button secondary" disabled={busy || !primaryId || !duplicateId} onClick={merge}>Merge</button></section>
    <section className="panel"><div className="panel-head roster-tools"><div><p className="eyebrow">{members.filter((member) => member.active).length} ACTIVE · {members.filter((member) => !member.active).length} DEPARTED</p><h3>Commander identities</h3></div><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All members</option><option value="active">Active only</option><option value="departed">Departed only</option></select><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names or aliases" /></div></div><div className="table-scroll"><table className="roster-table"><thead><tr><th>Commander</th><th>Known aliases</th><th>Status</th><th>Joined</th><th>Left</th><th>Officer notes</th></tr></thead><tbody>{filtered.map((member) => <tr key={member.id}><td><input value={member.canonicalName} onChange={(event) => update(member.id, { canonicalName: event.target.value })} /></td><td><input value={member.aliases.join(", ")} placeholder="Previous names, comma separated" onChange={(event) => update(member.id, { aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean) })} /></td><td><label className="toggle-label"><input type="checkbox" checked={member.active} onChange={(event) => update(member.id, { active: event.target.checked, leftAt: event.target.checked ? undefined : member.leftAt || new Date().toISOString().slice(0, 10) })} /><span>{member.active ? "Active" : "Departed"}</span></label></td><td><input type="date" value={member.joinedAt || ""} onChange={(event) => update(member.id, { joinedAt: event.target.value || undefined })} /></td><td><input type="date" disabled={member.active} value={member.leftAt || ""} onChange={(event) => update(member.id, { leftAt: event.target.value || undefined })} /></td><td><input value={member.notes || ""} placeholder="Transfer, return, officer note…" onChange={(event) => update(member.id, { notes: event.target.value || undefined })} /></td></tr>)}</tbody></table></div></section>
  </div>;
}
