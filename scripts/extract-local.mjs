import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import sharp from "sharp";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const schemaPath = resolve("scripts", "leaderboard-output.schema.json");
const batchSize = 3;
const stripWidth = 1500;
const usage = `
Claude Code leaderboard extraction

Usage:
  npm run extract:local -- <screenshot...>
  npm run extract:local -- --out results.json <screenshot...>

Options:
  --out <path>       Output JSON path (defaults to local-extractions/)
  --model <name>     Claude model override (default: opus)
  --help             Show this help

Extraction uses high effort, including retries, and reads each screenshot
alongside zoomed strips of it so small names are read at full resolution.
Claude Code must be signed in with a Claude subscription: run "claude" once and
log in, or set CLAUDE_CODE_OAUTH_TOKEN from "claude setup-token".
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
    if (value === "--out" || value === "--model") {
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

// Never let an API key take precedence over the subscription sign-in.
const claudeEnvironment = { ...process.env };
for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION"]) delete claudeEnvironment[name];

function claude(commandArgs, cwd) {
  return spawnSync("claude", commandArgs, {
    cwd,
    env: claudeEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function validateRows(value, batchLabel) {
  if (!value || typeof value !== "object" || !Array.isArray(value.rows)) {
    fail(`Claude returned an invalid result for ${batchLabel}: expected an object containing rows.`);
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
      fail(`Claude returned an invalid row at position ${index + 1} for ${batchLabel}.`);
    }
    return { ...row, displayName: row.displayName.trim() };
  });
}

// Overlapping horizontal strips, upscaled so each name is seen at full detail.
async function writeStrips(image, folder, prefix) {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) fail(`Could not read image dimensions: ${image}`);
  const stripHeight = Math.min(height, Math.round(width * 0.8));
  const step = Math.round(stripHeight * 0.75);
  const tops = [];
  for (let top = 0; top + stripHeight < height; top += step) tops.push(top);
  tops.push(height - stripHeight);
  const names = [];
  for (const [index, top] of tops.entries()) {
    const name = `${prefix}-strip-${index + 1}.png`;
    await sharp(image)
      .extract({ left: 0, top, width, height: stripHeight })
      .resize({ width: stripWidth, kernel: "lanczos3" })
      .png()
      .toFile(join(folder, name));
    names.push(name);
  }
  return names;
}

const options = parseArguments(process.argv.slice(2));
const extractionModel = options.model || "opus";
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
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
delete schema.$schema;

const images = options.images.map((value) => resolve(value));
for (const image of images) {
  if (!existsSync(image)) fail(`Screenshot not found: ${image}`);
  if (!imageExtensions.has(extname(image).toLowerCase())) fail(`Unsupported image type: ${image}`);
}

const auth = claude(["auth", "status"]);
if (auth.error) fail("Claude Code CLI was not found. Install it from https://claude.com/claude-code and sign in.");
const authText = `${auth.stdout || ""}\n${auth.stderr || ""}`;
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !/"loggedIn":\s*true/.test(authText)) {
  fail("Claude Code is not signed in. Run \"claude\" once and log in with your Claude subscription.");
}
if (/"authMethod":\s*"[^"]*api[^"]*key/i.test(authText)) {
  fail("Claude Code is using API-key authentication. Log in with your Claude subscription instead.");
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const outputPath = options.out
  ? (isAbsolute(options.out) ? options.out : resolve(options.out))
  : resolve("local-extractions", `last-war-rankings-${timestamp}.json`);
mkdirSync(dirname(outputPath), { recursive: true });

const batches = [];
for (let index = 0; index < images.length; index += batchSize) batches.push(images.slice(index, index + batchSize));
const allRows = [];
// fail() exits without running finally blocks, so copied screenshots are removed here too.
const temporaryFolders = new Set();
process.on("exit", () => {
  for (const folder of temporaryFolders) rmSync(folder, { recursive: true, force: true });
});

async function prepareBatch(batch, folder) {
  const lines = [];
  for (const [index, image] of batch.entries()) {
    const prefix = `screenshot-${index + 1}`;
    const full = `${prefix}${extname(image).toLowerCase()}`;
    copyFileSync(image, join(folder, full));
    const strips = await writeStrips(image, folder, prefix);
    lines.push(`Screenshot ${index + 1}: ${full}\n  Zoomed strips, top to bottom: ${strips.join(", ")}`);
  }
  return lines.join("\n");
}

function readBatch(fileList, folder, batchIndex, focusedRetry = false) {
  const retryInstruction = focusedRetry
    ? "The first pass returned no rows. Inspect the full image carefully, including any inset or padded area. Look for a leaderboard with rank at left, commander name in the middle, and points at right. Extract a row whenever those three values are readable, even if decorative panel edges or the alliance subtitle are cropped. Return an empty rows array only when no such leaderboard row exists anywhere in any attached image. "
    : "";
  const prompt =
    "Read the listed Last War Alliance Duel Weekly Rank screenshots as OCR only. Open every listed file with the Read tool; they are in the current directory. " +
    retryInstruction +
    "Each screenshot comes with overlapping zoomed strips of the same screenshot, top to bottom. Use the full screenshot to locate each row and pair its rank, name and points; use the zoomed strips to read every commander name character by character. When the full screenshot and a strip disagree about a name, trust the strip. Each strip overlaps its neighbours, so a row can appear in two strips: report it once. " +
    "Extract every readable complete player row from every screenshot. Preserve each commander display name exactly, including Unicode, spacing, punctuation, and case. " +
    "Transcribe Korean Hangul, Chinese characters, Japanese kana/kanji, Cyrillic, Arabic, Thai and accented letters in their original script. Never translate, romanize, substitute Latin lookalikes, or drop combining marks. Recheck small or mixed-script names character by character and compare clearer observations in overlapping screenshots. " +
    "Judge name confidence separately from readable ranks and scores. If any name character remains uncertain, use the best visible transcription, set needsReview=true and confidence below 0.86; never invent missing characters. " +
    "Return points as integers without commas. The green player card fixed at the bottom is the viewer's pinned rank: include it only with isPinned=true. " +
    "Set isPinned=false for ordinary leaderboard rows. Ignore headers, alliance text, chat banners, and rows where rank, name, or points are not readable. " +
    "Set needsReview=true when any character or number is uncertain and lower confidence accordingly. Keep overlapping duplicate observations across different screenshots; the tracker will reconcile them. Before returning, revisit every screenshot and check that each visible rank is represented, each score belongs to the same horizontal row as its name, and no alliance subtitle was copied into a name. " +
    "Do not edit files or add commentary. Return only the structured output.\n\n" + fileList;
  const args = [
    "-p", prompt,
    "--model", extractionModel,
    "--effort", "high",
    "--allowedTools", "Read",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--no-session-persistence",
    "--setting-sources", "project",
    "--strict-mcp-config",
  ];

  const result = claude(args, folder);
  const label = `batch ${batchIndex + 1}${focusedRetry ? " during its focused retry" : ""}`;
  if (result.error) fail(`Claude extraction could not start for ${label}: ${result.error.message}`);
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    fail(`Claude extraction failed for ${label}.${result.stderr ? `\n${result.stderr.trim().slice(0, 500)}` : ""}`);
  }
  if (result.status !== 0 || output.is_error || !output.structured_output) {
    fail(`Claude extraction failed for ${label} (${output.subtype || `exit ${result.status}`}).`);
  }
  return validateRows(output.structured_output, `batch ${batchIndex + 1}`);
}

console.log(`Using Claude ${extractionModel} with high effort to read ${images.length} screenshot${images.length === 1 ? "" : "s"} in ${batches.length} batch${batches.length === 1 ? "" : "es"}.`);
for (let index = 0; index < batches.length; index += 1) {
  const folder = mkdtempSync(join(tmpdir(), "alliance-tracker-claude-"));
  temporaryFolders.add(folder);
  try {
    const fileList = await prepareBatch(batches[index], folder);
    console.log(`\nReading batch ${index + 1}/${batches.length}...`);
    let rows = readBatch(fileList, folder, index);
    if (!rows.length) {
      console.warn(`No ranking rows were found in batch ${index + 1}; retrying once with a focused inspection...`);
      rows = readBatch(fileList, folder, index, true);
    }
    allRows.push(...rows);
  } finally {
    rmSync(folder, { recursive: true, force: true });
    temporaryFolders.delete(folder);
  }
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: "claude-code",
  sourceFiles: images.map((image) => basename(image)),
  rows: allRows,
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`\nSaved ${allRows.length} extracted row${allRows.length === 1 ? "" : "s"} to:\n${outputPath}`);
console.log("Open Alliance Manager > New import > Import extraction JSON, then review and publish.");
