/**
 * run-tests.ts — Pipeline regression test runner mirroring run_tests.py.
 *
 * 1. Runs all sample pictures through the full pipeline.
 * 2. Runs test cases against reference images and reports accuracy.
 * 3. Writes a summary log to test-output/test-summary.log.
 *
 * Usage:
 *   pnpm test:pipeline
 */

import { resolve, join, basename, extname, relative } from "path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from "fs";
import sharp from "sharp";
import { initOpenCV } from "../src/init-opencv.js";
import { processPicture } from "../src/index.js";
import { applyPalette } from "../src/palette.js";
import type { GBImageData } from "../src/common.js";
import { GB_COLORS, CAM_W, CAM_H } from "../src/common.js";

// "Down" palette (matches the GBA SP screen colors used as input).
const DOWN_PALETTE: [string, string, string, string] = [
  "#FFFFA5",
  "#FF9494",
  "#9494FF",
  "#000000",
];

// ─── Paths ───

const SCRIPT_DIR = resolve(import.meta.dirname ?? ".");
const PKG_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(PKG_DIR, "..", "..");

const SAMPLE_PICTURES_DIR = join(REPO_ROOT, "sample-pictures");
const SAMPLE_PICTURES_OUT = join(REPO_ROOT, "sample-pictures-out");
const TEST_INPUT_DIR = join(REPO_ROOT, "test-input");
const TEST_OUTPUT_DIR = join(REPO_ROOT, "test-output");
const REFERENCE_SUFFIX = "-output-corrected.png";
const SUMMARY_LOG = join(TEST_OUTPUT_DIR, "test-summary.log");

// ─── Color constants ───

const COLOR_NAMES: Record<number, string> = {
  0: "BK  #000000",
  82: "DG  #9494FF",
  165: "LG  #FF9494",
  255: "WH  #FFFFA5",
};

// RGBA palette for diagnostic images
const RGBA_PALETTE: Record<number, [number, number, number, number]> = {
  0: [0, 0, 0, 255],
  82: [148, 148, 255, 255],
  165: [255, 148, 148, 255],
  255: [255, 255, 165, 255],
};

// ─── Image helpers ───

async function loadImage(filePath: string): Promise<GBImageData> {
  const img = sharp(filePath).removeAlpha().ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  const rgba = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    rgba[i * 4] = data[i * 4];
    rgba[i * 4 + 1] = data[i * 4 + 1];
    rgba[i * 4 + 2] = data[i * 4 + 2];
    rgba[i * 4 + 3] = data[i * 4 + 3];
  }

  return { data: rgba, width: info.width, height: info.height };
}

async function saveImage(
  img: GBImageData,
  outPath: string
): Promise<void> {
  const dir = resolve(outPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await sharp(Buffer.from(img.data.buffer), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

/** Load grayscale 128x112 image, snap stray values to palette. */
async function loadReference(filePath: string): Promise<Uint8Array> {
  const { data, info } = await sharp(filePath)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== CAM_W || info.height !== CAM_H) {
    throw new Error(
      `Reference image is ${info.width}x${info.height}, expected ${CAM_W}x${CAM_H}`
    );
  }

  // Snap to nearest palette value
  const snapped = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let minDist = 256;
    let closest = 0;
    for (const c of GB_COLORS) {
      const d = Math.abs(data[i] - c);
      if (d < minDist) {
        minDist = d;
        closest = c;
      }
    }
    snapped[i] = closest;
  }
  return snapped;
}

/** Extract grayscale values from pipeline output (RGBA -> grayscale using R channel). */
function extractGrayscale(img: GBImageData): Uint8Array {
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = img.data[i * 4];
  }
  // Snap to palette
  for (let i = 0; i < gray.length; i++) {
    let minDist = 256;
    let closest = 0;
    for (const c of GB_COLORS) {
      const d = Math.abs(gray[i] - c);
      if (d < minDist) {
        minDist = d;
        closest = c;
      }
    }
    gray[i] = closest;
  }
  return gray;
}

// ─── Comparison ───

interface ComparisonResult {
  total: number;
  matches: number;
  wrongs: number;
  matchPct: number;
  wrongPct: number;
  passed: boolean;
}

