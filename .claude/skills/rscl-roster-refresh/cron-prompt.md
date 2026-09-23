This is an unattended, scheduled roster refresh running in GitHub Actions. Nobody is watching and nobody can answer a question, so never stop to ask: either finish with a commit, or stop without one and say why.

Run the rscl-roster-refresh skill: read `.claude/skills/rscl-roster-refresh/SKILL.md` and follow its pipeline and rules exactly, with these settings for this run:

- `<date>` is today's UTC date.
- Step 2: dispatch the collection to a subagent with the Agent tool and `model: "sonnet"`, scoped as the skill says. Re-derive every number yourself from `.data/lastrank-refresh-<date>/capture.json`; do not trust the subagent's summary.
- Skip the render check. Run the apply check from the skill's verification list instead; it is the gate that replaces it.
- Do not push. The workflow re-runs every check and pushes after you exit.

Commit only when all of these hold:

1. The collector reached every listed profile with no hard error (exit code 1, HTTP error, non-JSON, identity mismatch). A `--check` exit code 2 caused only by retained profiles or a listed player with `alliance_id: null` is not a failure under the skill's rules: retained profiles keep their values, and UID-less players are skipped.
2. The builder wrote `lib/data/rscl-roster-<date>.json`, and its summary shows at least one real change against the deployed state: a rename, a rank change, a changed statistic or avatar, or a member joining or leaving the list. If nothing changed, stop without committing. The probe result at the end of this prompt says why the run started; confirm it against the built export rather than assuming.
3. `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` are clean, after updating only the fact-coupled tests the skill lists. Do not weaken, skip or delete any other assertion to get green, and never edit the skill's scripts around an error.
4. The apply check passes.

If any of these fails and the fix is not one of the skill's listed test updates, stop without committing and say which condition failed.

Power moves beyond roughly ±15% are expected (power depends on troops); cross-check `hero_power`, and list any move you could not explain in the commit body rather than blocking on it.

Commit by staging explicit paths only: the new export, changed avatars under `public/avatars/rscl/`, `lib/roster-import.ts`, and the test files you updated. Never stage `next-env.d.ts`, `tsconfig.tsbuildinfo` or anything under `.data/`. The subject is `Refresh the RSCL roster from LastRank (<date>)`, with a short body of counts: active, fresh, retained, renamed, rank changes, changed stats, changed avatars.

The Actions log is public. Your final message must contain counts and the commit SHA only, with no player names.
