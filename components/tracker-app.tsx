"use client";

import { upload } from "@vercel/blob/client";
import {
  Activity,
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  Download,
  FileImage,
  FileJson,
  FileVideo,
  History,
  LayoutDashboard,
  LineChart,
  LogOut,
  PencilLine,
  Search,
  Share2,
  Shield,
  ShieldCheck,
  Swords,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AllianceMark } from "@/components/alliance-mark";
import { AllianceRoster, MemberAvatar } from "@/components/alliance-roster";
import type { BridgeJobView } from "@/lib/bridge-types";
import { parseLocalExtractionText } from "@/lib/local-import";
import type { ExtractedRow, Member, RankingEntry, Snapshot, TrackerState } from "@/lib/types";
import { analyzeImport, analyzeLargeChanges, dedupeRows, matchMember, memberPerformance, snapshotComparison } from "@/lib/tracker";

type View = "overview" | "import" | "reports" | "operations" | "members";
const bridgeJobStorageKey = "alliance-manager:active-bridge-job";

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
  context.fillText("Generated by Alliance Manager · RSCL Server 927", 80, 1450);
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
  bridgeConfigured,
}: {
  initialState: TrackerState;
  storageMode: string;
  ocrConfigured: boolean;
  bridgeConfigured: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [view, setView] = useState<View>("overview");
  const [reportsTab, setReportsTab] = useState<"reports" | "snapshots">("reports");
  const [editingSnapshot, setEditingSnapshot] = useState<Snapshot>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(
    [...initialState.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]?.id || "",
  );
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string>();
  const selected = state.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) || state.snapshots[0];
  const selectedMember = state.members.find((member) => member.id === selectedMemberId);
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

  async function deleteSnapshot(snapshot: Snapshot) {
    const response = await fetch(`/api/snapshots?id=${encodeURIComponent(snapshot.id)}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not delete this snapshot.");
    const nextState = body.state as TrackerState;
    const latestRemaining = [...nextState.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    setState(nextState);
    if (selectedSnapshotId === snapshot.id) setSelectedSnapshotId(latestRemaining?.id || "");
    showNotice("Snapshot deleted.");
  }

  const nav = [
    ["overview", "Overview", LayoutDashboard],
    ["operations", "Operations", Swords],
    ["members", "Roster", Users],
    ["reports", "Reports", LineChart],
    ["import", "New import", UploadCloud],
  ] as const;

  function navigate(next: View) {
    if (next === "import") setEditingSnapshot(undefined);
    setView(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to content</a>
      <aside className="sidebar">
        <div className="brand-lockup">
          <AllianceMark compact />
          <div><strong>{state.alliance.tag}<span className="brand-word"> / command</span></strong><span>Server {state.alliance.server}</span></div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map(([id, label, Icon]) => (
            <button key={id} disabled={id === "operations"} title={id === "operations" ? "Operations are managed on the alliance’s other website" : undefined} aria-current={view === id ? "page" : undefined} className={view === id ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}>
              <Icon size={18} /> <span>{label}</span>{id === "operations" && <span className="nav-disabled-note">Paused</span>}{id === "members" && <span className="nav-count">{state.members.filter((member) => member.active).length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="leadership-access"><ShieldCheck size={20} /><div><strong>Leadership workspace</strong><span>R4 & R5 officer access</span></div></div>
          <div className={`system-chip ${storageMode === "vercel-blob" ? "online" : "local"}`}>
            <Cloud size={14} /> {storageMode === "vercel-blob" ? "Shared data online" : "Local preview data"}
          </div>
          <button className="nav-item" onClick={logout}><LogOut size={18} /> Sign out</button>
        </div>
      </aside>

      <main className="workspace" id="workspace" tabIndex={-1}>
        <header className="topbar">
          <div>
            <p className="workspace-breadcrumb">{state.alliance.name} <ChevronRight size={13} /> <span>{nav.find(([id]) => id === view)?.[1]}</span></p>
            {view !== "overview" && view !== "members" && <h1 className="sr-only">{nav.find(([id]) => id === view)?.[1]}</h1>}
          </div>
          <div className="topbar-meta"><ShieldCheck size={15} /> Leadership only <span className="officer-avatar">R4/5</span></div>
          <button className="mobile-signout icon-button" aria-label="Sign out" onClick={logout}><LogOut size={18} /></button>
        </header>

        {view === "overview" && selected && comparison && (
          <Overview
            key={selected.id}
            state={state}
            selected={selected}
            setSelected={setSelectedSnapshotId}
            comparison={comparison}
            query={query}
            setQuery={setQuery}
            onOpenMember={setSelectedMemberId}
            onNavigate={navigate}
            onReview={() => { setEditingSnapshot(selected); setView("import"); window.scrollTo(0, 0); }}
          />
        )}
        {view === "overview" && !selected && (
          <div className="page-stack"><section className="dashboard-heading"><div><p className="eyebrow">YOUR ALLIANCE, AT A GLANCE</p><h1>Command overview</h1><p>Everything you need to keep the alliance moving.</p></div></section><section className="panel operations-empty"><UploadCloud size={32} /><h2>Your first capture starts here</h2><p>Import a leaderboard to see alliance scores and commander performance.</p><button className="button primary" onClick={() => navigate("import")}>New import <ArrowRight size={16} /></button></section></div>
        )}
        {view === "import" && (
          <Importer
            state={state}
            setState={setState}
            ocrConfigured={ocrConfigured}
            bridgeConfigured={bridgeConfigured}
            editingSnapshot={editingSnapshot}
            onPublished={(snapshot) => {
              setEditingSnapshot(undefined);
              setSelectedSnapshotId(snapshot.id);
              setView("overview");
              showNotice("Snapshot published successfully.");
            }}
          />
        )}
        {view === "reports" && <>
          <div className="reports-tabs-wrap"><div className="operations-tabs reports-tabs">
            <button className={reportsTab === "reports" ? "active" : ""} onClick={() => setReportsTab("reports")}><LineChart size={16} />Reports</button>
            <button className={reportsTab === "snapshots" ? "active" : ""} onClick={() => setReportsTab("snapshots")}><History size={16} />Snapshot history</button>
          </div></div>
          {reportsTab === "reports" ? <Reports state={state} /> : <Snapshots
            snapshots={state.snapshots}
            onOpen={(snapshot) => { setSelectedSnapshotId(snapshot.id); setView("overview"); }}
            onEdit={(snapshot) => { setEditingSnapshot(snapshot); setView("import"); }}
            onDelete={deleteSnapshot}
          />}
        </>}
        {view === "members" && <AllianceRoster state={state} onOpenMember={setSelectedMemberId} />}
      </main>
      {selectedMember && <CommanderProfile member={selectedMember} state={state} onClose={() => setSelectedMemberId(undefined)} />}
      {notice && <div className="toast" role="status"><Check size={17} /> {notice}</div>}
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
  onOpenMember,
  onNavigate,
  onReview,
}: {
  state: TrackerState;
  selected: Snapshot;
  setSelected: (id: string) => void;
  comparison: ReturnType<typeof snapshotComparison>;
  query: string;
  setQuery: (query: string) => void;
  onOpenMember: (id: string) => void;
  onNavigate: (view: View) => void;
  onReview: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "top" | "review">("all");
  const [page, setPage] = useState(0);
  const total = selected.entries.reduce((sum, entry) => sum + entry.points, 0);
  const average = selected.entries.length ? total / selected.entries.length : 0;
  const sortedPoints = selected.entries.map((entry) => entry.points).sort((a, b) => a - b);
  const median = sortedPoints.length ? sortedPoints[Math.floor(sortedPoints.length / 2)] : 0;
  const previousTotal = comparison.previous?.entries.reduce((sum, entry) => sum + entry.points, 0);
  const rows = comparison.rows.filter((row) => row.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === "all" || (filter === "top" ? row.rank <= 25 : row.needsReview)));
  const pageCount = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * 10, currentPage * 10 + 10);
  const activeMembers = state.members.filter((member) => member.active);
  const rankedIds = new Set(selected.entries.map((entry) => entry.memberId));
  const coveredMembers = activeMembers.filter((member) => rankedIds.has(member.id)).length;
  const maxPoints = Math.max(...selected.entries.map((entry) => entry.points), 1);
  const reviewCount = selected.entries.filter((entry) => entry.needsReview).length;

  return (
    <div className="page-stack dashboard-page">
      <section className="dashboard-heading">
        <div><p className="eyebrow">YOUR ALLIANCE, AT A GLANCE</p><h1>Command overview<span>.</span></h1><p>Performance, people, and the next move.</p></div>
        <div className="dashboard-actions"><button className="button secondary" onClick={() => onNavigate("reports")}><LineChart size={16} />View reports</button><button className="button primary" onClick={() => onNavigate("import")}><UploadCloud size={16} />New import</button></div>
      </section>
      <section className="snapshot-hero">
        <div>
          <div className="snapshot-title-row">
            <span className={`status-pill ${selected.status}`}>{selected.status}</span>
            <span>{selected.dayLabel}, {dateLabel(selected.capturedAt)}</span>
          </div>
          <h2>Alliance Duel <span>/ performance snapshot</span></h2>
          <p>{comparison.previous ? `Compared with ${comparison.previous.dayLabel}, ${dateLabel(comparison.previous.capturedAt)}` : "First recorded snapshot — comparisons begin with the next matching capture."}</p>
        </div>
        <label className="select-wrap">
          <CalendarDays size={17} />
          <select aria-label="Performance snapshot" value={selected.id} onChange={(event) => setSelected(event.target.value)}>
            {[...state.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>{snapshot.dayLabel} · {snapshot.capturedAt.slice(0, 10)} · {snapshot.status}</option>
            ))}
          </select>
          <ChevronDown size={15} />
        </label>
      </section>

      <section className="metric-grid">
        <Metric icon={Activity} label="Alliance points" value={compact(total)} detail={previousTotal === undefined ? "Baseline capture" : `${signed(total - previousTotal)} vs prior`} tone={statusTone(previousTotal === undefined ? undefined : total - previousTotal)} />
        <Metric icon={Users} label="Ranked members" value={String(selected.entries.length)} detail={`${coveredMembers} of ${activeMembers.length} active members captured`} />
        <Metric icon={BarChart3} label="Average score" value={compact(average)} detail={`Median ${compact(median)}`} />
        <Metric icon={Shield} label="Top 25 share" value={total ? `${Math.round(selected.entries.filter((entry) => entry.rank <= 25).reduce((sum, entry) => sum + entry.points, 0) / total * 100)}%` : "—"} detail="Of all recorded points" />
      </section>

      {reviewCount > 0 && (
        <div className="review-banner dashboard-review"><CircleAlert size={17} /><span><strong>{reviewCount} commander names need a second look.</strong> Confirm names in this capture to keep your records accurate.</span><button onClick={onReview}>Review capture <ArrowRight size={14} /></button></div>
      )}

      <section className="content-grid">
        <div className="panel leaderboard-panel">
          <div className="panel-head">
            <div><p className="eyebrow">THE LEADERBOARD</p><h3>Commander performance <span className="count-chip">{selected.entries.length}</span></h3></div>
            <div className="search-box"><Search size={16} /><input aria-label="Find commander" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Find commander…" />{query && <button className="search-clear" aria-label="Clear search" onClick={() => { setQuery(""); setPage(0); }}><X size={14} /></button>}</div>
          </div>
          <div className="leaderboard-filters" aria-label="Filter commanders">{([["all", "All commanders"], ["top", "Top 25"], ["review", `Needs review (${reviewCount})`]] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => { setFilter(id); setPage(0); }}>{label}</button>)}</div>
          <div className="table-scroll">
            <table className="ranking-table">
              <thead><tr><th>Rank</th><th>Commander</th><th>Points</th><th>Score change</th><th>Rank move</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td><span className={row.rank <= 3 ? `rank-badge top-${row.rank}` : "rank-badge"}>{row.rank}</span>{row.rankChange !== undefined && <span className="mobile-rank-move"><span className="sr-only">Rank change: </span><Delta value={row.rankChange} format={(value) => String(Math.abs(value))} /></span>}</td>
                    <td><div className="commander-cell"><span className="avatar-fallback">{row.displayName.slice(0, 1).toLocaleUpperCase()}</span>{row.memberId ? <button className="commander-link" onClick={() => onOpenMember(row.memberId!)}>{row.displayName}{row.needsReview && <i title="Name needs review">!</i>}</button> : <span>{row.displayName}{row.needsReview && <i title="Name needs review">!</i>}</span>}</div></td>
                    <td><strong>{full(row.points)}</strong><div className="score-bar"><span style={{ width: `${Math.max(4, row.points / maxPoints * 100)}%` }} /></div>{row.pointChange !== undefined && <span className="mobile-score-change"><span className="sr-only">Score change: </span><Delta value={row.pointChange} format={(value) => compact(Math.abs(value))} /></span>}</td>
                    <td><Delta value={row.pointChange} format={(value) => compact(Math.abs(value))} /></td>
                    <td><Delta value={row.rankChange} format={(value) => `${Math.abs(value)} place${Math.abs(value) === 1 ? "" : "s"}`} /></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5}><div className="leaderboard-empty"><Search size={22} /><strong>No commanders found</strong><span>Try another name or choose a different filter.</span></div></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span aria-live="polite">{rows.length ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, rows.length)} of ${rows.length} commanders` : "0 commanders"}</span><div><button className="icon-button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {pageCount}</span><button className="icon-button" aria-label="Next page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></div>
        </div>
        <aside className="dashboard-insights">
        <section className="panel coverage-panel">
          <div className="panel-head"><div><p className="eyebrow">ROSTER HEALTH</p><h3>Capture coverage</h3></div><Users size={18} /></div>
          <div className="coverage-body"><div className="coverage-ring" style={{ background: `conic-gradient(var(--blue) ${activeMembers.length ? coveredMembers / activeMembers.length * 100 : 0}%, var(--line) 0)` }}><strong>{activeMembers.length ? `${Math.round(coveredMembers / activeMembers.length * 100)}%` : "—"}</strong></div><div><strong>{coveredMembers}<span> / {activeMembers.length}</span></strong><p>active members on this board</p></div></div>
          <p className="coverage-note">{activeMembers.length === 0 ? "Add active members to track roster coverage." : coveredMembers === activeMembers.length ? "Every active member is accounted for." : `${activeMembers.length - coveredMembers} active members are missing from this capture.`}</p>
          <button className="text-action" onClick={() => onNavigate("members")}>Manage roster <ArrowRight size={14} /></button>
        </section>
        <section className="panel insight-panel">
          <div className="panel-head"><div><p className="eyebrow">DISTRIBUTION</p><h3>Score bands</h3></div></div>
          <ScoreBands entries={selected.entries} />
          <div className="insight-rule" />
          <p className="eyebrow">CAPTURE NOTE</p>
          <p className="capture-note">{selected.notes || "No note added for this snapshot."}</p>
          <button className="button secondary wide" onClick={() => exportDetailedSnapshot(selected, state)}><Download size={16} /> Detailed CSV</button>
          <button className="button secondary wide report-image-button" onClick={() => exportReportImage(selected, state)}><Share2 size={16} /> Shareable image</button>
        </section>
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

function CommanderProfile({ member, state, onClose }: { member: Member; state: TrackerState; onClose: () => void }) {
  const performance = memberPerformance(member, state.snapshots);
  const stormHistory = (state.operations?.stormEvents || []).flatMap((event) => {
    const participant = event.participants.find((item) => item.memberId === member.id);
    return participant ? [{ event, participant }] : [];
  }).sort((a, b) => b.event.battleAt.localeCompare(a.event.battleAt));
  const trainHistory = (state.operations?.trainAssignments || []).filter((assignment) => assignment.conductorMemberId === member.id || assignment.vipMemberId === member.id).sort((a, b) => b.date.localeCompare(a.date));
  const chartWidth = 560;
  const chartHeight = 150;
  const chartPadding = 16;
  const scores = performance.history.map((point) => point.points);
  const minScore = scores.length ? Math.min(...scores) : 0;
  const maxScore = scores.length ? Math.max(...scores) : 1;
  const scoreRange = Math.max(maxScore - minScore, 1);
  const chartPoints = performance.history.map((point, index) => ({
    ...point,
    x: performance.history.length === 1 ? chartWidth / 2 : chartPadding + index / (performance.history.length - 1) * (chartWidth - chartPadding * 2),
    y: chartPadding + (maxScore - point.points) / scoreRange * (chartHeight - chartPadding * 2),
  }));

  return (
    <div className="profile-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="commander-profile" role="dialog" aria-modal="true" aria-labelledby="commander-profile-title">
        <header className="profile-head">
          <div className="profile-identity">
            <MemberAvatar member={member} large />
            <div><p className="eyebrow">COMMANDER PROFILE</p><h2 id="commander-profile-title">{member.canonicalName}</h2><span className={`member-state ${member.active ? "active" : "departed"}`}>{member.active ? "Active roster" : "Previous record"}</span></div>
          </div>
          <button className="drawer-close" aria-label="Close commander profile" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="profile-body">
          {member.gameProfile && <section className="profile-metrics">
            <div><span>Hero power</span><strong>{member.gameProfile.heroPowerDisplay}</strong><small>{member.gameProfile.heroPower === null ? "Not available" : member.gameProfile.heroPowerLegacy ? "Legacy · older data" : "Rounded display"}</small></div>
            <div><span>Kills</span><strong>{member.gameProfile.killsDisplay}</strong><small>{member.gameProfile.kills === null ? "Not available" : "Rounded display"}</small></div>
            <div><span>Alliance rank</span><strong>{member.gameProfile.rank}</strong><small>LWServers profile</small></div>
            <div><span>Captured</span><strong className="profile-capture-date">{member.gameProfile.capturedOn}</strong><small>Saved snapshot</small></div>
          </section>}
          <section className="profile-metrics">
            <div><span>Latest score</span><strong>{performance.latest ? compact(performance.latest.points) : "—"}</strong><small>{performance.latest ? `${performance.latest.dayLabel} capture` : "No captures yet"}</small></div>
            <div><span>Best rank</span><strong>{performance.bestRank ? `#${performance.bestRank}` : "—"}</strong><small>{performance.appearances} appearance{performance.appearances === 1 ? "" : "s"}</small></div>
            <div><span>Average score</span><strong>{performance.appearances ? compact(performance.averagePoints) : "—"}</strong><small>Across recorded captures</small></div>
            <div><span>On-board rate</span><strong>{performance.eligibleCaptures ? `${Math.round(performance.participationRate)}%` : "—"}</strong><small>{performance.appearances}/{performance.eligibleCaptures} eligible captures</small></div>
          </section>

          <section className="profile-panel profile-chart-panel">
            <div className="profile-section-head"><div><p className="eyebrow">SCORE HISTORY</p><h3>Recorded performance</h3></div>{performance.history.length > 0 && <strong>{compact(performance.bestPoints)} best</strong>}</div>
            {chartPoints.length ? <>
              <svg className="score-history-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`Score history for ${member.canonicalName}`} preserveAspectRatio="none">
                <line x1="16" y1="16" x2="544" y2="16" />
                <line x1="16" y1="75" x2="544" y2="75" />
                <line x1="16" y1="134" x2="544" y2="134" />
                <polyline points={chartPoints.map((point) => `${point.x},${point.y}`).join(" ")} />
                {chartPoints.map((point) => <circle key={point.snapshotId} cx={point.x} cy={point.y} r="5" />)}
              </svg>
              <div className="chart-range"><span>{dateLabel(chartPoints[0].capturedAt)}</span><span>{dateLabel(chartPoints.at(-1)!.capturedAt)}</span></div>
            </> : <p className="empty-copy profile-empty">This commander has no linked ranking history yet.</p>}
          </section>

          <section className="profile-panel">
            <div className="profile-section-head"><div><p className="eyebrow">IDENTITY</p><h3>Roster details</h3></div></div>
            <dl className="profile-details">
              <div><dt>Known aliases</dt><dd>{member.aliases.length ? member.aliases.join(", ") : "None recorded"}</dd></div>
              <div><dt>Joined</dt><dd>{member.joinedAt || "Not recorded"}</dd></div>
              <div><dt>Left</dt><dd>{member.leftAt || "—"}</dd></div>
              <div><dt>Officer notes</dt><dd>{member.notes || "No notes"}</dd></div>
            </dl>
          </section>

          <section className="profile-panel profile-operations-panel">
            <div className="profile-section-head"><div><p className="eyebrow">OPERATIONS</p><h3>Storm and train history</h3></div></div>
            <div className="profile-operation-metrics">
              <div><span>Storm selections</span><strong>{stormHistory.filter(({ participant }) => participant.role !== "unassigned").length}</strong></div>
              <div><span>Storm attendance</span><strong>{stormHistory.filter(({ participant }) => participant.attendance === "attended" || participant.attendance === "substitute-used").length}</strong></div>
              <div><span>Trains conducted</span><strong>{trainHistory.filter((assignment) => assignment.conductorMemberId === member.id && assignment.status === "completed").length}</strong></div>
              <div><span>VIP / Guardian</span><strong>{trainHistory.filter((assignment) => assignment.vipMemberId === member.id && assignment.status === "completed").length}</strong></div>
            </div>
            <div className="profile-operation-list">
              {stormHistory.slice(0, 5).map(({ event, participant }) => <div key={`${event.id}-${member.id}`}><span>{event.battleAt.slice(0, 10)}</span><strong>{event.type === "desert" ? "Desert" : "Canyon"} · Team {event.team}</strong><small>{participant.role.replace("-", " ")} · {participant.attendance.replace("-", " ")}{participant.score !== undefined ? ` · ${full(participant.score)} pts` : ""}</small></div>)}
              {trainHistory.slice(0, 5).map((assignment) => <div key={`${assignment.id}-${member.id}`}><span>{assignment.date}</span><strong>{assignment.conductorMemberId === member.id ? "Train conductor" : assignment.vipType === "guardian-defender" ? "Guardian Defender" : "Special Guest"}</strong><small>{assignment.status}</small></div>)}
              {!stormHistory.length && !trainHistory.length && <p className="empty-copy">No operations history recorded yet.</p>}
            </div>
          </section>

          <section className="profile-panel profile-history-panel">
            <div className="profile-section-head"><div><p className="eyebrow">CAPTURE LOG</p><h3>Recent results</h3></div></div>
            <div className="profile-history-head"><span>Capture</span><span>Rank</span><span>Points</span><span>Vs prior</span></div>
            {[...performance.history].reverse().map((point) => <div className="profile-history-row" key={point.snapshotId}><span><strong>{point.dayLabel}</strong><small>{dateLabel(point.capturedAt)}</small></span><b>#{point.rank}</b><b>{compact(point.points)}</b><Delta value={point.pointChange} format={(value) => compact(Math.abs(value))} /></div>)}
            {!performance.history.length && <p className="empty-copy">No linked results to show.</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Importer({ state, setState, ocrConfigured, bridgeConfigured, editingSnapshot, onPublished }: { state: TrackerState; setState: (state: TrackerState) => void; ocrConfigured: boolean; bridgeConfigured: boolean; editingSnapshot?: Snapshot; onPublished: (snapshot: Snapshot) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Array<ExtractedRow & { memberId?: string; id?: string }>>(() => editingSnapshot?.entries || []);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [bridgeProgress, setBridgeProgress] = useState(0);
  const [bridgeJob, setBridgeJob] = useState<BridgeJobView>();
  const [bridgeLoadFailed, setBridgeLoadFailed] = useState(false);
  const [retryingBridge, setRetryingBridge] = useState(false);
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(editingSnapshot?.capturedAt.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<"live" | "final">(editingSnapshot?.status || "live");
  const [sourceType, setSourceType] = useState<Snapshot["sourceType"]>(editingSnapshot?.sourceType || "screenshots");
  const [notes, setNotes] = useState(editingSnapshot?.notes || "");
  const [snapshotId] = useState<string | undefined>(editingSnapshot?.id);
  const input = useRef<HTMLInputElement>(null);
  const localImportInput = useRef<HTMLInputElement>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  const loadedBridgeJobId = useRef<string | undefined>(undefined);
  const scrollToReviewAfterLoad = useRef(false);
  const diagnosticWarnings = useMemo(() => rows.length ? analyzeImport(rows, state.members) : [], [rows, state.members]);
  const changeWarnings = useMemo(() => rows.length && date ? analyzeLargeChanges(rows, state.members, state.snapshots, date, status) : [], [rows, state.members, state.snapshots, date, status]);
  const allWarnings = [...new Set([...warnings, ...diagnosticWarnings, ...changeWarnings])];
  const linkedMemberIds = new Set(rows.map((row) => row.memberId || matchMember(row.displayName, state.members)?.id).filter(Boolean));
  const missingActive = state.members.filter((member) => member.active && !linkedMemberIds.has(member.id)).length;
  const unmatched = rows.filter((row) => !row.memberId && !matchMember(row.displayName, state.members)).length;

  const loadRowsFromBridge = useCallback((job: BridgeJobView) => {
    if (!job.rows?.length || loadedBridgeJobId.current === job.id) return;
    try {
      const merged = dedupeRows(job.rows);
      loadedBridgeJobId.current = job.id;
      scrollToReviewAfterLoad.current = window.matchMedia("(max-width: 760px)").matches;
      setRows(merged.rows);
      setWarnings(merged.warnings);
      setSourceType("local-codex");
      setFiles([]);
      setBridgeLoadFailed(false);
    } catch {
      setBridgeLoadFailed(true);
      setError("Could not load the extracted rows. Refresh and try again.");
    }
  }, []);

  const receiveBridgeJob = useCallback((job: BridgeJobView) => {
    setBridgeJob(job);
    if (job.status === "completed") loadRowsFromBridge(job);
  }, [loadRowsFromBridge]);

  useEffect(() => {
    if (!bridgeConfigured || snapshotId) return;
    const activeJobId = window.localStorage.getItem(bridgeJobStorageKey);
    if (!activeJobId) return;
    let active = true;
    fetch(`/api/bridge/jobs?id=${encodeURIComponent(activeJobId)}`)
      .then((response) => response.ok ? response.json() : undefined)
      .then((body) => {
        if (active && body?.job) receiveBridgeJob(body.job as BridgeJobView);
        else if (active) window.localStorage.removeItem(bridgeJobStorageKey);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bridgeConfigured, receiveBridgeJob, snapshotId]);

  useEffect(() => {
    if (!bridgeConfigured || !bridgeJob || !["pending", "processing"].includes(bridgeJob.status)) return;
    let active = true;
    const refresh = async () => {
      const response = await fetch(`/api/bridge/jobs?id=${encodeURIComponent(bridgeJob.id)}`);
      if (!response.ok) return;
      const body = await response.json();
      if (active) receiveBridgeJob(body.job as BridgeJobView);
    };
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bridgeConfigured, bridgeJob, receiveBridgeJob]);

  useEffect(() => {
    if (!rows.length || !scrollToReviewAfterLoad.current) return;
    scrollToReviewAfterLoad.current = false;
    const frame = window.requestAnimationFrame(() => reviewPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [rows]);

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

  async function queueForLocalCodex() {
    if (!files.length || !bridgeConfigured) return;
    setQueueing(true); setError(""); setBridgeProgress(0);
    try {
      const jobId = crypto.randomUUID();
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const uploadedBytes = new Map<number, number>();
      const uploadedFiles: Array<{ id: string; name: string; pathname: string; contentType: string; size: number }> = [];
      for (let start = 0; start < files.length; start += 5) {
        const batch = files.slice(start, start + 5);
        const results = await Promise.all(batch.map(async (file, batchIndex) => {
          const index = start + batchIndex;
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          const id = `frame-${String(index + 1).padStart(2, "0")}`;
          const pathname = `bridge-uploads/${jobId}/${id}-${safeName}`;
          const blob = await upload(pathname, file, {
            access: "private",
            handleUploadUrl: "/api/bridge/upload",
            clientPayload: JSON.stringify({ jobId }),
            onUploadProgress: (progress) => {
              uploadedBytes.set(index, progress.loaded);
              const loaded = [...uploadedBytes.values()].reduce((total, value) => total + value, 0);
              setBridgeProgress(Math.min(99, Math.round((loaded / totalBytes) * 100)));
            },
          });
          return { id, name: file.name, pathname: blob.pathname, contentType: blob.contentType, size: file.size };
        }));
        uploadedFiles.push(...results);
      }
      const response = await fetch("/api/bridge/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: jobId, files: uploadedFiles }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create the PC bridge job.");
      setBridgeProgress(100);
      setBridgeJob(body.job as BridgeJobView);
      window.localStorage.setItem(bridgeJobStorageKey, jobId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not queue this capture for the PC worker.");
    } finally {
      setQueueing(false);
    }
  }

  async function retryBridgeExtraction() {
    if (!bridgeJob || bridgeJob.status !== "failed") return;
    setRetryingBridge(true);
    setError("");
    try {
      const response = await fetch("/api/bridge/jobs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: bridgeJob.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not retry this extraction.");
      receiveBridgeJob(body.job as BridgeJobView);
      window.localStorage.setItem(bridgeJobStorageKey, bridgeJob.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not retry this extraction.");
    } finally {
      setRetryingBridge(false);
    }
  }

  function loadBridgeResults() {
    if (bridgeJob) loadRowsFromBridge(bridgeJob);
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

  async function importLocalExtraction(file?: File) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 2_000_000) throw new Error("The Codex JSON file is unexpectedly large.");
      const parsed = parseLocalExtractionText(await file.text());
      const merged = dedupeRows(parsed);
      setRows(merged.rows);
      setWarnings(merged.warnings);
      setSourceType("local-codex");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import the Codex extraction file.");
    } finally {
      if (localImportInput.current) localImportInput.current.value = "";
    }
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
    else {
      if (bridgeJob?.id) window.localStorage.removeItem(bridgeJobStorageKey);
      setState(body.state);
      onPublished(body.snapshot);
    }
    setBusy(false);
  }

  return (
    <div className="page-stack narrow-page">
      <section className="section-heading"><div><p className="eyebrow">{snapshotId ? "EDIT SNAPSHOT" : "NEW CAPTURE"}</p><h2>{snapshotId ? "Correct published results" : "Import weekly rankings"}</h2><p>Upload screenshots for cloud extraction, import a local Codex result, or paste rows manually.</p></div></section>
      {!ocrConfigured && <div className="review-banner warning"><CircleAlert size={18} /><span><strong>Cloud extraction is not configured.</strong> You can still import Codex JSON generated on an officer&apos;s computer or paste rows manually.</span></div>}
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
          <button className="button primary wide" disabled={!files.length || busy || queueing || preparingVideo || !ocrConfigured} onClick={extract}>{busy ? `Reading ${files.length} frame${files.length === 1 ? "" : "s"}…` : <><Sparkles size={16} /> Extract with cloud API</>}</button>
          {bridgeConfigured && <button className="button secondary wide" disabled={!files.length || busy || queueing || preparingVideo} onClick={queueForLocalCodex}>{queueing ? `Uploading frames… ${bridgeProgress}%` : <><Cloud size={16} /> Queue for PC Codex</>}</button>}
          {queueing && <div className="bridge-progress" aria-label={`Upload ${bridgeProgress}% complete`}><span style={{ width: `${bridgeProgress}%` }} /></div>}
          {bridgeJob && <div className={`bridge-status ${bridgeJob.status}`}>
            <strong>{bridgeJob.status === "pending" ? "Waiting for PC worker" : bridgeJob.status === "processing" ? "Codex is reading the frames" : bridgeJob.status === "completed" ? `${bridgeJob.rows?.length || 0} rows ready` : "Bridge extraction failed"}</strong>
            <span>{bridgeJob.status === "pending" ? "Start npm run bridge:worker on the PC." : bridgeJob.status === "processing" ? `Attempt ${bridgeJob.attempts} · this page updates automatically.` : bridgeJob.status === "completed" ? "Loaded automatically below. Review the rows before publishing." : bridgeJob.error}</span>
            {bridgeJob.status === "completed" && bridgeLoadFailed && <button className="button secondary wide" onClick={loadBridgeResults}><FileJson size={16} /> Retry loading rows</button>}
            {bridgeJob.status === "failed" && <button className="button secondary wide" disabled={retryingBridge} onClick={retryBridgeExtraction}><Sparkles size={16} /> {retryingBridge ? "Requeueing…" : "Retry retained upload"}</button>}
          </div>}
          {!bridgeConfigured && <p className="bridge-unavailable">The PC bridge appears after private Blob storage and a worker secret are configured.</p>}
        </div>
        <div className="panel manual-paste">
          <p className="eyebrow">LOCAL CODEX</p><h3>Import an extracted JSON file</h3><p>Generate it on a signed-in computer with <code>npm run extract:local</code>. Screenshots never pass through Vercel.</p>
          <input ref={localImportInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importLocalExtraction(event.target.files?.[0])} />
          <button className="button secondary wide" onClick={() => localImportInput.current?.click()}><FileJson size={16} /> Import Codex JSON</button>
          <div className="import-divider"><span>or paste manually</span></div>
          <p>Accepts CSV or tab-separated rank, name and points.</p><textarea value={manual} onChange={(event) => setManual(event.target.value)} placeholder={'1,Super McNasty,74,831,650\n2,Retired Goblin,49,744,827'} /><button className="button secondary wide" disabled={!manual.trim()} onClick={parseManual}>Build review table</button>
        </div>
      </section>}
      {error && <div className="form-error-box"><CircleAlert size={17} />{error}</div>}
      {allWarnings.length > 0 && <div className="warning-list">{allWarnings.slice(0, 12).map((warning) => <span key={warning}><CircleAlert size={14} />{warning}</span>)}</div>}
      {rows.length > 0 && <section ref={reviewPanel} className="panel review-panel">
        <div className="panel-head"><div><p className="eyebrow">HUMAN REVIEW</p><h3>{rows.length} extracted rows</h3></div><span className="retention-note">{unmatched} unmatched · {missingActive} active members not on board · originals expire after 5 days</span></div>
        <div className="table-scroll"><table className="review-table"><thead><tr><th>Rank</th><th>Commander as shown</th><th>Points</th><th>Identity</th><th /></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.rank}-${index}`} className={row.needsReview || row.confidence < .86 || (!row.memberId && !matchMember(row.displayName, state.members)) ? "needs-review" : ""}><td data-label="Rank"><input className="tiny" type="number" value={row.rank} onChange={(event) => updateRow(index, { rank: Number(event.target.value) })} /></td><td data-label="Commander"><input value={row.displayName} onChange={(event) => updateRow(index, { displayName: event.target.value })} /></td><td data-label="Points"><input className="points-input" inputMode="numeric" value={row.points} onChange={(event) => updateRow(index, { points: Number(event.target.value.replace(/\D/g, "")) })} /></td><td data-label="Matched identity"><select value={row.memberId || matchMember(row.displayName, state.members)?.id || ""} onChange={(event) => updateRow(index, { memberId: event.target.value || undefined })}><option value="">Create as a new member</option>{[...state.members].sort((a, b) => Number(b.active) - Number(a.active) || a.canonicalName.localeCompare(b.canonicalName)).map((member) => <option key={member.id} value={member.id}>{member.active ? "" : "[Departed] "}{member.canonicalName}</option>)}</select></td><td><button className="icon-button" title="Remove row" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={15} /></button></td></tr>)}</tbody></table></div>
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

function Snapshots({ snapshots, onOpen, onEdit, onDelete }: { snapshots: Snapshot[]; onOpen: (snapshot: Snapshot) => void; onEdit: (snapshot: Snapshot) => void; onDelete: (snapshot: Snapshot) => Promise<void> }) {
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  async function removeSnapshot(snapshot: Snapshot) {
    const confirmed = window.confirm(
      `Delete the ${snapshot.dayLabel} capture from ${dateLabel(snapshot.capturedAt)}?\n\nThis removes its ranking results and comparisons. Roster members will not be deleted.`,
    );
    if (!confirmed) return;
    setDeletingId(snapshot.id);
    setError("");
    try {
      await onDelete(snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this snapshot.");
    } finally {
      setDeletingId("");
    }
  }

  const ordered = [...snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return <div className="page-stack narrow-page"><section className="section-heading"><div><p className="eyebrow">HISTORY</p><h2>Recorded snapshots</h2><p>Live captures compare with the same weekday; Saturday finals compare week over week.</p></div></section>{error && <div className="form-error-box"><CircleAlert size={17} />{error}</div>}<div className="snapshot-list">{ordered.length ? ordered.map((snapshot) => { const total = snapshot.entries.reduce((sum, entry) => sum + entry.points, 0); const deleting = deletingId === snapshot.id; return <article className="panel snapshot-card" key={snapshot.id}><div className="snapshot-date"><span>{new Date(snapshot.capturedAt).getUTCDate()}</span><small>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(snapshot.capturedAt))}</small></div><div className="snapshot-card-main"><div><span className={`status-pill ${snapshot.status}`}>{snapshot.status}</span><strong>{snapshot.dayLabel} capture</strong></div><p>{snapshot.entries.length} ranked · {compact(total)} total points</p><small>{snapshot.notes || "No capture note"}</small></div><div className="snapshot-actions"><button className="button ghost" disabled={deleting} onClick={() => exportSnapshot(snapshot)}><Download size={15} /> CSV</button><button className="button ghost" disabled={deleting} onClick={() => onEdit(snapshot)}><PencilLine size={15} /> Edit</button><button className="button danger" disabled={Boolean(deletingId)} onClick={() => removeSnapshot(snapshot)}><Trash2 size={15} /> {deleting ? "Deleting…" : "Delete"}</button><button className="button secondary" disabled={deleting} onClick={() => onOpen(snapshot)}>Open</button></div></article>; }) : <section className="panel"><p className="empty-copy">No snapshots have been published yet.</p></section>}</div></div>;
}