function compare(
  result: Uint8Array,
  reference: Uint8Array,
  outputDir: string,
  stem: string,
  log: (msg: string) => void
): ComparisonResult {
  const total = result.length;
  let matches = 0;
  for (let i = 0; i < total; i++) {
    if (result[i] === reference[i]) matches++;
  }
  const wrongs = total - matches;
  const matchPct = (100 * matches) / total;
  const wrongPct = (100 * wrongs) / total;

  log(`\n${"=".repeat(70)}`);
  log("COMPARISON SUMMARY");
  log("=".repeat(70));
  log(`  Total pixels : ${total}`);
  log(`  Matching     : ${matches}  (${matchPct.toFixed(2)}%)`);
  log(`  Different    : ${wrongs}   (${wrongPct.toFixed(2)}%)`);

  // Per-color distribution
  log(`\n${"-".repeat(70)}`);
  log("COLOR DISTRIBUTION");
  log("-".repeat(70));
  log(
    `  ${"Color".padEnd(22)}  ${"Result".padStart(8)}  ${"Reference".padStart(10)}  ${"Diff".padStart(8)}`
  );
  for (const v of GB_COLORS) {
    let rCnt = 0,
      gCnt = 0;
    for (let i = 0; i < total; i++) {
      if (result[i] === v) rCnt++;
      if (reference[i] === v) gCnt++;
    }
    const diff = rCnt - gCnt;
    log(
      `  ${COLOR_NAMES[v].padEnd(22)}  ${String(rCnt).padStart(8)}  ${String(gCnt).padStart(10)}  ${(diff >= 0 ? "+" : "") + diff}`
    );
  }

  // Confusion matrix
  log(`\n${"-".repeat(70)}`);
  log("CONFUSION MATRIX  (rows = pipeline result, cols = reference)");
  log("-".repeat(70));
  let hdr = `  ${"Result / Ref".padEnd(18)}`;
  for (const v of GB_COLORS) {
    hdr += `  ${COLOR_NAMES[v].padStart(16)}`;
  }
  hdr += "   TOTAL";
  log(hdr);

  for (const rv of GB_COLORS) {
    let row = `  ${COLOR_NAMES[rv].padEnd(18)}`;
    let totalR = 0;
    for (const cv of GB_COLORS) {
      let cnt = 0;
      for (let i = 0; i < total; i++) {
        if (result[i] === rv && reference[i] === cv) cnt++;
      }
      if (rv === cv) totalR += cnt;
      else totalR += cnt;
      const mark = rv === cv ? " v" : cnt === 0 ? "  " : " X";
      row += `  ${String(cnt).padStart(15)}${mark}`;
    }
    // Recount totalR properly
    let trueTotal = 0;
    for (let i = 0; i < total; i++) {
      if (result[i] === rv) trueTotal++;
    }
    row += `  ${String(trueTotal).padStart(6)}`;
    log(row);
  }

  // Error breakdown
  if (wrongs > 0) {
    log(`\n${"-".repeat(70)}`);
    log("ERROR BREAKDOWN  (result -> reference)");
    log("-".repeat(70));
    for (const rv of GB_COLORS) {
      for (const cv of GB_COLORS) {
        if (rv === cv) continue;
        let cnt = 0;
        for (let i = 0; i < total; i++) {
          if (result[i] === rv && reference[i] === cv) cnt++;
        }
        if (cnt > 0) {
          log(`  ${COLOR_NAMES[rv]}  ->  ${COLOR_NAMES[cv]} : ${cnt} px`);
        }
      }
    }
  }

  // Reprint summary
  log(`\n${"=".repeat(70)}`);
  log("COMPARISON SUMMARY (reprint)");
  log("=".repeat(70));
  log(`  Total pixels : ${total}`);
  log(`  Matching     : ${matches}  (${matchPct.toFixed(2)}%)`);
  log(`  Different    : ${wrongs}   (${wrongPct.toFixed(2)}%)`);

  const passed = wrongs === 0;
  log(`\n${"=".repeat(70)}`);
  if (passed) {
    log("RESULT: PASS — all pixels match the reference.");
  } else {
    log("RESULT: FAIL — see diagnostics above and in the output directory.");
  }
  log("=".repeat(70));

  return { total, matches, wrongs, matchPct, wrongPct, passed };
}

