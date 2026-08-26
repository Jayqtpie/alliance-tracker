"use client";

import {
  CalendarClock,
  ClipboardCopy,
  Plus,
  RotateCw,
  Save,
  ShieldCheck,
  Swords,
  TrainFront,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, applyGuardianRotation, assignmentsForWeek, hydrateOperations, mondayFor } from "@/lib/operations";
import type {
  Member,
  OperationsState,
  StormAttendance,
  StormAvailability,
  StormEvent,
  StormParticipant,
  StormRole,
  TrackerState,
  TrainAssignment,
  TrainInvitationStatus,
  TrainStatus,
  TrainVipType,
} from "@/lib/types";

type OperationsTab = "storm" | "train";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function memberSort(a: Member, b: Member) {
  return Number(b.active) - Number(a.active) || a.canonicalName.localeCompare(b.canonicalName, undefined, { sensitivity: "base" });
}

function emptyParticipant(memberId: string): StormParticipant {
  return { memberId, availability: "no-response", role: "unassigned", confirmed: false, attendance: "unknown" };
}

function emptyTrain(date: string): TrainAssignment {
  return {
    id: crypto.randomUUID(),
    date,
    vipType: "none",
    invitationStatus: "not-sent",
    status: "planned",
  };
}

function memberName(members: Member[], id?: string) {
  if (!id) return "Unassigned";
  return members.find((member) => member.id === id)?.canonicalName || "Former member";
}

function MemberSelect({ members, value, onChange, placeholder = "Unassigned" }: { members: Member[]; value?: string; onChange: (value?: string) => void; placeholder?: string }) {
  return (
    <select value={value || ""} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">{placeholder}</option>
      {members.map((member) => <option key={member.id} value={member.id}>{member.active ? "" : "[Departed] "}{member.canonicalName}</option>)}
    </select>
  );
}

export function Operations({ state, setState, notify, onOpenMember }: { state: TrackerState; setState: (state: TrackerState) => void; notify: (message: string) => void; onOpenMember: (id: string) => void }) {
  const [tab, setTab] = useState<OperationsTab>("storm");
  const [operations, setOperations] = useState<OperationsState>(() => hydrateOperations(state.operations));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const members = useMemo(() => [...state.members].sort(memberSort), [state.members]);

  async function save(next = operations, message = "Operations saved.") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save operations.");
      setState(body);
      setOperations(hydrateOperations(body.operations));
      notify(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save operations.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack operations-page">
      <section className="section-heading">
        <div><p className="eyebrow">ALLIANCE OPERATIONS</p><h2>Storm and train management</h2><p>Plan leadership assignments, lock teams and keep a fair weekly record.</p></div>
        <button className="button primary" disabled={busy} onClick={() => save()}><Save size={15} />{busy ? "Saving…" : "Save operations"}</button>
      </section>
      {error && <div className="form-error-box">{error}</div>}
      <div className="operations-tabs" role="tablist" aria-label="Operations modules">
        <button className={tab === "storm" ? "active" : ""} onClick={() => setTab("storm")}><Swords size={17} />Storm planner</button>
        <button className={tab === "train" ? "active" : ""} onClick={() => setTab("train")}><TrainFront size={17} />Train rotation</button>
      </div>
      {tab === "storm" ? (
        <StormPlanner operations={operations} setOperations={setOperations} members={members} onOpenMember={onOpenMember} />
      ) : (
        <TrainPlanner operations={operations} setOperations={setOperations} members={members} notify={notify} />
      )}
    </div>
  );
}

