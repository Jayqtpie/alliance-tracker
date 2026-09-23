// Runs apply-check.ts only; it needs a live snapshot, so the normal test run leaves it out.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: [".claude/skills/rscl-roster-refresh/scripts/apply-check.ts"] },
});