/** Save diagnostic error map image. */
async function saveErrorMap(
  result: Uint8Array,
  reference: Uint8Array,
  outputDir: string,
  stem: string
): Promise<void> {
  const w = CAM_W;
  const h = CAM_H;
  const scale = 4;
  const outW = w * scale;
  const outH = h * scale;
  const buf = Buffer.alloc(outW * outH * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const r = result[idx];
      const ref = reference[idx];
      let rgba: [number, number, number, number];

      if (r === ref) {
        rgba = [255, 255, 255, 255]; // white = correct
      } else {
        // Color-code by error type (red = generic error)
        rgba = [255, 0, 0, 255];
      }

      // Fill the scale x scale block
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const oi = (py * outW + px) * 4;
          buf[oi] = rgba[0];
          buf[oi + 1] = rgba[1];
          buf[oi + 2] = rgba[2];
          buf[oi + 3] = rgba[3];
        }
      }
    }
  }

  const outPath = join(outputDir, `${stem}_diag_error_map.png`);
  await sharp(buf, { raw: { width: outW, height: outH, channels: 4 } })
    .png()
    .toFile(outPath);
}

/** Save palette-rendered diagnostic image. */
async function savePaletteImage(
  gray: Uint8Array,
  outputDir: string,
  filename: string
): Promise<void> {
  const w = CAM_W;
  const h = CAM_H;
  const scale = 4;
  const outW = w * scale;
  const outH = h * scale;
  const buf = Buffer.alloc(outW * outH * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      const rgba = RGBA_PALETTE[v] ?? [128, 128, 128, 255];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x * scale + dx;
          const py = y * scale + dy;
          const oi = (py * outW + px) * 4;
          buf[oi] = rgba[0];
          buf[oi + 1] = rgba[1];
          buf[oi + 2] = rgba[2];
          buf[oi + 3] = rgba[3];
        }
      }
    }
  }

  const outPath = join(outputDir, filename);
  await sharp(buf, { raw: { width: outW, height: outH, channels: 4 } })
    .png()
    .toFile(outPath);
}

// ─── Pipeline runner ───

interface PipelineRunResult {
  grayscale: GBImageData;
  /** Per-step diagnostic log lines (empty if debug was off). */
  debugLog: string[];
}

async function runPipeline(
  inputPath: string,
  outputDir: string,
  stem: string,
): Promise<PipelineRunResult> {
  const input = await loadImage(inputPath);
  const result = await processPicture(input, {
    debug: true,
    onProgress: (step, pct) => {
      if (pct === 0) process.stdout.write(`  ${step}...`);
      if (pct === 100) process.stdout.write(" done\n");
    },
  });

  // Save final output
  const outPath = join(outputDir, `${stem}_gbcam.png`);
  await saveImage(result.grayscale, outPath);

  // Save palette-rendered ("Down" palette) RGB version
  const rgb = applyPalette(result.grayscale, DOWN_PALETTE);
  await saveImage(rgb, join(outputDir, `${stem}_gbcam_rgb.png`));

  await writeDebugArtifacts(result, outputDir, stem);

  return {
    grayscale: result.grayscale,
    debugLog: result.debug?.log ?? [],
  };
}

/**
 * Write all debug artifacts for a pipeline run, all under `<outputDir>/debug/`:
 *   <stem>_<step>.png       — base step intermediates (warp/correct/crop/sample)
 *   <stem>_<dbgname>.png    — per-step debug images (e.g. warp_a_corners)
 *   <stem>_debug.json       — structured metrics + chronological log
 */
async function writeDebugArtifacts(
  result: {
    intermediates?: Record<string, GBImageData>;
    debug?: {
      images: Record<string, GBImageData>;
      log: string[];
      metrics: Record<string, Record<string, unknown>>;
    };
  },
  outputDir: string,
  stem: string
): Promise<void> {
  if (!result.intermediates && !result.debug) return;
  const debugDir = join(outputDir, "debug");
  if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });

  if (result.intermediates) {
    for (const [stepName, img] of Object.entries(result.intermediates)) {
      await saveImage(img, join(debugDir, `${stem}_${stepName}.png`));
    }
  }
  if (result.debug?.images) {
    for (const [name, img] of Object.entries(result.debug.images)) {
      await saveImage(img, join(debugDir, `${stem}_${name}.png`));
    }
  }
  if (result.debug) {
    writeFileSync(
      join(debugDir, `${stem}_debug.json`),
      JSON.stringify(
        { metrics: result.debug.metrics, log: result.debug.log },
        null,
        2
      ),
      "utf-8"
    );
  }
}

// ─── Log parsing ───

interface TestResult {
  name: string;
  matchN: number | null;
  matchPct: number | null;
  diffN: number | null;
  diffPct: number | null;
  verdict: string;
}

