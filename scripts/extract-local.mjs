import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const schemaPath = resolve("scripts", "leaderboard-output.schema.json");
const usage = `
Local Codex leaderboard extraction

Usage:
  npm run extract:local -- <screenshot...>
  npm run extract:local -- --out results.json <screenshot...>

Options:
  --out <path>       Output JSON path (defaults to local-extractions/)
  --profile <name>   Optional Codex CLI configuration profile
  --model <name>     Optional Codex model override
  --help             Show this help

The Codex CLI must be signed in with ChatGPT. Run "codex login" once if needed.
`;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = { images: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") return { help: true, images: [] };
    if (value === "--out" || value === "--profile" || value === "--model") {
      const next = argv[index + 1];
      if (!next) fail(`${value} needs a value.`);
      options[value.slice(2)] = next;
      index += 1;
      continue;
    }
    if (value.startsWith("--")) fail(`Unknown option: ${value}`);
    options.images.push(value);
  }
  return options;
}

function commandResult(commandArgs, capture = false) {
  const stdio = capture ? ["ignore", "pipe", "pipe"] : "inherit";
  if (process.platform !== "win32") {
    return spawnSync("codex", commandArgs, { encoding: "utf8", stdio });
  }

  const lookup = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "(Get-Command codex -ErrorAction Stop).Source"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const executable = lookup.stdout?.trim();
  if (lookup.status !== 0 || !executable) {
    return { status: 1, error: new Error("Codex CLI was not found."), stdout: "", stderr: lookup.stderr };
  }

  if (extname(executable).toLowerCase() === ".ps1") {
    return spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, ...commandArgs],
      { encoding: "utf8", stdio },
    );
  }
  return spawnSync(executable, commandArgs, { encoding: "utf8", stdio });
}

function validateRows(value, batchLabel) {
  if (!value || typeof value !== "object" || !Array.isArray(value.rows)) {
    fail(`Codex returned an invalid result for ${batchLabel}: expected an object containing rows.`);
  }
  return value.rows.map((row, index) => {
    if (
      !row ||
      typeof row !== "object" ||
      !Number.isInteger(row.rank) || row.rank < 1 ||
      typeof row.displayName !== "string" || !row.displayName.trim() ||
      !Number.isInteger(row.points) || row.points < 0 ||
      typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1 ||
      typeof row.isPinned !== "boolean" ||
      typeof row.needsReview !== "boolean"
    ) {
      fail(`Codex returned an invalid row at position ${index + 1} for ${batchLabel}.`);
    }
    return { ...row, displayName: row.displayName.trim() };
  });
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(usage.trim());
  process.exit(0);
}
if (!options.images.length) {
  console.log(usage.trim());
  fail("Add at least one screenshot path.");
}
if (options.images.length > 25) fail("A maximum of 25 screenshots can be processed at once.");
if (!existsSync(schemaPath)) fail(`Output schema was not found at ${schemaPath}.`);

const images = options.images.map((value) => resolve(value));
for (const image of images) {
  if (!existsSync(image)) fail(`Screenshot not found: ${image}`);
  if (!imageExtensions.has(extname(image).toLowerCase())) fail(`Unsupported image type: ${image}`);
}

const auth = commandResult(["login", "status"], true);
const authText = `${auth.stdout || ""}\n${auth.stderr || ""}`.trim();
if (/api key/i.test(authText)) {
  fail("Codex is currently using API-key authentication. Run \"codex logout\" and then \"codex login\" to select ChatGPT sign-in.");
}
if (!/chatgpt/i.test(authText)) {
  console.warn("Codex login status could not confirm ChatGPT authentication in this shell. Continuing so Codex can use its normal sign-in flow.");
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outputPath = options.out
  ? (isAbsolute(options.out) ? options.out : resolve(options.out))
  : resolve("local-extractions", `last-war-rankings-${timestamp}.json`);
mkdirSync(dirname(outputPath), { recursive: true });

const batches = [];
for (let index = 0; index < images.length; index += 18) batches.push(images.slice(index, index + 18));
const allRows = [];

function readBatch(batch, batchIndex, focusedRetry = false) {
  const attempt = focusedRetry ? "retry" : "initial";
  const temporaryOutput = join(tmpdir(), `alliance-tracker-codex-${process.pid}-${batchIndex}-${attempt}.json`);
  const fileList = batch.map((image, imageIndex) => `Image ${imageIndex + 1}: ${basename(image)}`).join("\n");
  const retryInstruction = focusedRetry
    ? "The first pass returned no rows. Inspect the full image carefully, including any inset or padded area. Look for a leaderboard with rank at left, commander name in the middle, and points at right. Extract a row whenever those three values are readable, even if decorative panel edges or the alliance subtitle are cropped. Return an empty rows array only when no such leaderboard row exists anywhere in any attached image. "
    : "";
  const prompt =
    "Read the attached Last War Alliance Duel Weekly Rank screenshots as OCR only. " +
    retryInstruction +
    "Extract every readable complete player row from every image. Preserve each commander display name exactly, including Unicode, spacing, punctuation, and case. " +
    "Return points as integers without commas. The green player card fixed at the bottom is the viewer's pinned rank: include it only with isPinned=true. " +
    "Set isPinned=false for ordinary leaderboard rows. Ignore headers, alliance text, chat banners, and rows where rank, name, or points are not readable. " +
    "Set needsReview=true when any character or number is uncertain and lower confidence accordingly. Keep overlapping duplicate observations; the tracker will reconcile them. " +
    "Do not use tools, edit files, or add commentary. Return only the JSON required by the provided schema.\n\n" + fileList;
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-rules",
    "--config", `model_reasoning_effort="${focusedRetry ? "medium" : "low"}"`,
    "--config", 'model_reasoning_summary="none"',
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--output-schema", schemaPath,
    "--output-last-message", temporaryOutput,
  ];
  if (options.profile) args.push("--profile", options.profile);
  if (options.model) args.push("--model", options.model);
  batch.forEach((image) => args.push("--image", image));
  args.push("--", prompt);

  const result = commandResult(args);
  if (result.error || result.status !== 0) {
    rmSync(temporaryOutput, { force: true });
    fail(`Codex extraction failed for batch ${batchIndex + 1}${focusedRetry ? " during its focused retry" : ""}.`);
  }
  try {
    const parsed = JSON.parse(readFileSync(temporaryOutput, "utf8"));
    return validateRows(parsed, `batch ${batchIndex + 1}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : `Could not read batch ${batchIndex + 1}.`);
  } finally {
    rmSync(temporaryOutput, { force: true });
  }
}

console.log(`Using Codex with ChatGPT sign-in to read ${images.length} screenshot${images.length === 1 ? "" : "s"} in ${batches.length} batch${batches.length === 1 ? "" : "es"}.`);
for (let index = 0; index < batches.length; index += 1) {
  const batch = batches[index];
  console.log(`\nReading batch ${index + 1}/${batches.length}...`);
  let rows = readBatch(batch, index);
  if (!rows.length) {
    console.warn(`No ranking rows were found in batch ${index + 1}; retrying once with a focused inspection...`);
    rows = readBatch(batch, index, true);
  }
  allRows.push(...rows);
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "codex-cli",
  sourceFiles: images.map((image) => basename(image)),
  rows: allRows,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`\nSaved ${allRows.length} extracted row${allRows.length === 1 ? "" : "s"} to:\n${outputPath}`);
console.log("Open Alliance Manager > New import > Import Codex JSON, then review and publish.");