function StormPlanner({ operations, setOperations, members, onOpenMember }: { operations: OperationsState; setOperations: (operations: OperationsState) => void; members: Member[]; onOpenMember: (id: string) => void }) {
  const ordered = useMemo(() => [...operations.stormEvents].sort((a, b) => b.battleAt.localeCompare(a.battleAt)), [operations.stormEvents]);
  const [selectedId, setSelectedId] = useState(ordered[0]?.id || "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "available" | "selected">("all");
  const selected = operations.stormEvents.find((event) => event.id === selectedId) || ordered[0];

  function addEvent() {
    const date = addDays(today(), 4);
    const event: StormEvent = {
      id: crypto.randomUUID(), type: "desert", team: "A", battleAt: `${date}T20:00`, status: "draft",
      starterLimit: 20, substituteLimit: 10, result: "unknown", participants: [],
    };
    setOperations({ ...operations, stormEvents: [...operations.stormEvents, event] });
    setSelectedId(event.id);
  }

  function updateEvent(patch: Partial<StormEvent>) {
    if (!selected) return;
    setOperations({ ...operations, stormEvents: operations.stormEvents.map((event) => event.id === selected.id ? { ...event, ...patch } : event) });
  }

  function updateParticipant(memberId: string, patch: Partial<StormParticipant>) {
    if (!selected) return;
    const current = selected.participants.find((participant) => participant.memberId === memberId) || emptyParticipant(memberId);
    const participant = { ...current, ...patch };
    const participants = selected.participants.some((item) => item.memberId === memberId)
      ? selected.participants.map((item) => item.memberId === memberId ? participant : item)
      : [...selected.participants, participant];
    updateEvent({ participants });
  }

  function removeEvent() {
    if (!selected || !window.confirm(`Delete this ${selected.type} Storm plan and its attendance history?`)) return;
    const remaining = operations.stormEvents.filter((event) => event.id !== selected.id);
    setOperations({ ...operations, stormEvents: remaining });
    setSelectedId(remaining[0]?.id || "");
  }

  async function copyRoster() {
    if (!selected) return;
    const starters = selected.participants.filter((participant) => participant.role === "starter");
    const substitutes = selected.participants.filter((participant) => participant.role === "substitute");
    const lines = [
      `${selected.type === "desert" ? "Desert" : "Canyon"} Storm · Team ${selected.team} · ${selected.battleAt.replace("T", " ")}`,
      `Starters (${starters.length}/${selected.starterLimit})`,
      ...starters.map((participant, index) => `${index + 1}. ${memberName(members, participant.memberId)}${participant.assignment ? ` — ${participant.assignment}` : ""}`),
      ``, `Substitutes (${substitutes.length}/${selected.substituteLimit})`,
      ...substitutes.map((participant, index) => `${index + 1}. ${memberName(members, participant.memberId)}`),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
  }

  if (!selected) {
    return <section className="panel operations-empty"><Swords size={34} /><h3>No Storm events yet</h3><p>Create the first Desert or Canyon Storm plan.</p><button className="button primary" onClick={addEvent}><Plus size={15} />Create event</button></section>;
  }

  const participantById = new Map(selected.participants.map((participant) => [participant.memberId, participant]));
  const visibleMembers = members.filter((member) => {
    const participant = participantById.get(member.id) || emptyParticipant(member.id);
    const matches = [member.canonicalName, ...member.aliases].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase());
    if (!matches) return false;
    if (filter === "available") return participant.availability === "available" || participant.availability === "maybe";
    if (filter === "selected") return participant.role !== "unassigned";
    return member.active;
  });
  const starters = selected.participants.filter((participant) => participant.role === "starter").length;
  const substitutes = selected.participants.filter((participant) => participant.role === "substitute").length;
  const available = selected.participants.filter((participant) => participant.availability === "available").length;
  const noShows = selected.participants.filter((participant) => participant.attendance === "no-show").length;

  return <div className="operations-stack">
    <section className="panel storm-event-switcher">
      <label><span>Storm event</span><select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{ordered.map((event) => <option key={event.id} value={event.id}>{event.type === "desert" ? "Desert" : "Canyon"} · Team {event.team} · {event.battleAt.slice(0, 10)}</option>)}</select></label>
      <button className="button secondary" onClick={addEvent}><Plus size={15} />New event</button>
      <button className="button danger" onClick={removeEvent}><Trash2 size={15} />Delete</button>
    </section>
    <section className="panel storm-details">
      <div className="panel-head"><div><p className="eyebrow">EVENT SETUP</p><h3>{selected.type === "desert" ? "Desert" : "Canyon"} Storm · Team {selected.team}</h3></div><span className={`operation-status ${selected.status}`}>{selected.status.replace("-", " ")}</span></div>
      <div className="storm-form-grid">
        <label><span>Storm</span><select value={selected.type} onChange={(event) => updateEvent({ type: event.target.value as StormEvent["type"] })}><option value="desert">Desert Storm</option><option value="canyon">Canyon Storm</option></select></label>
        <label><span>Team</span><select value={selected.team} onChange={(event) => updateEvent({ team: event.target.value as "A" | "B" })}><option>A</option><option>B</option></select></label>
        <label><span>Battle time</span><input type="datetime-local" value={selected.battleAt} onChange={(event) => updateEvent({ battleAt: event.target.value })} /></label>
        <label><span>Registration deadline</span><input type="datetime-local" value={selected.registrationDeadline || ""} onChange={(event) => updateEvent({ registrationDeadline: event.target.value || undefined })} /></label>
        <label><span>Status</span><select value={selected.status} onChange={(event) => updateEvent({ status: event.target.value as StormEvent["status"] })}><option value="draft">Draft</option><option value="registration-open">Registration open</option><option value="locked">Locked</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
        <label><span>Opponent</span><input value={selected.opponent || ""} onChange={(event) => updateEvent({ opponent: event.target.value || undefined })} placeholder="Alliance or server" /></label>
        <label><span>Starter limit</span><input type="number" min="1" max="50" value={selected.starterLimit} onChange={(event) => updateEvent({ starterLimit: Number(event.target.value) })} /></label>
        <label><span>Substitute limit</span><input type="number" min="0" max="50" value={selected.substituteLimit} onChange={(event) => updateEvent({ substituteLimit: Number(event.target.value) })} /></label>
        <label><span>Result</span><select value={selected.result || "unknown"} onChange={(event) => updateEvent({ result: event.target.value as StormEvent["result"] })}><option value="unknown">Not recorded</option><option value="win">Win</option><option value="loss">Loss</option><option value="draw">Draw</option></select></label>
        <label><span>Alliance score</span><input inputMode="numeric" value={selected.allianceScore ?? ""} onChange={(event) => updateEvent({ allianceScore: event.target.value ? Number(event.target.value.replace(/\D/g, "")) : undefined })} /></label>
        <label><span>Opponent score</span><input inputMode="numeric" value={selected.opponentScore ?? ""} onChange={(event) => updateEvent({ opponentScore: event.target.value ? Number(event.target.value.replace(/\D/g, "")) : undefined })} /></label>
        <label className="wide-field"><span>Officer notes / battle plan</span><textarea value={selected.officerNotes || ""} onChange={(event) => updateEvent({ officerNotes: event.target.value || undefined })} placeholder="Assignments, rally leads, building priorities…" /></label>
      </div>
    </section>
    <section className="operation-metrics">
      <div><UsersRound size={18} /><span>Available<strong>{available}</strong></span></div>
      <div className={starters > selected.starterLimit ? "warning" : ""}><Swords size={18} /><span>Starters<strong>{starters}/{selected.starterLimit}</strong></span></div>
      <div className={substitutes > selected.substituteLimit ? "warning" : ""}><ShieldCheck size={18} /><span>Substitutes<strong>{substitutes}/{selected.substituteLimit}</strong></span></div>
      <div className={noShows ? "warning" : ""}><CalendarClock size={18} /><span>No-shows<strong>{noShows}</strong></span></div>
    </section>
    <section className="panel storm-roster-panel">
      <div className="panel-head storm-roster-tools"><div><p className="eyebrow">TEAM SELECTION</p><h3>{visibleMembers.length} commanders</h3></div><div className="operation-toolbar"><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Active roster</option><option value="available">Available / maybe</option><option value="selected">Selected only</option></select><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search member" /><button className="button secondary" onClick={copyRoster}><ClipboardCopy size={14} />Copy roster</button></div></div>
      <div className="storm-roster-list">
        {visibleMembers.map((member) => {
          const participant = participantById.get(member.id) || emptyParticipant(member.id);
          return <article className={`storm-member ${participant.role !== "unassigned" ? "selected" : ""}`} key={member.id}>
            <button className="storm-member-name" onClick={() => onOpenMember(member.id)}><span>{member.canonicalName.slice(0, 1).toLocaleUpperCase()}</span><strong>{member.canonicalName}</strong></button>
            <label><span>Availability</span><select value={participant.availability} onChange={(event) => updateParticipant(member.id, { availability: event.target.value as StormAvailability })}><option value="no-response">No response</option><option value="available">Available</option><option value="maybe">Maybe</option><option value="unavailable">Unavailable</option></select></label>
            <label><span>Selection</span><select value={participant.role} onChange={(event) => updateParticipant(member.id, { role: event.target.value as StormRole })}><option value="unassigned">Not selected</option><option value="starter">Starter</option><option value="substitute">Substitute</option><option value="reserve">Reserve</option></select></label>
            <label><span>Assignment</span><input value={participant.assignment || ""} onChange={(event) => updateParticipant(member.id, { assignment: event.target.value || undefined })} placeholder="Building / role" /></label>
            <label><span>Attendance</span><select value={participant.attendance} onChange={(event) => updateParticipant(member.id, { attendance: event.target.value as StormAttendance })}><option value="unknown">Not recorded</option><option value="attended">Attended</option><option value="substitute-used">Sub used</option><option value="no-show">No-show</option><option value="late-cancel">Late cancel</option></select></label>
            <label><span>Score</span><input inputMode="numeric" value={participant.score ?? ""} onChange={(event) => updateParticipant(member.id, { score: event.target.value ? Number(event.target.value.replace(/\D/g, "")) : undefined })} /></label>
            <label className="storm-confirm"><input type="checkbox" checked={participant.confirmed} onChange={(event) => updateParticipant(member.id, { confirmed: event.target.checked })} /><span>Confirmed</span></label>
          </article>;
        })}
      </div>
    </section>
  </div>;
}

function TrainPlanner({ operations, setOperations, members, notify }: { operations: OperationsState; setOperations: (operations: OperationsState) => void; members: Member[]; notify: (message: string) => void }) {
  const [weekStart, setWeekStart] = useState(mondayFor(today()));
  const activeMembers = members.filter((member) => member.active);
  const weekAssignments = assignmentsForWeek(operations.trainAssignments, weekStart);
  const byDate = new Map(weekAssignments.map((assignment) => [assignment.date, assignment]));
  const duplicateGuardians = operations.guardianPool.length !== new Set(operations.guardianPool).size;

  function updateGuardian(index: number, memberId?: string) {
    const pool = [...operations.guardianPool];
    if (memberId) pool[index] = memberId;
    else pool.splice(index, 1);
    setOperations({ ...operations, guardianPool: pool.filter(Boolean).slice(0, 7) });
  }

  function updateAssignment(date: string, patch: Partial<TrainAssignment>) {
    const current = byDate.get(date) || emptyTrain(date);
    const next = { ...current, ...patch };
    const assignments = operations.trainAssignments.some((assignment) => assignment.date === date)
      ? operations.trainAssignments.map((assignment) => assignment.date === date ? next : assignment)
      : [...operations.trainAssignments, next];
    setOperations({ ...operations, trainAssignments: assignments.sort((a, b) => a.date.localeCompare(b.date)) });
  }

  function generateRotation() {
    if (operations.guardianPool.length !== 7 || duplicateGuardians) return;
    setOperations(applyGuardianRotation(operations, weekStart));
    notify("Guardian rotation applied. Save operations when the schedule is ready.");
  }

  async function copySchedule() {
    const lines = [`RSCL TRAIN SCHEDULE · Week of ${weekStart}`];
    Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).forEach((date) => {
      const assignment = byDate.get(date);
      const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
      lines.push(`${day}: Conductor — ${memberName(members, assignment?.conductorMemberId)} | ${assignment?.vipType === "guardian-defender" ? "Guardian" : assignment?.vipType === "special-guest" ? "Special Guest" : "VIP"} — ${memberName(members, assignment?.vipMemberId)}`);
    });
    await navigator.clipboard.writeText(lines.join("\n"));
    notify("Train schedule copied.");
  }

  const history = [...operations.trainAssignments].filter((assignment) => assignment.date < weekStart).sort((a, b) => b.date.localeCompare(a.date));
  const conductorStats = activeMembers.map((member) => ({
    member,
    conducted: operations.trainAssignments.filter((assignment) => assignment.conductorMemberId === member.id && assignment.status === "completed").length,
    vip: operations.trainAssignments.filter((assignment) => assignment.vipMemberId === member.id && assignment.status === "completed").length,
    last: operations.trainAssignments.filter((assignment) => assignment.conductorMemberId === member.id).sort((a, b) => b.date.localeCompare(a.date))[0]?.date,
  })).sort((a, b) => a.conducted - b.conducted || (a.last || "").localeCompare(b.last || "") || a.member.canonicalName.localeCompare(b.member.canonicalName));

  return <div className="operations-stack">
    <section className="panel guardian-panel">
      <div className="panel-head"><div><p className="eyebrow">GUARDIAN POOL</p><h3>Seven strongest defenders</h3></div><span className={`pool-count ${operations.guardianPool.length === 7 && !duplicateGuardians ? "ready" : ""}`}>{operations.guardianPool.length}/7 assigned</span></div>
      <div className="guardian-grid">
        {Array.from({ length: 7 }, (_, index) => <label key={index}><span>Day {index + 1}</span><MemberSelect members={activeMembers.filter((member) => !operations.guardianPool.includes(member.id) || operations.guardianPool[index] === member.id)} value={operations.guardianPool[index]} onChange={(value) => updateGuardian(index, value)} placeholder="Choose Guardian" /></label>)}
      </div>
      <div className="guardian-actions"><p>{duplicateGuardians ? "Every position must use a different member." : operations.guardianPool.length < 7 ? "Fill all seven positions before generating the week." : "One Guardian Defender will be assigned to each day, Monday through Sunday."}</p><button className="button secondary" disabled={operations.guardianPool.length !== 7 || duplicateGuardians} onClick={generateRotation}><RotateCw size={15} />Apply to week</button></div>
    </section>
    <section className="panel train-week-panel">
      <div className="panel-head train-week-head"><div><p className="eyebrow">WEEKLY SCHEDULE</p><h3>Conductors and VIP invitations</h3></div><div className="operation-toolbar"><label className="week-picker"><span>Week starting</span><input type="date" value={weekStart} onChange={(event) => setWeekStart(mondayFor(event.target.value))} /></label><button className="button secondary" onClick={copySchedule}><ClipboardCopy size={14} />Copy schedule</button></div></div>
      <div className="train-week-grid">
        {Array.from({ length: 7 }, (_, index) => {
          const date = addDays(weekStart, index);
          const assignment = byDate.get(date) || emptyTrain(date);
          const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
          const sameMember = assignment.conductorMemberId && assignment.conductorMemberId === assignment.vipMemberId;
          return <article className={`train-day-card ${sameMember ? "warning" : ""}`} key={date}>
            <header><div><strong>{day}</strong><span>{date}</span></div><select aria-label={`${day} status`} value={assignment.status} onChange={(event) => updateAssignment(date, { status: event.target.value as TrainStatus })}><option value="planned">Planned</option><option value="completed">Completed</option><option value="reassigned">Reassigned</option><option value="skipped">Skipped</option></select></header>
            {sameMember && <p className="train-warning">Conductor and VIP must be different members.</p>}
            <label><span>Conductor</span><MemberSelect members={activeMembers} value={assignment.conductorMemberId} onChange={(value) => updateAssignment(date, { conductorMemberId: value })} /></label>
            <label><span>VIP invitation</span><select value={assignment.vipType} onChange={(event) => updateAssignment(date, { vipType: event.target.value as TrainVipType, vipMemberId: event.target.value === "none" ? undefined : assignment.vipMemberId })}><option value="none">No invitation</option><option value="guardian-defender">Guardian Defender</option><option value="special-guest">Special Guest</option></select></label>
            {assignment.vipType !== "none" && <label><span>{assignment.vipType === "guardian-defender" ? "Guardian" : "Special Guest"}</span><MemberSelect members={activeMembers.filter((member) => member.id !== assignment.conductorMemberId)} value={assignment.vipMemberId} onChange={(value) => updateAssignment(date, { vipMemberId: value })} /></label>}
            <label><span>Invitation</span><select value={assignment.invitationStatus} onChange={(event) => updateAssignment(date, { invitationStatus: event.target.value as TrainInvitationStatus })}><option value="not-sent">Not sent</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="expired">Expired</option></select></label>
            <label><span>Backup</span><MemberSelect members={activeMembers.filter((member) => member.id !== assignment.conductorMemberId && member.id !== assignment.vipMemberId)} value={assignment.backupMemberId} onChange={(value) => updateAssignment(date, { backupMemberId: value })} /></label>
            <label><span>Officer notes</span><input value={assignment.notes || ""} onChange={(event) => updateAssignment(date, { notes: event.target.value || undefined })} placeholder="Reward reason, reassignment…" /></label>
          </article>;
        })}
      </div>
    </section>
    <section className="operations-lower-grid">
      <div className="panel fairness-panel"><div className="panel-head"><div><p className="eyebrow">FAIRNESS</p><h3>Conductor history</h3></div></div><div className="fairness-list"><div className="fairness-row head"><span>Commander</span><b>Trains</b><b>VIP</b><span>Last train</span></div>{conductorStats.slice(0, 20).map(({ member, conducted, vip, last }) => <div className="fairness-row" key={member.id}><strong>{member.canonicalName}</strong><b>{conducted}</b><b>{vip}</b><span>{last || "Never"}</span></div>)}</div></div>
      <div className="panel train-history-panel"><div className="panel-head"><div><p className="eyebrow">HISTORY</p><h3>Previous assignments</h3></div></div><div className="train-history-list">{history.length ? history.slice(0, 16).map((assignment) => <div key={assignment.id}><span>{assignment.date}</span><strong>{memberName(members, assignment.conductorMemberId)}</strong><small>{assignment.vipType === "guardian-defender" ? "Guardian" : assignment.vipType === "special-guest" ? "Special Guest" : "No VIP"}: {memberName(members, assignment.vipMemberId)}</small><i>{assignment.status}</i></div>) : <p className="empty-copy">Completed weeks will appear here.</p>}</div></div>
    </section>
  </div>;
}