function parseTestLog(logPath: string): Omit<TestResult, "name"> {
  if (!existsSync(logPath)) {
    return {
      matchN: null,
      matchPct: null,
      diffN: null,
      diffPct: null,
      verdict: "NO LOG",
    };
  }

  const text = readFileSync(logPath, "utf-8");

  function extract(label: string): [number | null, number | null] {
    const m = text.match(new RegExp(`${label}\\s*:\\s*(\\d+)\\s*\\(\\s*([\\d.]+)%\\)`));
    if (m) return [parseInt(m[1], 10), parseFloat(m[2])];
    return [null, null];
  }

  const [matchN, matchPct] = extract("Matching");
  const [diffN, diffPct] = extract("Different");

  let verdict = "UNKNOWN";
  if (/RESULT:\s*PASS/.test(text)) verdict = "PASS";
  else if (/RESULT:\s*FAIL/.test(text)) verdict = "FAIL";

  return { matchN, matchPct, diffN, diffPct, verdict };
}

// ─── Summary ───

function writeSummary(
  sampleExit: boolean,
  testResults: TestResult[]
): void {
  const lines: string[] = [];
  lines.push("=".repeat(60));
  lines.push("TEST SUMMARY");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(
    `  sample extraction : ${sampleExit ? "OK" : "FAILED"}`
  );
  lines.push("");

  if (testResults.length > 0) {
    const colW = Math.max(...testResults.map((r) => r.name.length));
    const header = `  ${"Test".padEnd(colW)}   ${"Matching".padEnd(18)}  ${"Different".padEnd(18)}  Verdict`;
    lines.push(header);
    lines.push("  " + "-".repeat(header.length - 2));

    for (const r of testResults) {
      const fmt = (n: number | null, pct: number | null): string => {
        if (n === null) return "       N/A       ";
        return `${String(n).padStart(5)} (${pct!.toFixed(2).padStart(6)}%)`;
      };
      lines.push(
        `  ${r.name.padEnd(colW)}   ${fmt(r.matchN, r.matchPct)}   ${fmt(r.diffN, r.diffPct)}   ${r.verdict}`
      );
    }

    lines.push("");
    const passed = testResults.filter((r) => r.verdict === "PASS").length;
    lines.push(`  ${passed}/${testResults.length} passed`);
  }

  lines.push("");
  lines.push("=".repeat(60));

  const text = lines.join("\n") + "\n";
  console.log("\n" + text);

  if (!existsSync(TEST_OUTPUT_DIR)) mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  writeFileSync(SUMMARY_LOG, text, "utf-8");
  console.log(`Summary written to ${SUMMARY_LOG}`);
}

// ─── Main ───

