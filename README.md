# Alliance Manager

A mobile-friendly Alliance Duel tracker for **RSCL · The Rascals**. Officers can upload overlapping Last War leaderboard screenshots or an iPhone screen recording, review extracted rankings, publish live or final snapshots, compare matching weeks, manage commander identities, and export officer-ready reports.

## Included in this MVP

- Shared officer passcode with a signed, HTTP-only session cookie
- Tuesday 25 August 2026 seed snapshot for ranks 1–90
- Multi-image extraction through the OpenAI Responses API
- Optional local Codex CLI extraction using an officer's ChatGPT sign-in
- On-device screen-recording frame extraction (the original video is never uploaded)
- Automatic removal of the repeated green pinned-player card
- Rank deduplication, gap/order warnings, likely name-change suggestions, large-change checks, confidence flags, and human review
- Same-weekday comparison for Monday–Friday live captures
- Week-over-week comparison for Saturday final captures
- Score difference, percentage change, and rank movement
- Stable commander identities, aliases, join/leave dates, transfer notes, and duplicate-profile merging
- Five-day retention for original screenshots
- Private Vercel Blob persistence with a local JSON development fallback
- Responsive officer dashboard, dedicated reports, detailed CSV, and shareable PNG export
- Commander profiles with score history, rank records, participation rate, aliases, and week-over-week movement

## Local development

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Without a connected Vercel Blob store, development data is stored under `.data/` and is deliberately ignored by Git. Without `OPENAI_API_KEY`, the dashboard still supports manual CSV/tab-separated imports.

## Local Codex extraction (no API key)

The original cloud extractor remains available. As an alternative, an officer can process screenshots on a Windows, macOS, or Linux computer using a locally authenticated Codex CLI, then import the generated JSON into the deployed tracker.

1. Install the Codex CLI and sign in once with your ChatGPT account:

   ```powershell
   codex login
   codex login status
   ```

2. From this repository, run the companion with one or more screenshots:

   ```powershell
   npm run extract:local -- "C:\path\rank-01.png" "C:\path\rank-02.png"
   ```

   To choose the output filename:

   ```powershell
   npm run extract:local -- --out "C:\path\tuesday-results.json" "C:\path\rank-01.png"
   ```

3. Open **New import** in Alliance Manager, choose **Import Codex JSON**, review the rows, and publish the snapshot.

The companion uses the Codex authentication available in the terminal where it is launched and refuses an explicitly detected API-key login. It runs Codex non-interactively with read-only sandboxing, retains no Codex session, and writes only the result JSON. Screenshots are sent from that computer to Codex and are not uploaded to Alliance Manager or retained in Vercel.

## Phone-to-PC Codex bridge

The queue bridge lets an officer choose a screen recording directly from the deployed Alliance Manager on an iPhone. The browser extracts JPEG frames on the phone, so the original recording never leaves the device. Those frames are uploaded directly to the private Vercel Blob store and wait for a trusted PC worker.

On the PC, add the worker settings to `.env.bridge.local`:

```dotenv
BRIDGE_URL=https://alliance-tracker-nine.vercel.app
BRIDGE_SECRET=the-same-value-as-vercel
```

`BRIDGE_SECRET` is recommended as a separate long random value configured in Vercel Production. If it is absent, the deployed app and local worker both fall back to `OFFICER_PASSCODE`.

Start the worker from this repository and leave the terminal open:

```powershell
npm run bridge:worker
```

Then, from the phone:

1. Open **New import** and choose the screen recording.
2. Wait while the browser prepares up to 18 local frames.
3. Choose **Queue for PC Codex**.
4. Keep the PC worker running. The phone page changes from waiting, to processing, to rows ready.
5. Choose **Load extracted rows**, review them, and publish.

The worker receives only short-lived frame files through authenticated endpoints. Queue records and private frames expire after five days. Run a one-shot worker health check with `npm run bridge:worker -- --once`.

## Vercel Blob setup

1. Create or import this GitHub repository as a Vercel project.
2. Open the project's **Storage** tab and create a **private Blob store**.
3. Connect the store to the project. Vercel adds a read-write token automatically; depending on the store name this may be `BLOB_READ_WRITE_TOKEN` or `BLOB1_READ_WRITE_TOKEN`.
4. Add the remaining environment variables below and deploy.

The tracker uses one small private JSON blob for shared alliance data and the same store for five-day screenshot retention. There is no database schema or separate Supabase project to maintain. Writes use the blob ETag to detect conflicting officer edits instead of silently overwriting them.

## Vercel environment variables

| Variable | Purpose |
| --- | --- |
| `OFFICER_PASSCODE` | Shared passcode used by alliance officers |
| `SESSION_SECRET` | Long random value used to sign sessions |
| `OPENAI_API_KEY` | Reads uploaded leaderboard screenshots |
| `OPENAI_VISION_MODEL` | Optional; defaults to `gpt-5-mini` |
| `BLOB_READ_WRITE_TOKEN` / `BLOB1_READ_WRITE_TOKEN` | Added by Vercel when the private Blob store is connected |
| `CRON_SECRET` | Protects the scheduled cleanup endpoint |
| `BRIDGE_SECRET` | Authenticates the local PC queue worker; falls back to `OFFICER_PASSCODE` |
| `BRIDGE_URL` | Local worker target; defaults to the production tracker URL |

After connecting this repository to Vercel, deploy normally. [`vercel.json`](vercel.json) schedules a daily cleanup request. Upload metadata and the original private blob are removed after five days; published ranking data remains.

## Capture guidance

- Take overlapping screenshots while scrolling slowly.
- Alternatively, upload one slow iPhone screen recording. Frames are extracted in the browser before OCR, so the original recording stays on the officer's device.
- Ensure every rank appears fully in at least one screenshot.
- Repeated ranges are safe and are deduplicated by rank.
- The fixed green personal-rank card is detected and ignored.
- Use `live` for Monday–Friday and `final` for Saturday.
- During transfers, do not infer that unranked players scored zero until a current roster capture exists.

## Verification

The roster includes the signed-in LWServers capture from 5 September 2026: 100 members and avatars, 90 hero-power values (eight marked legacy), and 60 kill counts. Displayed numbers are rounded; unavailable values remain null. This is a saved capture, not a live game integration.

`lib/roster-import.ts` applies this capture once when state is loaded, then saves a `rosterImport` marker in local or Blob storage. It matches game IDs first and unambiguous normalized names/known aliases next. Existing member IDs, scores, notes and operations remain intact; unmatched older identities appear under Previous records rather than being deleted. Fuzzy OCR names are not automatically merged. The marker prevents later officer changes from being overwritten on refresh. Avatars are bundled under `public/avatars/rscl`.

```powershell
npm run test
npm run lint
npm run build
```
