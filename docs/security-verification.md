# Security changes and verification — 13 September 2026

Outcome: the five source findings and one production dependency advisory were addressed locally and the changes passed focused regression, full-suite, build and production-runtime checks. This is not confirmation of the live deployment or historical leak status. Runtime data and firewall rules are unchanged. Login compatibility and publication verification are recorded below.

## Changes

| Boundary | Change | Verification |
| --- | --- | --- |
| Session authenticity | Removed the public fallback signing key; require a non-placeholder secret of at least 32 characters; reject malformed, expired, non-finite, role-less and trailing-segment cookies. | Valid admin/viewer cookies work; invalid configuration returns 503; forged/malformed sessions fail. |
| Login | Removed default passwords; each enabled role uses its explicitly configured passcode (1–256 characters), preserving the owner-selected passwords. Added a streamed 2 KB body limit and a bounded per-process ten-attempt/five-minute limiter. | Defaults rejected; oversized body returns 413; throttled requests return 429, Retry-After and no session cookie. |
| Viewer confidentiality | One server-only allowlist projects both initial page props and state API responses. Officer notes, operations, original filenames, upload paths and internal import metadata are omitted. Corresponding profile controls are hidden. | Both production HTML and JSON lack sentinel private fields; admin data, names, scores and history remain intact. |
| Import availability | Missing-rank generation uses arithmetic gaps and bounded output; both shared processing paths avoid rank-sized work. Worker ownership is checked before deduplication. Local JSON row/name sizes are bounded. | Billion-sized and MAX_SAFE_INTEGER ranks finish with bounded warnings; ordinary gaps, Unicode names and pinned/conflicting rows retain behavior. |
| Spreadsheet export | A shared CSV serializer neutralizes formula/control-leading text while preserving numeric cells and stored names. | Formula, whitespace/control and Unicode/quote cases pass; numeric negative deltas remain numeric; real browser CSV and PNG downloads work. |
| Browser protections | Nonce-based script CSP, frame blocking, no-sniff, no-referrer, restricted browser permissions, no-index, no-store and HTTPS HSTS headers; browser source maps disabled. API browser origins are checked against the externally requested Host. | Production nonce matches rendered scripts; both roles log in; theme and reports work; foreign-origin writes return 403. |
| Error disclosure | Generic storage/provider errors and browser-facing PC failure messages keep SDK details and local filesystem paths out of responses. | Regression tests confirm safe storage errors and masked worker path sentinels; existing conflict/validation behavior remains. |

Main implementation: `lib/auth.ts`, login route, `lib/state-view.ts`, state route and home page, `lib/rank-gaps.ts`, `lib/tracker.ts`, `lib/csv.ts`, `proxy.ts`, `lib/request-security.ts`, `lib/login-rate-limit.ts`, storage/bridge/extraction error boundaries, and affected client rendering.

## Checks run

- `npm test`: **172 passed**, 24 test files.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript.
- `git diff --check`: passed.
- `npm audit --omit=dev`: **zero known production dependency vulnerabilities** after the Sharp patch. This excludes development dependencies and is a point-in-time advisory result.
- Authorization matrix covers the actual declared mutation/worker methods; requests are rejected before state/queue access.
- Local production HTTP checks: anonymous state 401; both role logins 200; viewer mutation 401; cross-origin mutation 403; built-in viewer password 401; oversized body 413; throttling 429 with Retry-After.
- Headless Edge with isolated sample data: viewer member profile, admin report navigation, theme selection, CSV download and PNG export succeeded with no application script errors. External requests were blocked in the test browser. A machine-installed antivirus script attempted an external request; it was blocked and was not part of this repository.
- Tracked-file credential-pattern scan: no matches. Only `.env.example` is tracked. The configured local bridge secret and target URL did not occur in `.next/static`; browser source-map count is zero. These checks do not prove that every possible secret format or historical exposure is absent.
- Test server was stopped after verification. Fictional fixtures and runtime evidence remain in ignored `.data/security-preview/`; original tracker data was not used by the test server.

## Deployment work and limits

1. Configure the owner-selected admin/viewer passcodes and a random SESSION_SECRET before deployment. Unconfigured values intentionally stop login; an unset viewer passphrase disables new viewer logins. Rotate SESSION_SECRET to revoke all existing sessions after suspected compromise or passcode changes.
2. Configure shared edge enforcement for login attempts and appropriate upload/extraction limits. The code limiter is per process and resets on restart; it is not distributed protection. Vercel guidance: https://vercel.com/kb/guide/limit-abuse-with-rate-limiting . Trusted Vercel request-header behavior: https://vercel.com/docs/headers/request-headers . Outside Vercel, clients share one local bucket because arbitrary forwarding headers are not trusted.
3. Cloud Blob upload/OCR and live deployment behavior were not exercised because they require production external configuration. The CSP permits the installed Blob client's Vercel upload destinations; private uploads, existing MIME/size/path bounds and route authorization remain in place.
4. After explicit approval, `npm audit --omit=dev` identified the high-severity Sharp/libheif advisory GHSA-rgj7-g3m4-5g8c. Updated Sharp 0.35.3 to 0.35.4 within Next.js's existing ^0.35.3 range, with install scripts disabled; the lockfile updates its corresponding native packages. A fresh production audit reports **zero known vulnerabilities**. A real Sharp PNG create/resize operation passes. Advisory: https://github.com/advisories/GHSA-rgj7-g3m4-5g8c .
5. No SQL engine or query execution path exists in the reviewed application; persistence is private Blob/local JSON. A future SQL integration must use parameterized queries. Browser-used API routes and upload hosts are necessarily discoverable; authorization, not hidden names, protects data. Branding/avatar files under public remain public.
6. Git history, deployed secrets, repository hosting visibility and external account policies were not inspected. Current source/bundle checks cannot establish historical leak absence. The owner subsequently requested committing and pushing the verified changes; production login verification is recorded below.

## Baseline scan

The completed security scan records the original snapshot before these fixes (three medium and two low findings). Its immutable findings remain baseline evidence; this document records local remediation and validation. Scan ID: `127c705a-0b63-4e5c-be48-b6229e30e984`.

Scan tool-reported usage: 7,925,021 tokens, including 7,519,872 cached input tokens, across four threads. This measurement covers the scan phase, not all subsequent remediation work.

## Password compatibility and publication follow-up

The minimum passcode length restriction was removed at the owner's request. Both owner-selected passwords are exercised through the real login handler with explicit environment configuration; both returned HTTP 200 and the expected admin/viewer signed-cookie roles in the isolated production runtime. Viewer writes were rejected and private fields remained omitted. Missing credentials still disable login, identical role credentials are rejected, and the independent random signing secret remains required. Passcodes are not installed as runtime source-code defaults.

Before publication, both owner-selected passwords also returned HTTP 200, the expected roles and session cookies at the explicitly approved production URL. Deployment environment values were not exposed or copied into source. Post-publication deployment and login results are reported in the task response.
