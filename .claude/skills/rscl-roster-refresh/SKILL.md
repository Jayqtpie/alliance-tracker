---
name: rscl-roster-refresh
description: Use when refreshing the RSCL members roster from lastrank.fun (or lwservers.com as the backup when LastRank is stale) — pulling current alliance data, power, profession, ranks, renames or avatars into the tracker, or when asked to "update the members page" with fresh LastRank data.
---

# RSCL roster refresh

Pulls RSCL (warzone 927) from `lastrank.fun`, reconciles it against the deployed tracker state, and writes a dated capture that the app imports once on load.

Run every command from the repo root. `<date>` is today in `YYYY-MM-DD`.

## Non-negotiable rules

These are the owner's rules. Breaking one silently corrupts the roster.

| Rule | Meaning |
|---|---|
| **24-hour freshness** | A profile whose `last_enriched_at` is older than 24h after a refresh attempt is **retained**: its name, rank, stats, dates and avatar stay exactly as they are. |
| **Match by ID, never by name** | Identity is the stored `lastRankPublicId` → game `uid` link on the live tracker record. Names change constantly. |
| **Absent ≠ gone** | An active tracker member missing from LastRank's alliance list stays **active and unaltered**. LastRank's list lags. |
| **No UID, no row** | A listed player whose LastRank `uid` is null is skipped, not added. |

`career_type`: `101` = Engineer, `102` = War Leader, anything else = no profession.

## Pipeline

0. **Is it worth running?** `node .claude/skills/rscl-roster-refresh/scripts/probe.mjs` makes one request (three when it checks the backup) and prints `run: true|false` and `source` with counts. `source: lwservers` means LastRank is stale: follow "Backup source: lwservers" below instead of steps 2–3. The alliance list is a daily snapshot that our enrich requests never update, so the probe compares it against the snapshot the last export was built from. The scheduled workflow runs it before Claude starts; run it by hand when asked to refresh "only if something changed".
1. **Snapshot the deployed state** (the reconciliation baseline):
   `node .claude/skills/rscl-roster-refresh/scripts/live-state.mjs --out .data/lastrank-refresh-<date>`
   It needs `TRACKER_PASSCODE` (the viewer passcode) in the environment; ask the owner for it in an interactive session.
2. **Collect** — **dispatch a Sonnet subagent for this step; do not run it in the main session.** The owner asked for this split: Sonnet does the slow pull, the main session re-derives every number from the raw capture. This overrides any default about not spawning agents. Scope the subagent to collection only — no writes to tracked files, no tests, no git — and have it report the `--check` JSON verbatim rather than summarising it.
   ~100 profiles, 1 req/sec, several minutes; resumable — rerun the same command if it is cut off:
   `node .claude/skills/rscl-roster-refresh/scripts/collect.mjs --collect --out .data/lastrank-refresh-<date>`
   then `--check` instead of `--collect` to confirm coverage. Hard errors (HTTP status, non-JSON, identity mismatch) mean stop and report — never edit the script around them.
3. **Build the export**:
   `node .claude/skills/rscl-roster-refresh/scripts/build-capture.cjs --date <date>`
   Writes `lib/data/rscl-roster-<date>.json` plus any changed avatars under `public/avatars/rscl/`.
4. **Wire it in** — in `lib/roster-import.ts` only: point the import at the new JSON and bump `ROSTER_IMPORT` to `lwservers-rscl-927-<date>-v1`. Keep the `lwservers-` prefix; older deployments compare dates on it.
5. **Update the fact-coupled tests** (they pin values from the previous capture — see below).
6. **Verify** (below), then commit. Pushing deploys to Vercel; ask first in an interactive session. The scheduled workflow is the exception: it pushes on its own after re-running every check.

## Backup source: lwservers

Use this when the probe prints `"source":"lwservers"`: LastRank's alliance list is more than two days old (it stalled on 2026-09-22) or LastRank failed, and lwservers.com has a newer snapshot with changes. lwservers publishes warzone 927 as a static file keyed by **game UID**, the same ID the tracker stores, so the match-by-ID rule holds without LastRank.

1. **Snapshot the deployed state** as in step 1, into `.data/lwservers-refresh-<date>`.
2. **Collect** (three GETs, seconds; no subagent needed):
   `node .claude/skills/rscl-roster-refresh/scripts/collect-lwservers.mjs --out .data/lwservers-refresh-<date>`
   It refuses a snapshot older than 48 hours.
3. **Build**: `node .claude/skills/rscl-roster-refresh/scripts/build-capture-lwservers.cjs --date <date>`
4. Steps 4–6 as above, with the same fact-coupled test updates.

What the backup builder takes, and why:

| Field | Rule |
|---|---|
| Fresh row | `lastConfirmedAt` within 24h **and** a `daily` reading dated that day with at least one stat. Anything else is retained unaltered. |
| Hero power, power, kills | Only from the dated `daily` block. A stat lwservers did not read that day (null or 0) keeps its tracker value; `profile.fieldSources` records which. Never `gamePower`: when lwservers has no power reading it falls back to one-hero power (~11M instead of ~290M). |
| Name, avatar | From the fresh row. |
| Rank, profession | Always the tracker's. lwservers' `allianceRank` and `pf` are undated, and both disagreed with LastRank on real players. |
| Unmapped RSCL rows | Skipped (no tracker record with that UID); listed in `unresolvedIdentities` with `publicId: "uid:<uid>"`. |
| Absent members | Kept active and unaltered, as with LastRank. |

