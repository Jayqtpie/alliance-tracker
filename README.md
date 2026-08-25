# Rascals Command

A mobile-friendly Alliance Duel tracker for **RSCL · The Rascals**. Officers can upload overlapping Last War leaderboard screenshots, review extracted rankings, publish live or final snapshots, compare matching weeks, manage commander aliases, and export CSV reports.

## Included in this MVP

- Shared officer passcode with a signed, HTTP-only session cookie
- Tuesday 25 August 2026 seed snapshot for ranks 1–90
- Multi-image extraction through the OpenAI Responses API
- Automatic removal of the repeated green pinned-player card
- Rank deduplication, gap warnings, confidence flags, and human review
- Same-weekday comparison for Monday–Friday live captures
- Week-over-week comparison for Saturday final captures
- Score difference, percentage change, and rank movement
- Commander aliases for common name changes
- Five-day retention for original screenshots
- Private Vercel Blob persistence with a local JSON development fallback
- Responsive officer dashboard and CSV export

## Local development

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Without a connected Vercel Blob store, development data is stored under `.data/` and is deliberately ignored by Git. Without `OPENAI_API_KEY`, the dashboard still supports manual CSV/tab-separated imports.

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

After connecting this repository to Vercel, deploy normally. [`vercel.json`](vercel.json) schedules a daily cleanup request. Upload metadata and the original private blob are removed after five days; published ranking data remains.

## Capture guidance

- Take overlapping screenshots while scrolling slowly.
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
