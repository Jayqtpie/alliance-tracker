# Alliance Manager

A mobile-friendly Alliance Duel tracker for alliance leadership. Officers can upload overlapping Last War leaderboard screenshots or an iPhone screen recording, review extracted rankings, publish live or final snapshots, compare matching weeks, manage commander identities, and export officer-ready reports.

## Included in this MVP

- Separate admin and read-only viewer passcodes with signed, HTTP-only role sessions
- Reports protected from deletion by default, with persistent admin-controlled padlocks
- First-time alliance setup, editable name/tag/server, and an empty roster for new installations
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

Local screenshot extraction defaults to **GPT-5.6 Sol** (`gpt-5.6-sol`) with **high reasoning**, reading at most six screenshots per batch, including the retry when no rows are found. This also applies to **Queue for PC Codex**, which launches the same extraction script for each job. It does not change your general Codex model setting. Manual runs can select a different model with `--model <name>`.

## Phone-to-PC Codex bridge

The queue bridge lets an officer choose a screen recording directly from the deployed Alliance Manager on an iPhone. The browser extracts JPEG frames on the phone, so the original recording never leaves the device. Those frames are uploaded directly to the private Vercel Blob store and wait for a trusted PC worker.

On the PC, add the worker settings to `.env.bridge.local`:

```dotenv
BRIDGE_URL=https://your-alliance-app.vercel.app
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
| `OFFICER_PASSCODE` | Configured admin passcode, 1–256 characters; no default |
| `VIEWER_PASSCODE` | Optional viewer passcode, 1–256 characters; unset disables viewers |
| `SESSION_SECRET` | Required random signing secret, at least 32 characters; no default |
| `OPENAI_API_KEY` | Reads uploaded leaderboard screenshots |
| `OPENAI_VISION_MODEL` | Optional; defaults to `gpt-5-mini` |
| `BLOB_READ_WRITE_TOKEN` / `BLOB1_READ_WRITE_TOKEN` | Added by Vercel when the private Blob store is connected |
| `CRON_SECRET` | Protects the scheduled cleanup endpoint |
| `BRIDGE_SECRET` | Authenticates the local PC queue worker; falls back to `OFFICER_PASSCODE` |
| `BRIDGE_URL` | Required local worker target: this alliance deployment URL |

After connecting this repository to Vercel, deploy normally. [`vercel.json`](vercel.json) schedules a daily cleanup request. Upload metadata and the original private blob are removed after five days; published ranking data remains.

## Capture guidance

### Ranking screenshots

- Take overlapping screenshots while scrolling slowly.
- Alternatively, upload one slow iPhone screen recording. Frames are extracted in the browser before OCR, so the original recording stays on the officer's device.
- Ensure every rank appears fully in at least one screenshot.
- Repeated ranges are safe and are deduplicated by rank.
- The fixed green personal-rank card is detected and ignored.
- Use `live` for Monday–Friday and `final` for Saturday.
- During transfers, do not infer that unranked players scored zero until a current roster capture exists.

## Verification

```powershell
npm run test
npm run lint
npm run build
```

## Security configuration

Set credentials before starting locally or deploying; the example environment intentionally contains no usable password. Generate SESSION_SECRET with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and store it only in the private environment configuration. Admin/viewer passphrases must differ. Missing credentials disable that role; missing/weak session configuration blocks sign-in. Role-less legacy sessions require a fresh login. Rotate SESSION_SECRET to invalidate every existing session after a suspected leak or passcode compromise.

Viewer responses exclude officer notes, operations, source filenames and upload paths before HTML/JSON serialization. Stored history is unchanged. Public branding and bundled avatar images remain public; API paths used by a browser can be discovered, so server-side authorization protects the data.

Login attempts are limited to ten per five minutes per trusted Vercel IP and server process. Outside Vercel a shared local bucket avoids trusting spoofed forwarding headers. This limiter resets on restart and does not coordinate separate instances. Configure a Vercel WAF rate-limit rule for POST /api/auth/login (ten requests per five minutes per IP) for shared edge enforcement: https://vercel.com/kb/guide/limit-abuse-with-rate-limiting . Also apply appropriate upload/extraction limits at the edge. The code does not create external firewall rules.

Browser requests receive a nonce-based script CSP, frame blocking, no-sniff, no-referrer, restricted browser permissions and private no-store responses. API requests from other browser origins are rejected; authenticated worker/cron requests without Origin remain supported. Inline styles are allowed for existing charts and layout; scripts are nonce-gated. The Blob upload SDK requires its Vercel hosts in connect-src.

This application uses JSON files/private Blob objects and has no SQL query execution. Future database integrations must use parameterized queries and preserve server-only credentials. Never add secrets to NEXT_PUBLIC variables, client modules, public files, source maps, logs or error responses. Current-source review cannot establish whether historical commits or external deployments have exposed credentials; audit those separately before claiming a historical leak is absent.
