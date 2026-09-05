import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreRows } from "./score-rows";
import { POST } from "@/app/api/snapshots/route";
import { INITIAL_STATE } from "@/lib/seed";
import { importCapturedRoster } from "@/lib/roster-import";
import { snapshotComparison } from "@/lib/tracker";
import type { Snapshot, TrackerState } from "@/lib/types";

vi.mock("@/lib/auth", () => ({ isAuthenticated: async () => true }));
vi.mock("@/lib/store", () => ({
  getState: async () => structuredClone(stored),
  setState: async (next: TrackerState) => { stored = next; return next; },
}));
let stored: TrackerState;
beforeEach(() => { stored = importCapturedRoster(structuredClone(INITIAL_STATE)); });

describe("uploaded scores in roster-style overview and reports", () => {
  it("keeps uploaded points and links renamed commanders to their roster avatar", async () => {
    const jay = stored.members.find((member) => member.canonicalName === "JayQT")!;
    const response = await POST(new Request("http://localhost/api/snapshots", {
      method: "POST", body: JSON.stringify({ capturedDate: "2026-09-01", status: "live", sourceType: "manual", rows: [
        { memberId: jay.id, rank: 1, displayName: "Jay new name", points: 23_987_654 },
        { rank: 2, displayName: "New arrival", points: 12_345_678 },
      ] }),
    }));
    expect(response.status).toBe(200);
    const { state, snapshot } = await response.json() as { state: TrackerState; snapshot: Snapshot };
    const comparison = snapshotComparison(snapshot, state.snapshots);
    for (const scroll of [false, true]) {
      const html = renderToStaticMarkup(<ScoreRows rows={comparison.rows} members={state.members} onOpenMember={() => {}} scroll={scroll} />);
      expect(html).toContain(jay.gameProfile!.avatarPath);
      expect(html).toContain("Captured as Jay new name");
      expect(html).toContain("23,987,654");
      expect(html).toContain("12,345,678");
      expect(html).toContain("New arrival");
      expect(html).not.toContain("196M");
      expect(html).toContain("points");
    }
    expect(state.members.find((member) => member.id === jay.id)?.aliases).toContain("Jay new name");
  });

  it("does not borrow an avatar for an unlinked name, and preserves zero versus missing comparisons", () => {
    const row = { id: "unlinked", rank: 1, displayName: "JayQT", points: 0, confidence: 1,
      priorPoints: undefined, priorRank: undefined, pointChange: undefined, percentChange: undefined, rankChange: undefined };
    const html = renderToStaticMarkup(<ScoreRows rows={[row]} members={stored.members} onOpenMember={() => {}} />);
    expect(html).not.toContain("/avatars/");
    expect(html).toContain("No matching prior score");
    expect(html).toContain("<strong>0</strong>");
    expect(html).not.toContain("<button");
  });
});
