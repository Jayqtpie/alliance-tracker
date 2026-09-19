import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SvsAttendanceView } from "./svs-attendance";
import type { Member, TrackerState } from "@/lib/types";

const member = (id: string, active = true): Member => ({ id, canonicalName: id, aliases: [], active });

const state: TrackerState = {
  version: 1,
  alliance: { name: "Test Alliance", tag: "TST", server: "S1" },
  members: [member("Kael"), member("Roen"), member("Tamsin"), member("Vex", false)],
  snapshots: [],
  uploads: [],
  svsEvents: [
    { id: "old", date: "2026-09-05", label: "vs #900", attendance: { Kael: "present", Roen: "absent", Vex: "present" } },
    { id: "new", date: "2026-09-12", label: "vs #931", attendance: { Kael: "present", Roen: "excused", Tamsin: "absent" } },
  ],
  updatedAt: "2026-09-18T00:00:00Z",
};

describe("SvsAttendanceView", () => {
  it("opens the newest fight with its counts", () => {
    const html = renderToStaticMarkup(<SvsAttendanceView canManage state={state} onSaved={() => {}} />);
    expect(html).toContain("vs #931");
    expect(html).toContain("1/3 present · 1 excused");
    expect(html.indexOf("vs #931")).toBeLessThan(html.indexOf("vs #900"));
  });

  it("gives officers the three-way toggle and fight controls", () => {
    const html = renderToStaticMarkup(<SvsAttendanceView canManage state={state} onSaved={() => {}} />);
    expect(html).toContain("Add fight");
    expect(html).toContain("Delete fight");
    expect(html).toContain('aria-label="Mark Tamsin excused"');
    expect(html).toContain("Save attendance");
  });

  it("is read-only for viewers", () => {
    const html = renderToStaticMarkup(<SvsAttendanceView canManage={false} state={state} onSaved={() => {}} />);
    expect(html).toContain("Tamsin");
    expect(html).not.toContain("Add fight");
    expect(html).not.toContain("Delete fight");
    expect(html).not.toContain("Mark Tamsin");
    expect(html).not.toContain("Save attendance");
  });

  it("shows an empty state when no fights are recorded", () => {
    const html = renderToStaticMarkup(<SvsAttendanceView canManage={false} state={{ ...state, svsEvents: undefined }} onSaved={() => {}} />);
    expect(html).toContain("No fights recorded yet");
  });
});