async function main() {
  console.log("Initializing OpenCV...");
  await initOpenCV();
  console.log("OpenCV ready.\n");

  let sampleSuccess = true;
  const testResults: TestResult[] = [];

  // ── 1. Run sample pictures ──
  if (existsSync(SAMPLE_PICTURES_DIR)) {
    const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);
    const sampleFiles = readdirSync(SAMPLE_PICTURES_DIR)
      .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
      .map((f) => join(SAMPLE_PICTURES_DIR, f))
      .sort();

    if (sampleFiles.length > 0) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`SAMPLE PICTURES: ${sampleFiles.length} file(s)`);
      console.log("=".repeat(70));

      if (!existsSync(SAMPLE_PICTURES_OUT))
        mkdirSync(SAMPLE_PICTURES_OUT, { recursive: true });

      for (const inputPath of sampleFiles) {
        const stem = basename(inputPath, extname(inputPath));
        console.log(`\n  Processing: ${basename(inputPath)}`);
        try {
          const input = await loadImage(inputPath);
          const result = await processPicture(input, {
            debug: true,
            onProgress: (step, pct) => {
              if (pct === 0) process.stdout.write(`    ${step}...`);
              if (pct === 100) process.stdout.write(" done\n");
            },
          });
          await saveImage(
            result.grayscale,
            join(SAMPLE_PICTURES_OUT, `${stem}_gbcam.png`)
          );

          const rgb = applyPalette(result.grayscale, DOWN_PALETTE);
          await saveImage(
            rgb,
            join(SAMPLE_PICTURES_OUT, `${stem}_gbcam_rgb.png`)
          );

          await writeDebugArtifacts(result, SAMPLE_PICTURES_OUT, stem);
        } catch (err) {
          console.error(
            `  ERROR: ${err instanceof Error ? err.message : String(err)}`
          );
          sampleSuccess = false;
        }
      }
    }
  } else {
    console.log(`Sample pictures directory not found: ${SAMPLE_PICTURES_DIR}`);
  }

  // ── 2. Run test cases ──
  if (existsSync(TEST_INPUT_DIR)) {
    const allFiles = readdirSync(TEST_INPUT_DIR);
    const referenceFiles = allFiles
      .filter((f) => f.endsWith(REFERENCE_SUFFIX))
      .sort();

    for (const refFilename of referenceFiles) {
      const baseName = refFilename.slice(0, -REFERENCE_SUFFIX.length);
      const refPath = join(TEST_INPUT_DIR, refFilename);

      // Find all numbered input images for this base name
      const inputFiles = allFiles
        .filter((f) => {
          if (f === refFilename) return false;
          const ext = extname(f).toLowerCase();
          if (ext !== ".jpg" && ext !== ".jpeg" && ext !== ".png") return false;
          // Match pattern: baseName-<number>.<ext>
          const stem = basename(f, extname(f));
          return stem.startsWith(baseName + "-") && /\d+$/.test(stem);
        })
        .sort()
        .map((f) => join(TEST_INPUT_DIR, f));

      for (const inputPath of inputFiles) {
        const inputFilename = basename(inputPath);
        const stem = basename(inputPath, extname(inputPath));
        const outputDir = join(TEST_OUTPUT_DIR, stem);

        console.log(`\n${"=".repeat(70)}`);
        console.log(`TEST: ${inputFilename}`);
        console.log(`  Reference: ${refFilename}`);
        console.log("=".repeat(70));

        if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

        // Set up log file
        const logPath = join(outputDir, `${stem}.log`);
        const logLines: string[] = [];
        const log = (msg: string) => {
          console.log(msg);
          logLines.push(msg);
        };

        try {
          log(`\nPIPELINE RUN`);
          log(`  Input:      ${relative(REPO_ROOT, inputPath)}`);
          log(`  Output dir: ${relative(REPO_ROOT, outputDir)}`);

          const pipelineResult = await runPipeline(
            inputPath,
            outputDir,
            stem,
          );

          // Echo per-step diagnostic logs into the test log
          if (pipelineResult.debugLog.length > 0) {
            log(`\nPIPELINE DIAGNOSTICS`);
            for (const line of pipelineResult.debugLog) log(`  ${line}`);
          }

          // Load and compare
          const resultGray = extractGrayscale(pipelineResult.grayscale);
          const referenceGray = await loadReference(refPath);

          const cmp = compare(resultGray, referenceGray, outputDir, stem, log);

          // Save diagnostic images
          await saveErrorMap(resultGray, referenceGray, outputDir, stem);
          await savePaletteImage(
            resultGray,
            outputDir,
            `${stem}_diag_result.png`
          );
          await savePaletteImage(
            referenceGray,
            outputDir,
            `${stem}_diag_reference.png`
          );

          // Write log
          writeFileSync(logPath, logLines.join("\n") + "\n", "utf-8");
          console.log(`  Log written to ${logPath}`);

          testResults.push({
            name: stem,
            matchN: cmp.matches,
            matchPct: cmp.matchPct,
            diffN: cmp.wrongs,
            diffPct: cmp.wrongPct,
            verdict: cmp.passed ? "PASS" : "FAIL",
          });
        } catch (err) {
          console.error(
            `  PIPELINE ERROR: ${err instanceof Error ? err.message : String(err)}`
          );
          if (err instanceof Error) console.error(err.stack);

          // Write error log
          logLines.push(
            `PIPELINE ERROR: ${err instanceof Error ? err.message : String(err)}`
          );
          writeFileSync(logPath, logLines.join("\n") + "\n", "utf-8");

          testResults.push({
            name: stem,
            matchN: null,
            matchPct: null,
            diffN: null,
            diffPct: null,
            verdict: "ERROR",
          });
        }
      }
    }
  } else {
    console.log(`Test input directory not found: ${TEST_INPUT_DIR}`);
  }

  // ── 3. Write summary ──
  writeSummary(sampleSuccess, testResults);

  // Exit with error if any test failed
  const allPassed = testResults.every(
    (r) => r.verdict === "PASS"
  );
  if (!sampleSuccess || !allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
