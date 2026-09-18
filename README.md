# Alliance Manager

A mobile-friendly Alliance Duel tracker for alliance leadership. Officers can upload overlapping Last War leaderboard screenshots or an iPhone screen recording, review extracted rankings, publish live or final snapshots, compare matching weeks, manage commander identities, and export officer-ready reports.

## Included in this MVP

- Separate admin and read-only viewer passcodes with signed, HTTP-only role sessions
- Reports protected from deletion by default, with persistent admin-controlled padlocks
- First-time alliance setup, editable name/tag/server, and an empty roster for new installations
- Multi-image extraction with Claude Code on a Claude subscription, run by GitHub Actions
- Local Claude Code extraction as a manual backup
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

Without a connected Vercel Blob store, development data is stored under `.data/` and is deliberately ignored by Git. Without extraction configured, the dashboard still supports manual CSV/tab-separated imports.

## Claude extraction

Screenshots are read by Claude Code running on the owner's Claude subscription, not a paid API key. Queued captures are processed by a GitHub Actions workflow, so no PC needs to be on. The same extraction script also runs locally as a manual backup.

Each screenshot is read together with overlapping zoomed strips of itself, so small and non-Latin commander names are read at full resolution. Extraction uses Claude Opus with high effort, three screenshots per batch, and one focused retry when a batch returns no rows.

### Queue extraction (GitHub Actions)

1. On any computer signed in to Claude Code, run `claude setup-token` and copy the long-lived token.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions** and add:
   - `CLAUDE_CODE_OAUTH_TOKEN`: the token from step 1
   - `BRIDGE_URL`: this alliance deployment URL
   - `BRIDGE_SECRET`: the same value configured in Vercel
3. Create a fine-grained GitHub token limited to this repository with **Contents: read and write**. In Vercel, add it as `GITHUB_DISPATCH_TOKEN` and set `GITHUB_REPO` to `owner/name`.

Then, from the phone or any browser:

1. Open **New import** and choose screenshots or a screen recording. The browser turns a recording into up to 18 frames on the device, so the original video is never uploaded.
2. Choose **Extract with Claude**. The frames are uploaded to the private Vercel Blob store and the **Bridge extraction** workflow starts.
3. The page changes from waiting, to processing, to rows ready, usually within a few minutes. Review the rows and publish.

The workflow can also be started by hand from the **Actions** tab. It processes every waiting job and then stops. The repository is public, so workflow logs are public. They show job IDs and row counts only, never names or screenshots. Queue records and private frames expire after five days.

### Local extraction (manual backup)

1. Install [Claude Code](https://claude.com/claude-code) and sign in once with your Claude subscription by running `claude`.
2. From this repository, run the extractor with one or more screenshots:

   ```powershell
   npm run extract:local -- "C:\pathank-01.png" "C:\pathank-02.png"
   ```

   To choose the output filename:

   ```powershell
   npm run extract:local -- --out "C:\path	uesday-results.json" "C:\pathank-01.png"
   ```

3. Open **New import** in Alliance Manager, choose **Import extraction JSON**, review the rows, and publish the snapshot.

The extractor removes `ANTHROPIC_API_KEY` from Claude's environment and refuses an API-key login, so it always uses the subscription. Claude may only read the copied screenshots. The extractor keeps no session and writes only the result JSON. Choose a different model with `--model <name>`.

A PC can still act as the queue worker instead of GitHub Actions. Put `BRIDGE_URL` and `BRIDGE_SECRET` in `.env.bridge.local`, then run `npm run bridge:worker`. Add `-- --once` to process every waiting job once and exit.

OpenAI screenshot extraction is still in the code but switched off (`openAiExtractionEnabled` in `lib/extract.ts`).

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
| `OPENAI_API_KEY` | Unused while OpenAI extraction is switched off |
| `OPENAI_VISION_MODEL` | Unused while OpenAI extraction is switched off |
| `BLOB_READ_WRITE_TOKEN` / `BLOB1_READ_WRITE_TOKEN` | Added by Vercel when the private Blob store is connected |
| `CRON_SECRET` | Protects the scheduled cleanup endpoint |
| `BRIDGE_SECRET` | Authenticates the queue worker (GitHub Actions or PC); falls back to `OFFICER_PASSCODE` |
| `BRIDGE_URL` | Queue worker target: this alliance deployment URL |
| `GITHUB_DISPATCH_TOKEN` | Starts the GitHub Actions extraction when a capture is queued |
| `GITHUB_REPO` | This repository as `owner/name` |

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
