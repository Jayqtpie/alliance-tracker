import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StormLineupReview } from "./storm-lineup-review";
import { StormLineupsView } from "./storm-lineups";
import type { BridgeJobView, BridgeLineupHeader } from "@/lib/bridge-types";
import type { ExtractedRow, Member, StormWeek, TrackerState } from "@/lib/types";

const member = (id: string, heroPower: number, active = true): Member => ({ id, canonicalName: id, aliases: [], active, manualStats: { heroPower, updatedAt: "2026-10-20" } });
const members = [member("Kael", 300e6), member("Roen", 250e6), member("Tamsin", 200e6), member("Vex", 150e6, false)];
const week: StormWeek = { id: "w1", kind: "canyon", date: "2026-10-22", slots: [
  { memberId: "Kael", team: "B", role: "starter" },
  { memberId: "Roen", team: "A", role: "starter" },
  { memberId: "Tamsin", team: "A", role: "sub" },
] };
const row = (rank: number, displayName: string, millions: number, role: ExtractedRow["role"], extra: Partial<ExtractedRow> = {}): ExtractedRow =>
  ({ rank, displayName, points: millions * 1e6, confidence: 0.95, role, ...extra });
const job = (rows: ExtractedRow[], lineup: BridgeLineupHeader = {}): BridgeJobView => ({
  id: "j1", status: "completed", kind: "storm-lineup", storm: { weekId: "w1", team: "A" }, fileCount: 3, fileNames: [],
  createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z", expiresAt: "2026-10-27T00:00:00Z", attempts: 1, rows, lineup,
});
const review = (rows: ExtractedRow[], lineup?: BridgeLineupHeader) =>
  renderToStaticMarkup(<StormLineupReview job={job(rows, lineup)} week={week} members={members} onApply={() => {}} onDiscard={() => {}} />);

describe("StormLineupReview", () => {
  it("shows the game's seats, who moves across and who leaves, ready to confirm", () => {
    const html = review([row(1, "Kael", 300, "starter"), row(2, "Roen", 250, "sub"), row(3, "Vex", 150, "sub", { needsReview: true })],
      { team: "A", starters: 1, subs: 2, battleTime: "2026-10-23 02:00~02:30 (Local Time)" });
    expect(html).toContain("1 starters and 2 subs · 2026-10-23 02:00~02:30 (Local Time)");
    expect(html).toContain("Moves from team B");
    expect(html).toContain("Left the alliance");
    expect(html).toContain("Check this name");
    expect(html.match(/class="storm-import-missed".*?<\/ul>/)![0]).toContain("<span>Tamsin</span>");
    expect(html).toMatch(/<button type="button" class="button primary">.*?Confirm team A from the game/);
  });

  it("blocks on an unknown name, offering a member with a similar hero power", () => {
    const html = review([row(1, "Renamed Kael", 301, "starter")]);
    expect(html).toContain("No match");
    expect(html).toContain("Similar hero power: Kael");
    expect(html).toMatch(/<button type="button" class="button primary" disabled="">/);
  });

  it("refuses screenshots of the other Task Force", () => {
    const html = review([row(1, "Roen", 250, "starter")], { team: "B" });
    expect(html).toContain("These screenshots show Task Force B, not team A.");
    expect(html).toMatch(/<button type="button" class="button primary" disabled="">/);
  });
});

describe("StormLineupsView team confirmation", () => {
  const state: TrackerState = { version: 1, alliance: { name: "Test", tag: "TST", server: "S1" }, members, snapshots: [], uploads: [], updatedAt: "2026-10-22T00:00:00Z",
    stormWeeks: [{ ...week, confirmed: ["A"], times: { A: "2026-10-23 02:00~02:30 (Local Time)" } }] };
  const render = (canManage: boolean) => renderToStaticMarkup(<StormLineupsView kind="canyon" canManage={canManage} state={state} onSaved={() => {}} />);

  it("lets officers mark each team as matching the game, and shows viewers which do", () => {
    const officer = render(true);
    expect(officer).toMatch(/aria-pressed="true"[^>]*>.*?Matches the game/);
    expect(officer).toMatch(/aria-pressed="false"[^>]*>Mark as matching the game/);
    expect(officer).toContain("Battle: 2026-10-23 02:00~02:30 (Local Time)");
    const viewer = render(false);
    expect(viewer).not.toContain("Mark as matching the game");
    expect(viewer.match(/Matches the game/g)).toHaveLength(1);
  });
});
