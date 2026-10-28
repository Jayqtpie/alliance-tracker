import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RallySquadsView } from "./rally-squads";
import type { Member, RallyBoard, TrackerState } from "@/lib/types";

const member = (id: string, profession: string, heroPowerM: number): Member => ({
  id, canonicalName: id, aliases: [], active: true,
  manualStats: { heroPower: heroPowerM * 1e6, profession, updatedAt: "2026-10-28" },
});

const members = [
  member("Kael", "War Leader", 400), member("Brann", "War Leader", 300),
  member("Roen", "Engineer", 250), member("Tamsin", "Engineer", 200), member("Ilse", "Engineer", 150), member("Odo", "Engineer", 100),
];
const state = (rallyBoard?: RallyBoard): TrackerState => ({
  version: 1, alliance: { name: "Test Alliance", tag: "TST", server: "S1" }, members, snapshots: [], uploads: [],
  updatedAt: "2026-10-28T00:00:00Z", rallyBoard,
});
const render = (canManage: boolean, rallyBoard?: RallyBoard) => renderToStaticMarkup(<RallySquadsView canManage={canManage} state={state(rallyBoard)} onSaved={() => {}} />);

describe("RallySquadsView", () => {
  it("starts an officer from an unsaved suggestion with a War Leader in front", () => {
    const html = render(true);
    expect(html).toContain("Squad 1");
    expect(html).toContain("Suggested squads, not saved yet");
    expect(html.indexOf("Kael")).toBeLessThan(html.indexOf("Roen"));
    expect(html).toContain("Brann"); // one squad of five, so the sixth member is benched
    expect(html).toMatch(/Bench.*count-chip">1</);
  });

  it("tells a viewer when nothing has been saved, without inventing squads", () => {
    const html = render(false);
    expect(html).toContain("No rally squads yet");
    expect(html).not.toContain("Squad 1");
  });

  it("shows a saved board read-only, flags a leader who is no longer a War Leader and lists who is away", () => {
    const html = render(false, { mode: "balanced", squads: [{ id: "squad-1", slots: ["Roen", "Kael", null, null, null] }], pinned: ["Kael"], unavailable: ["Odo"] });
    expect(html).toContain("not a War Leader");
    expect(html).toContain("Pinned");
    expect(html).toMatch(/Away.*Odo/);
    expect(html).not.toContain("Save squads");
    expect(html).not.toContain("Suggest squads");
    expect(html).toContain("Copy as text");
  });
});
