import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StormImportReview } from "./storm-import";
import { StormLineupsView } from "./storm-lineups";
import type { BridgeJobView } from "@/lib/bridge-types";
import type { ExtractedRow, Member, StormWeek, TrackerState } from "@/lib/types";

const member = (id: string, active = true): Member => ({ id, canonicalName: id, aliases: [], active });
const members = [member("Kael"), member("Roen"), member("Tamsin"), member("Vex", false), member("Zed")];
const week: StormWeek = { id: "w1", kind: "desert", date: "2026-10-16", slots: [
  { memberId: "Kael", team: "B", role: "starter" },
  { memberId: "Roen", team: "B", role: "starter" },
  { memberId: "Tamsin", team: "A", role: "starter" },
] };
const row = (rank: number, displayName: string): ExtractedRow => ({ rank, displayName, points: 5_000_000 - rank, confidence: 0.98 });
const job = (rows: ExtractedRow[]): BridgeJobView => ({
  id: "j1", status: "completed", kind: "storm", storm: { weekId: "w1", team: "B" }, fileCount: 2, fileNames: [],
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", expiresAt: "2026-10-26T00:00:00Z", attempts: 1, rows,
});
const review = (rows: ExtractedRow[]) => renderToStaticMarkup(<StormImportReview job={job(rows)} week={week} members={members} onApply={() => {}} onDiscard={() => {}} />);

describe("StormImportReview", () => {
  it("shows who played, who is missed and parked, and who needs a decision", () => {
    const html = review([row(1, "Kael"), row(2, "Tamsin"), row(3, "Vex")]);
    expect(html).toContain("3 in the results · 1 played · 1 starters missed");
    expect(html.match(/class="storm-import-missed".*?<\/ul>/)![0]).toMatch(/<span>Roen<\/span>.*Not in the game lineup/);
    expect(html).toContain("On team A");
    expect(html).toContain("Add to team B as played");
    expect(html).toContain("Left the alliance");
    expect(html).not.toContain('role="alert"');
  });

  it("blocks applying while a row is unmatched, and offers the closest name", () => {
    const html = review([row(1, "Kael"), row(2, "Roenn")]);
    expect(html).toContain("No match");
    expect(html).toContain("Suggested: Roen");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Apply to lineup/);
  });
});

describe("StormLineupsView screenshot import", () => {
  const state: TrackerState = { version: 1, alliance: { name: "Test", tag: "TST", server: "S1" }, members, snapshots: [], uploads: [], stormWeeks: [week], updatedAt: "2026-10-18T00:00:00Z" };
  const render = (canManage: boolean, bridgeConfigured: boolean, override: Partial<TrackerState> = {}) =>
    renderToStaticMarkup(<StormLineupsView canManage={canManage} bridgeConfigured={bridgeConfigured} state={{ ...state, ...override }} onSaved={() => {}} />);

  it("is offered to officers on an open week when the extraction bridge is set up", () => {
    expect(render(true, true)).toContain("Import results from screenshots");
    expect(render(false, true)).not.toContain("Import results from screenshots");
    expect(render(true, false)).not.toContain("Import results from screenshots");
    expect(render(true, true, { stormWeeks: [{ ...week, locked: true }] })).not.toContain("Import results from screenshots");
  });
});
