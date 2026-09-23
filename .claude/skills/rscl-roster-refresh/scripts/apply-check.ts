// Proves the wired-in capture really applies to the deployed state, before anything is pushed.
// The unit tests use made-up states; on the real one, applyCapturedRoster returns the state
// unchanged if a guard trips (duplicate UID, conflicting mapping, newer marker) and nothing
// errors. This runs the app's own load-time path on the live-state.mjs snapshot instead.
// A viewer snapshot (the default) omits rosterImport, so the marker guards are checked only
// with an officer snapshot; the cron workflow checks the marker moved from the git diff.
// Usage (from repo root):
//   LIVE_STATE=.data/lastrank-refresh-<date>/live-before.json npx vitest run --config .claude/skills/rscl-roster-refresh/scripts/vitest.apply.config.mts
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { ROSTER_IMPORT } from "@/lib/roster-import";
import { applyDataImports } from "@/lib/store";
import type { TrackerState } from "@/lib/types";

vi.mock("server-only", () => ({}));

test("the new capture applies to the deployed state", () => {
  const file = process.env.LIVE_STATE;
  if (!file) throw new Error("Set LIVE_STATE to the live-before.json snapshot.");
  const before = JSON.parse(readFileSync(file, "utf8")) as TrackerState;
  const date = /-(\d{4}-\d{2}-\d{2})-v\d+$/.exec(ROSTER_IMPORT)?.[1];
  const capture = JSON.parse(readFileSync(`lib/data/rscl-roster-${date}.json`, "utf8"));

  expect(before.rosterImport, "the deployed state already has this capture").not.toBe(ROSTER_IMPORT);
  const after = applyDataImports(before);
  expect(after.rosterImport, "the import was refused by one of its guards").toBe(ROSTER_IMPORT);

  const active = after.members.filter((member) => member.active);
  expect(active.length).toBe(capture.memberCount);
  for (const member of before.members.filter((m) => m.active)) {
    expect(after.members.find((m) => m.id === member.id)?.active, `${member.id} was deactivated`).toBe(true);
  }

  // Later one-shot imports run after the roster; none may overwrite what the capture set.
  for (const row of capture.members) {
    const member = after.members.find((m) => m.gameProfile?.uid === row.uid);
    expect(member, `no tracker record for ${row.uid}`).toBeDefined();
    expect({ uid: row.uid, name: member!.canonicalName, rank: member!.gameProfile!.rank }).toEqual({ uid: row.uid, name: row.name, rank: row.rank });
    if (row.freshness.status !== "fresh") continue;
    const profile = member!.gameProfile!;
    expect({ uid: row.uid, power: profile.power, heroPower: profile.heroPower, profession: profile.profession })
      .toEqual({ uid: row.uid, power: row.profile.power, heroPower: row.profile.heroPower, profession: row.profile.profession });
  }
});