**A backup refresh never reaches main on its own.** The scheduled workflow pushes it to `roster-refresh/lwservers-<date>`; the owner reviews and merges it. In an interactive session, commit it to a branch and ask before anything goes to main. The builder also refuses to write if any exported UID or LastRank ID differs from the live record's, or if an active member is missing.

Marker and file names are unchanged (`lwservers-rscl-927-<date>-v1`, `rscl-roster-<date>.json`); the export's `source` is the lwservers URL. The builder refuses to overwrite a LastRank export for the same date. Once LastRank's list moves past the backup export's `sourceRosterUpdatedAt`, the probe goes back to LastRank by itself.

## Undoing a refresh

The tracker is one private Blob, `app-data/tracker-state.json`, and the first production load after a deploy applies the new capture to it in place. Reverting the commit alone does **not** undo that. Before any import writes, `lib/store.ts` copies the current state to `app-data/backups/tracker-state-v<version>-before-<marker>.json`; if that copy fails, the import is skipped. Imports run only on the production deployment (or a local server), never on previews, since a preview may share the store.

To roll back: revert the refresh commit on main first (otherwise the next load re-applies it), then replace `app-data/tracker-state.json` in the project's Blob store with the matching backup (download it from Vercel → Storage and upload it under that pathname, or copy it with the Vercel CLI). Officer edits made after the refresh are lost, so check the backup's version first.

## Tests that need new facts each refresh

`lib/roster-import.test.ts`: the export it imports at the top, the parrot record's `capturedOn`, JayQT's `heroPower`, the marker dates in "does not downgrade a newer capture" and the `it.each` list (all must be ≥ the new capture date), the public ID used for the retained-profile test, and the UID used for the absent-from-source test — **the retained and absent members change from run to run**; read the new export's `retainedProfileCount`, `changes.absentFromSourceRoster` and `notes` to find them.

`lib/profile-stats.test.ts`: the hardcoded power/profession for Zothargirl.

`lib/origin-servers.test.ts`: Zothargirl's hardcoded `originServerId` (843). `lib/origin-servers.ts` is a one-shot backfill for trackers that applied the 21 September capture before origin servers were stored; it keeps reading that dated JSON on purpose. Later captures carry `originServerId` themselves, so the backfill no-ops once every profile has one and can be deleted then.

`lib/member-profile-updates.test.ts`: only when the export reports a rename. It pins a `canonicalName` by UID (`1543620585000927` as of 2026-09-21), so any run whose `changes.renamed` touches that UID breaks it. Check `changes.renamed` against this file every run.

## Verification before claiming done

- `npx vitest run` — all green.
- `npx tsc --noEmit` and `npx eslint .` — clean.
- Read the builder's summary: active count, fresh vs retained, unresolved, renames, rank changes, profession split.
- Sanity-check power moves against `live-before.json`; investigate anything beyond roughly ±15%.
- Apply check: `LIVE_STATE=.data/lastrank-refresh-<date>/live-before.json npx vitest run --config .claude/skills/rscl-roster-refresh/scripts/vitest.apply.config.mts`. It runs the app's load-time imports on the deployed snapshot and fails if a guard silently refused the capture, a member was deactivated, or a later import overwrote a captured value. It replaced the old `next dev` render check, which never caught anything the tests and this check miss. A refresh changes data, not UI code.

## Scheduled runs

`.github/workflows/roster-refresh.yml` runs Sundays and Wednesdays at 04:00 UTC on the owner's subscription (`CLAUDE_CODE_OAUTH_TOKEN`), with `cron-prompt.md` as the prompt and the probe result appended. Claude commits but has no push credentials. The workflow then checks that the commit touches only refresh paths, adds an export and bumps the marker, re-runs tsc, eslint, vitest and the apply check, and pushes fast-forward only. A failed run emails the owner through GitHub's standard failure notice. Start one by hand with `gh workflow run roster-refresh.yml`.

## Gotchas

- A listed player with `alliance_id: null` trips the collector's `membershipMismatches` check and gives exit code 2 even when every profile is fresh. If that player has no tracker mapping the builder skips them anyway — read the check output before assuming failure.
- The builder refuses to write if a *mapped* member's source alliance or server is wrong. Reconcile, do not override.
- `next dev` rewrites `next-env.d.ts` to the `.next/dev/types` variant. Revert it; the committed form is the build variant.
- Don't commit `tsconfig.tsbuildinfo` (produced by `tsc`, not gitignored).
- `supersedesProfileUpdates` in the export retires the older one-time migrations (`lib/member-profile-updates.ts`, `lib/profile-refresh-retries.ts`, `lib/profile-stats.ts`) so they cannot replay stale values over a newer capture.
