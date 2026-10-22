import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StormImportReview } from "./storm-import";
import { StormLineupsView } from "./storm-lineups";
import type { BridgeJobView } from "@/lib/bridge-types";
import type { ExtractedRow, Member, StormWeek, TrackerState } from "@/lib/types";

const member = (id: string, active = true): Member => ({ id, canonicalName: id, aliases: [], active });
const members = [member("Kael"), member("Roen"), member("Tamsin"), member("Vex", false), member("Zed")];
const week: StormWeek = { id: "w1", kind: "desert", date: "2026-10-16", confirmed: ["A", "B"], slots: [
  { memberId: "Kael", team: "B", role: "starter" },
  { memberId: "Roen", team: "B", role: "starter" },
  { memberId: "Tamsin", team: "A", role: "starter" },
] };
const row = (rank: number, displayName: string): ExtractedRow => ({ rank, displayName, points: 5_000_000 - rank, confidence: 0.98 });
const job = (rows: ExtractedRow[]): BridgeJobView => ({
  id: "j1", status: "completed", kind: "storm", storm: { weekId: "w1", team: "B" }, fileCount: 2, fileNames: [],
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", expiresAt: "2026-10-26T00:00:00Z", attempts: 1, rows,
});
const review = (rows: ExtractedRow[], target: StormWeek = week) => renderToStaticMarkup(<StormImportReview job={job(rows)} week={target} members={members} onApply={() => {}} onDiscard={() => {}} />);

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

  it("warns instead of marking anyone missed when the team isn't confirmed against the game", () => {
    const html = review([row(1, "Kael")], { ...week, confirmed: ["A"] });
    expect(html).toContain("1 in the results · 1 played · nobody marked missed");
    expect(html).toContain("Team B&#x27;s lineup isn&#x27;t confirmed against the game");
    expect(html).not.toContain("storm-import-missed");
  });

  it("blocks applying while a row is unmatched, and offers the closest name", () => {
    const html = review([row(1, "Kael"), row(2, "Roenn")]);
    expect(html).toContain("No match");
    expect(html).toContain("Suggested: Roen");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Apply to lineup/);
  });
});

describe("StormImportReview rebuild option", () => {
  it("points at the rebuild when most of the mail sits outside the team's lineup", () => {
    const mostlyOutside = review([row(1, "Kael"), row(2, "Tamsin"), row(3, "Zed")]);
    expect(mostlyOutside).toMatch(/<label class="storm-import-rebuild" data-suggested="">/);
    expect(mostlyOutside).toContain("Most of these players aren&#x27;t in team B&#x27;s lineup here.");
    const mostlyIn = review([row(1, "Kael"), row(2, "Roen")]);
    expect(mostlyIn).toMatch(/<label class="storm-import-rebuild">/);
    expect(mostlyIn).toContain("Rebuild team B from these results");
  });
});

describe("StormLineupsView screenshot import", () => {
  const state: TrackerState = { version: 1, alliance: { name: "Test", tag: "TST", server: "S1" }, members, snapshots: [], uploads: [], stormWeeks: [week], updatedAt: "2026-10-18T00:00:00Z" };
  const render = (canManage: boolean, bridgeConfigured: boolean, override: Partial<TrackerState> = {}) =>
    renderToStaticMarkup(<StormLineupsView kind="desert" canManage={canManage} bridgeConfigured={bridgeConfigured} state={{ ...state, ...override }} onSaved={() => {}} />);

  it("is offered to officers on an open week when the extraction bridge is set up", () => {
    expect(render(true, true)).toContain("Import results from screenshots");
    expect(render(false, true)).not.toContain("Import results from screenshots");
    expect(render(true, false)).not.toContain("Import results from screenshots");
    expect(render(true, true, { stormWeeks: [{ ...week, locked: true }] })).not.toContain("Import results from screenshots");
  });

  it("says where the import appears before the first week exists", () => {
    expect(render(true, true, { stormWeeks: [] })).toContain("Start a week from the game above, then upload each team&#x27;s lineup screenshots there.");
    expect(render(false, true, { stormWeeks: [] })).not.toContain("lineup screenshots there");
    expect(render(true, false, { stormWeeks: [] })).not.toContain("lineup screenshots there");
  });

  it("offers officers a week started from the game only when the bridge is set up", () => {
    expect(render(true, true, { stormWeeks: [] })).toContain("Start from the game");
    expect(render(true, false, { stormWeeks: [] })).not.toContain("Start from the game");
    expect(render(false, true, { stormWeeks: [] })).not.toContain("Start from the game");
  });

  it("tells officers why screenshot uploads are missing when the bridge isn't set up", () => {
    const note = "Claude extraction appears after private Blob storage and a worker secret are configured.";
    expect(render(true, false, { stormWeeks: [] })).toContain(note);
    expect(render(true, true, { stormWeeks: [] })).not.toContain(note);
    expect(render(false, false, { stormWeeks: [] })).not.toContain(note);
  });
});
