---
name: lwservers-roster-refresh
description: Refresh the RSCL Alliance Tracker roster from the signed-in LWServers roster and player profiles, retaining player IDs, previous names and ranking history. Use for an on-demand weekly LWServers roster refresh for The Rascals on server 927.
---

# LWServers roster refresh

Run the established roster refresh for `C:/Users/jay_p/Documents/ChatGPT/Alliance tracker`. Verify the checkout and alliance before applying changes. This workflow is specific to RSCL / The Rascals / server 927; it must not import RSCL data into customer or template installations.

The user requests a fresh source read when invoking this skill. Their chosen name policy is: **use the names currently shown on LWServers, even when they are known older aliases; retain the outgoing name as an alias and a visible Previous name tag.** Commit and push completed changes after checks pass, following the user's standing preference in this project. Do not schedule future runs unless requested.

## Establish the baseline

- Read repository `AGENTS.md`, check Git status and the configured remote, then inspect `lib/roster-import.ts`, its current dated capture, and `lib/roster-import.test.ts`. The last successful refresh when this skill was created was `2026-09-06`, commit `5e66868`; derive the latest capture from the checkout each time.
- Production at creation time was `https://alliance-tracker-nine.vercel.app/`; verify the current deployment against project configuration before using it.
- Record the current live roster count and published score rows before deployment, including ranks, points, profile UID/avatar associations, and the Needs review count. Reports exposes the full selected capture in `.score-row`; the overview is paginated. Use the visible UI or an available authorized connector. Direct navigation to `/api/state` was blocked by the in-app browser in the original run; do not depend on it or work around that restriction.
- Preserve concurrent officer corrections: migrate from the state freshly read by `getState()`, never replace the live store with an earlier local or browser snapshot.

## Read LWServers

Use the available browser tools and their current documentation. The successful route was the signed-in `https://lwservers.com/home` page: **Alliance → Roster**. Confirm The Rascals and warzone 927. If sign-in has expired, resolve access before capturing data; a login screen is not an empty roster.

Read every roster row and every associated player profile. Read [references/source-capture.md](references/source-capture.md) for the observed DOM fields and export procedure. These are source observations, not a private API contract: inspect the current DOM and adapt if LWServers changes.

- Match players by the game UID, retaining any tracker ID already associated with that UID. An officer may have merged an imported profile into a differently named tracker ID.
- Capture the exact Unicode name and R1–R5 rank. Do not confuse alliance rank, roster sort position, FSP estimate, or weekly Alliance Duel rank.
- Read hero power, total power, kills, activity date and last-seen labels from each profile. Keep rounded values as rounded, unavailable values as null/display dashes, and LEGACY hero power marked as older data. Do not substitute FSP for hero power.
- Export the observed avatar assets through the browser's supported asset facility. Validate usable images and map them by UID. If a current avatar is unavailable, retain a working existing avatar and record that limitation; do not replace it with a broken URL or claim it refreshed.
- Capture all pages/lazy-loaded rows. Reconcile the unique UID count with the source's displayed member count. The last capture had 100, but do not force future captures to that number.

## Prepare the dated refresh

Create `lib/data/rscl-roster-YYYY-MM-DD.json` following the current capture schema. Keep prior captures for comparison. Use the actual refresh date and export timestamp; keep profile activity dates separate so a fresh retrieval does not imply freshly measured statistics.

Compare the new capture with the previous capture by UID and report added, absent, renamed, changed-statistic and changed-avatar counts. Recompute these fields from this run; do not carry forward an old capture's changes, notes or summary counts. Retain the exact observed FSP estimates/basis in the source artifact even though the roster displays hero power and kills.

Use the existing one-time import mechanism in `lib/roster-import.ts`:

1. Point the import at the new dated capture and advance `ROSTER_IMPORT` using the established date/version format. Preserve the guard against downgrading newer captures. A second refresh on the same day needs a fresh marker and its ordering must remain correct.
2. Refresh source names and profiles on the same UID-linked tracker identities. Preserve aliases, `previousNames`, notes, and any corrected historical links. Preserve all snapshots, points, ranks, review flags and operations.
3. Add outgoing canonical names to `aliases` and `previousNames`; keep real previous names distinct from uncertain OCR aliases. The profile UI already renders `Previous name` tags, and roster renaming and merging preserve them.
4. Add genuinely new UIDs only after matching against the existing roster. Never match to a different known UID, or select between ambiguous names by guesswork. A missing or ambiguous UID needs reconciliation before applying that identity change.
5. Members absent from a complete, verified source roster may become inactive while their historical records remain. Do not infer exact join/departure dates from a comparison between captures.
6. Update successful avatar downloads under `public/avatars/rscl/<uid>.jpg`. Do not update ranking screenshots or run OCR as part of a roster refresh.

If the source is incomplete, internally inconsistent, or an unexpected membership change cannot be reconciled, keep the proposed capture separate and resolve that issue before advancing the live import. Report the specific unresolved issue rather than silently applying a partial roster.

## Verify, commit, deploy

- Check complete unique UIDs, source count, exact Unicode names, ranks, valid avatar files, correctly parsed rounded values, and null/legacy statistics.
- Run the relevant import/API tests, `npm test`, `npm run lint`, and `npm run build`. The import regression tests must show history/operations/review preservation, identity retention across merges, previous-name retention, one-time application, and no downgrade of a newer capture. Update capture-specific expectations only to match observed new data.
- Follow installed Next.js documentation if changing application code, as required by `AGENTS.md`. Local browser fixtures must use isolated storage; restore any original local fixture after testing.
- Commit only the intended capture, assets, import marker and necessary supporting changes; push the current authorized project branch. Do not leave a successful refresh only in local `.data`.
- Wait for deployment success. The original project's status was available through `gh api repos/Jayqtpie/alliance-tracker/commits/<commit>/status`; derive the repository from the current remote.
- Load the deployed app to apply the migration. Compare all active UID/name/rank associations with the source, verify the accuracy date, loaded avatars and Previous name tags, and confirm saved rankings and review state stayed intact. Check desktop/mobile presentation if the profile UI changed. Account for any concurrent officer edits before attributing differences to the refresh.
- Close temporary browser tabs and reset temporary viewport overrides. Report the number refreshed, meaningful differences, source limitations, commit, and live verification result. Do not say the refresh is live until the deployed roster is verified.
