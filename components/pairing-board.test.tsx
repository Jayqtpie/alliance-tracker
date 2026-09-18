import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PairingBoard } from "./pairing-board";
import type { Member, TrackerState } from "@/lib/types";

const member = (id: string, profession: string, power: number): Member => ({
  id, canonicalName: id, aliases: [], active: true,
  manualStats: { power, profession, updatedAt: "2026-09-18" },
});

const state: TrackerState = {
  version: 1,
  alliance: { name: "Test Alliance", tag: "TST", server: "S1" },
  members: [
    member("Kael", "War Leader", 500_000_000),
    member("Roen", "Engineer", 300_000_000),
    member("Tamsin", "Engineer", 100_000_000),
  ],
  snapshots: [],
  uploads: [],
  updatedAt: "2026-09-18T00:00:00Z",
};

describe("PairingBoard", () => {
  it("renders column headings and a paired member's name and power", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage state={state} onSaved={() => {}} />);
    expect(html).toContain("War Leaders");
    expect(html).toContain("Engineers");
    expect(html).toContain("Kael");
    expect(html).toContain("500M");
  });

  it("renders an unpaired member in the pool", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage state={state} onSaved={() => {}} />);
    expect(html).toContain("Tamsin");
  });

  it("renders no Save button when canManage is false", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage={false} state={state} onSaved={() => {}} />);
    expect(html).not.toContain("Save pairings");
    expect(html).not.toContain("Discard");
  });
});
