import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StormLineupsView } from "./storm-lineups";
import type { Member, StormType, TrackerState } from "@/lib/types";

const member = (id: string, power: number, active = true): Member => ({ id, canonicalName: id, aliases: [], active, manualStats: { power, updatedAt: "2026-10-01" } });

const state: TrackerState = {
  version: 1,
  alliance: { name: "Test Alliance", tag: "TST", server: "S1" },
  members: [member("Kael", 300), member("Roen", 200), member("Tamsin", 100), member("Vex", 50), member("Zed", 40)],
  snapshots: [],
  uploads: [],
  stormWeeks: [
    { id: "old", kind: "desert", date: "2026-10-09", slots: [
      { memberId: "Kael", team: "A", role: "starter", result: "played" },
      { memberId: "Roen", team: "A", role: "starter", result: "missed" },
      { memberId: "Tamsin", team: "B", role: "sub" },
    ] },
    { id: "new", kind: "canyon", date: "2026-10-16", slots: [
      { memberId: "Kael", team: "B", role: "starter" },
      { memberId: "Vex", team: "A", role: "sub", result: "played", park: true },
    ] },
  ],
  updatedAt: "2026-10-18T00:00:00Z",
};
const render = (canManage: boolean, override: Partial<TrackerState> = {}, kind: StormType = "canyon") =>
  renderToStaticMarkup(<StormLineupsView kind={kind} canManage={canManage} state={{ ...state, ...override }} onSaved={() => {}} />);

describe("StormLineupsView", () => {
  it("shows only its own battlefield's weeks", () => {
    const desert = render(true, {}, "desert");
    expect(desert).toContain("Desert Storm");
    expect(desert).not.toContain("Canyon Storm");
    expect(desert).toContain("Desert Storm runs on Fridays.");
    // The 9 Oct week is the only Desert one, so it opens even though the Canyon week is newer.
    expect(desert.match(/data-stat="storm-starters".*?<\/dd>/)![0]).toContain(">1 / 2<");
    expect(desert).not.toContain('aria-label="Park Vex next week"');
  });

  it("opens the newest week with its kind and counts", () => {
    const html = render(false);
    expect(html).toContain("Canyon Storm");
    expect(html).toContain("1/40 starters · 1/20 subs · 1 played · 0 missed · 1 not recorded");
    const starters = html.match(/data-stat="storm-starters".*?<\/dd>/)![0];
    expect(starters).toContain(">0 / 1<");
    expect(html.match(/data-stat="storm-parked".*?<\/dd>/)![0]).toContain(">1<");
  });

  it("shows who is parked from the week before and who sat out", () => {
    const html = render(true);
    // Roen missed as a Desert starter on 9 Oct: parked for the 16 Oct Canyon week, and offered no way back in.
    const roen = html.match(/<li data-state="parked">.*?<\/li>/)![0];
    expect(roen).toContain("Roen");
    expect(roen).toContain("Parked · from");
    expect(roen).not.toContain("<select");
    // Tamsin was a sub on 9 Oct, not parked: on the bench with an add control.
    expect(html).toContain('aria-label="Add Tamsin"');
    // Zed sat out 9 Oct and is not picked for 16 Oct: flagged as due a turn, Tamsin is not.
    expect(html.match(/<li data-state="bench">(?:(?!<\/li>).)*Zed.*?<\/li>/)![0]).toContain("Sat out last week");
    expect(html.match(/<li data-state="bench">(?:(?!<\/li>).)*Tamsin.*?<\/li>/)![0]).not.toContain("Sat out last week");
  });

  it("gives officers result, park and move controls, and viewers read-only pills", () => {
    const officer = render(true);
    expect(officer).toContain('aria-label="Mark Kael missed"');
    expect(officer).toContain('aria-label="Park Vex next week"');
    expect(officer).toContain('aria-label="Move Kael"');
    expect(officer).toContain("Suggest lineup");
    expect(officer).toContain("Save lineup");
    const viewer = render(false);
    expect(viewer).not.toContain("Mark Kael missed");
    expect(viewer).not.toContain("Suggest lineup");
    expect(viewer).toContain("Not recorded");
  });

  it("locks the controls on a locked week", () => {
    const html = render(true, { stormWeeks: state.stormWeeks!.map((week) => ({ ...week, locked: true })) });
    expect(html).not.toContain('aria-label="Mark Kael missed"');
    expect(html).toContain("Unlock week");
  });

  it("has an empty state before the first week", () => {
    const html = render(true, { stormWeeks: [] });
    expect(html).toContain("No weeks recorded yet.");
    expect(html.match(/data-stat="storm-starters".*?<\/dd>/)![0]).toContain(">—<");
  });

  it("lists each group by hero power and the bench by name", () => {
    // Zed and Tamsin are the strongest here: first in their group, but Tamsin follows Roen on the bench.
    const heroes: Record<string, number> = { Zed: 900, Tamsin: 800, Kael: 300, Roen: 200, Vex: 50 };
    const members = state.members.map((value) => ({ ...value, manualStats: { ...value.manualStats!, heroPower: heroes[value.id] } }));
    const html = render(true, { members, stormWeeks: [{ id: "w", kind: "canyon", date: "2026-10-22", slots: [
      { memberId: "Zed", team: "A", role: "starter" },
      { memberId: "Vex", team: "A", role: "starter" },
      { memberId: "Kael", team: "A", role: "starter" },
    ] }] });
    const positions = (prefix: string, names: string[]) => names.map((name) => html.indexOf(`aria-label="${prefix} ${name}"`));
    const starters = positions("Move", ["Zed", "Kael", "Vex"]);
    expect(starters.every((position) => position >= 0)).toBe(true);
    expect(starters).toEqual([...starters].sort((a, b) => a - b));
    const bench = positions("Add", ["Roen", "Tamsin"]);
    expect(bench[0]).toBeGreaterThanOrEqual(0);
    expect(bench[0]).toBeLessThan(bench[1]);
  });

  it("starts with the bench collapsed behind its heading", () => {
    const html = render(false);
    expect(html).toMatch(/<button type="button" class="storm-bench-toggle" aria-expanded="false" aria-controls="storm-bench-list"/);
    expect(html).toContain('<ul id="storm-bench-list" class="svs-member-list" hidden="">');
  });
});
