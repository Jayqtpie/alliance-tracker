import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import sharp from "sharp";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const schemaPath = resolve("scripts", "leaderboard-output.schema.json");
const lineupSchemaPath = resolve("scripts", "storm-lineup-output.schema.json");
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
  --kind <kind>      duel (default), storm (Desert/Canyon Storm battle results mail)
                     or storm-lineup (a storm's View Participants list for one Task Force)
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
    if (value === "--out" || value === "--model" || value === "--kind") {
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

// A lineup screen's rows become the tracker's row shape: hero power rides in points, and rank is only
// the order read (the tracker re-numbers after de-duplicating, since the screen has no ranks).
function validateLineup(value, batchLabel) {
  if (!value || typeof value !== "object" || !Array.isArray(value.rows)) {
    fail(`Claude returned an invalid result for ${batchLabel}: expected an object containing rows.`);
  }
  const rows = value.rows.map((row, index) => {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.displayName !== "string" || !row.displayName.trim() ||
      !Number.isInteger(row.heroPower) || row.heroPower < 0 ||
      (row.role !== "starter" && row.role !== "sub") ||
      typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1 ||
      typeof row.needsReview !== "boolean"
    ) {
      fail(`Claude returned an invalid row at position ${index + 1} for ${batchLabel}.`);
    }
    return { rank: index + 1, displayName: row.displayName.trim(), points: row.heroPower, role: row.role, confidence: row.confidence, isPinned: false, needsReview: row.needsReview };
  });
  const header = {};
  if (value.taskForce === "A" || value.taskForce === "B") header.team = value.taskForce;
  if (Number.isInteger(value.startersShown) && value.startersShown >= 0) header.starters = value.startersShown;
  if (Number.isInteger(value.subsShown) && value.subsShown >= 0) header.subs = value.subsShown;
  if (typeof value.battleTime === "string" && value.battleTime.trim()) header.battleTime = value.battleTime.trim().slice(0, 80);
  return { rows, header };
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
const kind = options.kind || "duel";
if (kind !== "duel" && kind !== "storm" && kind !== "storm-lineup") fail(`Unknown --kind: ${kind}. Use duel, storm or storm-lineup.`);
const kindSchemaPath = kind === "storm-lineup" ? lineupSchemaPath : schemaPath;
if (!existsSync(kindSchemaPath)) fail(`Output schema was not found at ${kindSchemaPath}.`);
const schema = JSON.parse(readFileSync(kindSchemaPath, "utf8"));
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
const lineupHeader = {};
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

// The Desert/Canyon Storm "Battle Results!" mail: one team's players who entered, ranked by points.
// Scrolled screenshots overlap; the tracker de-duplicates by rank.
function stormPrompt(fileList, focusedRetry) {
  const retryInstruction = focusedRetry
    ? "The first pass returned no rows. Inspect the full image carefully. Each row is a rank (a medal for 1 to 3, a plain number after that), an avatar, then the name with the score on the line beneath it. Extract a row whenever rank, name and score are readable. Return an empty rows array only when no such row exists anywhere in any attached image. "
    : "";
  return "Read the listed Last War Desert Storm or Canyon Storm \"Battle Results!\" mail screenshots as OCR only. Open every listed file with the Read tool; they are in the current directory. " +
    retryInstruction +
    "Each screenshot comes with overlapping zoomed strips of the same screenshot, top to bottom. Use the full screenshot to locate each row; use the zoomed strips to read every name character by character. When the full screenshot and a strip disagree about a name, trust the strip. A row can appear in two strips: report it once per screenshot. " +
    "Each row shows a rank at the left (ranks 1, 2 and 3 are medals with the number on them), an avatar, the player's name, and their score on the line under the name. Return rank, the name as displayName, and the score as points. " +
    "Names start with an alliance tag in square brackets, such as [RSCL]. Leave the tag off displayName and return the rest of the name exactly, including Unicode, spacing, punctuation and case. " +
    "Transcribe Korean Hangul, Chinese characters, Japanese kana/kanji, Cyrillic, Arabic, Thai, accented letters, and decorative symbols in their original form. Keep superscript and small-capital letters as they appear and count repeated characters exactly. Never translate, romanize, substitute Latin lookalikes, or drop combining marks. " +
    "If any name character remains uncertain, use the best visible transcription, set needsReview=true and confidence below 0.86; never invent missing characters. " +
    "Return points as integers without commas. Set isPinned=false on every row. Ignore the mail title, the scrolling announcement banner across the top, the date at the bottom, the buttons, and rows cut off at the top or bottom edge so that rank, name or score is not readable. " +
    "Keep overlapping duplicate observations across different screenshots; the tracker will reconcile them. Before returning, revisit every screenshot and check that each visible rank is represented and each score belongs to the name directly above it. " +
    "Do not edit files or add commentary. Return only the structured output.\n\n" + fileList;
}

// A storm's "View Participants" list for one Task Force: who the game seats as a starter or a sub.
// Scrolled screenshots overlap; the tracker de-duplicates by name, or by hero power and seat.
function lineupPrompt(fileList, focusedRetry) {
  const retryInstruction = focusedRetry
    ? "The first pass returned no rows. Inspect the full image carefully. Each member row is a white card with an avatar, the name, and \"Total Hero Power\" under it, then two columns of icons. Extract a row whenever the name, the hero power and the seat are readable. Return an empty rows array only when no such row exists anywhere in any attached image. "
    : "";
  return "Read the listed Last War Desert Storm or Canyon Storm \"View Participants\" screenshots as OCR only. Open every listed file with the Read tool; they are in the current directory. " +
    retryInstruction +
    "Each screenshot comes with overlapping zoomed strips of the same screenshot, top to bottom. Use the full screenshot to locate each row and see its icons; use the zoomed strips to read every name character by character. When the full screenshot and a strip disagree about a name, trust the strip. A row can appear in two strips: report it once per screenshot. " +
    "The panel shows one Task Force. Under the faction banner, a dropdown names it, such as \"Task Force A\": return that letter as taskForce, or \"unknown\" if it can't be read. Below the dropdown are three counters. The middle one, a person with crossed swords, is the starters as \"n/20\"; the right one, a person with a circular arrow, is the substitutes as \"n/10\". Return the n of each as startersShown and subsShown, or -1 if unreadable. Ignore the left counter. " +
    "Members are grouped under rank header bars (R5, R4, R3, R2, R1, each with its own counts): those bars are not members, so skip them. Each member card shows an avatar, the name in bold, \"Total Hero Power: 391.2M\" under it, a \"Strategist\" label, and then two icon columns. In one of the two columns there is a blue letter badge (A or B); the other column shows a red no-entry sign. The badge in the LEFT column means the player is a starter; the badge in the RIGHT column means a substitute. Return role \"starter\" or \"sub\" from which column holds the letter badge. " +
    "Return heroPower as an integer number of hero power: \"391.2M\" is 391200000, \"1.02B\" is 1020000000. " +
    "Return each name exactly, including Unicode, spacing, punctuation and case. Transcribe Korean Hangul, Chinese characters, Japanese kana/kanji, Cyrillic, Arabic, Thai, accented letters, and decorative symbols in their original form. Keep superscript and small-capital letters as they appear and count repeated characters exactly. Never translate, romanize, substitute Latin lookalikes, or drop combining marks. " +
    "If any name character remains uncertain, use the best visible transcription, set needsReview=true and confidence below 0.86; never invent missing characters. Skip a card cut off at the top or bottom edge so that its name, hero power or icons are not all readable. " +
    "At the bottom of the panel is the battle schedule, such as \"Battle Day : 2026-10-23\" and \"02:00~02:30\", under a \"Local Time\" or \"Server Time\" label. Return battleTime as the day, the time range and that label, for example \"2026-10-23 02:00~02:30 (Local Time)\", or an empty string if it can't be read. " +
    "Keep overlapping duplicate observations across different screenshots; the tracker will reconcile them. Before returning, revisit every screenshot and check that every complete card is represented and each hero power and seat belongs to the name on the same card. " +
    "Do not edit files or add commentary. Return only the structured output.\n\n" + fileList;
}

function readBatch(fileList, folder, batchIndex, focusedRetry = false) {
  const retryInstruction = focusedRetry
    ? "The first pass returned no rows. Inspect the full image carefully, including any inset or padded area. Look for a leaderboard with rank at left, commander name in the middle, and points at right. Extract a row whenever those three values are readable, even if decorative panel edges or the alliance subtitle are cropped. Return an empty rows array only when no such leaderboard row exists anywhere in any attached image. "
    : "";
  const prompt = kind === "storm-lineup" ? lineupPrompt(fileList, focusedRetry) : kind === "storm" ? stormPrompt(fileList, focusedRetry) :
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
  if (kind !== "storm-lineup") return validateRows(output.structured_output, `batch ${batchIndex + 1}`);
  const { rows, header } = validateLineup(output.structured_output, `batch ${batchIndex + 1}`);
  // Every screenshot shows the same header; keep the first reading of each part.
  for (const [key, value] of Object.entries(header)) if (lineupHeader[key] === undefined) lineupHeader[key] = value;
  return rows;
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
  ...(kind === "storm-lineup" ? { lineup: lineupHeader } : {}),
};
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`\nSaved ${allRows.length} extracted row${allRows.length === 1 ? "" : "s"} to:\n${outputPath}`);
console.log("Open Alliance Manager > New import > Import extraction JSON, then review and publish.");
