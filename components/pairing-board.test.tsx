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

  // One War Leader against two Engineers, so the second row's War Leader slot stays empty
  // rather than the spare Engineer being dropped or pooled.
  it("pairs uneven columns into a half-empty row", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage state={state} onSaved={() => {}} />);
    expect(html).toContain("Tamsin");
    expect(html).toContain("Empty War Leader slot, row 2");
    expect(html.match(/class="pairing-row"/g)).toHaveLength(3); // two rows plus the trailing drop target
  });

  it("renders no Save button when canManage is false", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage={false} state={state} onSaved={() => {}} />);
    expect(html).not.toContain("Save pairings");
    expect(html).not.toContain("Discard");
  });
});

describe("PairingBoard slot mismatch badge", () => {
  const noProfession: Member = { id: "Vex", canonicalName: "Vex", aliases: [], active: true };

  const mismatchState: TrackerState = {
    version: 1,
    alliance: { name: "Test Alliance", tag: "TST", server: "S1" },
    members: [
      member("Kael", "War Leader", 500_000_000),
      member("Roen", "Engineer", 300_000_000),
      member("Nox", "War Leader", 200_000_000),
      noProfession,
    ],
    snapshots: [],
    uploads: [],
    pairings: [
      { id: "pair-1", warLeaderId: "Kael", engineerId: "Roen" },
      { id: "pair-2", engineerId: "Nox" },
      { id: "pair-3", engineerId: "Vex" },
    ],
    updatedAt: "2026-09-18T00:00:00Z",
  };

  it("renders the badge for a member sitting in a slot that doesn't match their profession", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage state={mismatchState} onSaved={() => {}} />);
    expect(html).toContain("currently War Leader");
  });

  it("renders no badge for a member whose profession matches the column", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage state={mismatchState} onSaved={() => {}} />);
    const kaelIndex = html.indexOf("Kael");
    const roenIndex = html.indexOf("Roen");
    expect(html.slice(kaelIndex, kaelIndex + 200)).not.toContain("pairing-chip-flag");
    expect(html.slice(roenIndex, roenIndex + 200)).not.toContain("pairing-chip-flag");
  });

  it("renders 'no profession' (not 'currently no profession') for a member with no profession in a slot", () => {
    const html = renderToStaticMarkup(<PairingBoard canManage state={mismatchState} onSaved={() => {}} />);
    expect(html).toContain(">no profession<");
    expect(html).not.toContain("currently no profession");
  });

  it("renders no badge for a chip in an unpaired pool", () => {
    const poolState: TrackerState = {
      ...state,
      pairings: [{ id: "pair-1", warLeaderId: "Kael", engineerId: "Roen" }],
    };
    const html = renderToStaticMarkup(<PairingBoard canManage state={poolState} onSaved={() => {}} />);
    const poolIndex = html.indexOf("Unpaired Engineers");
    expect(poolIndex).toBeGreaterThan(-1);
    expect(html.slice(poolIndex)).toContain("Tamsin");
    expect(html.slice(poolIndex)).not.toContain("pairing-chip-flag");
  });
});
