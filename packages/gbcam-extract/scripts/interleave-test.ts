/**
 * interleave-test.ts — Mixed Python/TypeScript pipeline runner for debugging.
 *
 * Runs a single test image through the pipeline, with each step run by either
 * Python or TypeScript as specified. Feeds each step's output into the next.
 * Reports pixel-level accuracy against the reference image.
 *
 * Usage:
 *   pnpm interleave -- --image zelda-poster-1 --py warp,correct --ts crop,sample,quantize
 *   pnpm interleave -- --image thing-1 --ts warp,correct,crop,sample,quantize
 *   pnpm interleave -- --image thing-2 --py warp,correct,crop,sample,quantize
 */

import { execSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { initOpenCV } from "../src/init-opencv.js";
import { warp } from "../src/warp.js";
import { correct } from "../src/correct.js";
import { crop } from "../src/crop.js";
import { sample } from "../src/sample.js";
import { quantize } from "../src/quantize.js";
import type { GBImageData } from "../src/common.js";
import { GB_COLORS, CAM_W, CAM_H } from "../src/common.js";

// ─── Paths ───

const SCRIPT_DIR = resolve(import.meta.dirname ?? ".");
const PKG_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(PKG_DIR, "..", "..");
const PY_PKG_DIR = join(REPO_ROOT, "packages", "gbcam-extract-py");
const TEST_INPUT_DIR = join(REPO_ROOT, "test-input");

const IS_WIN = process.platform === "win32";
const VENV_PYTHON = IS_WIN
  ? join(PY_PKG_DIR, ".venv", "Scripts", "python.exe")
  : join(PY_PKG_DIR, ".venv", "bin", "python");

const STEP_ORDER = ["warp", "correct", "crop", "sample", "quantize"] as const;
type StepName = (typeof STEP_ORDER)[number];

const PY_SCRIPTS: Record<StepName, string> = {
  warp: join(PY_PKG_DIR, "gbcam_warp.py"),
  correct: join(PY_PKG_DIR, "gbcam_correct.py"),
  crop: join(PY_PKG_DIR, "gbcam_crop.py"),
  sample: join(PY_PKG_DIR, "gbcam_sample.py"),
  quantize: join(PY_PKG_DIR, "gbcam_quantize.py"),
};

const PY_SUFFIXES: Record<StepName, string> = {
  warp: "_warp",
  correct: "_correct",
  crop: "_crop",
  sample: "_sample",
  quantize: "_gbcam",
};

// ─── CLI args ───

function parseArgs(): {
  image: string;
  pySteps: Set<StepName>;
  tsSteps: Set<StepName>;
} {
  const args = process.argv.slice(2);
  let image = "";
  const pySteps = new Set<StepName>();
  const tsSteps = new Set<StepName>();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--image" && args[i + 1]) {
      image = args[++i];
    } else if (args[i] === "--py" && args[i + 1]) {
      for (const s of args[++i].split(",")) {
        pySteps.add(s.trim() as StepName);
      }
    } else if (args[i] === "--ts" && args[i + 1]) {
      for (const s of args[++i].split(",")) {
        tsSteps.add(s.trim() as StepName);
      }
    }
  }

  if (!image) {
    console.error(
      "Usage: pnpm interleave -- --image <name> [--py step1,step2] [--ts step3,step4]",
    );
    console.error("Steps: warp, correct, crop, sample, quantize");
    process.exit(1);
  }

  // Steps not explicitly assigned default to TypeScript
  for (const step of STEP_ORDER) {
    if (!pySteps.has(step) && !tsSteps.has(step)) {
      tsSteps.add(step);
    }
  }

  return { image, pySteps, tsSteps };
}

// ─── Image I/O ───

async function loadImage(filePath: string): Promise<GBImageData> {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

async function saveImage(img: GBImageData, outPath: string): Promise<void> {
  await sharp(Buffer.from(img.data.buffer), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

// ─── Step runners ───

function runPythonStep(
  step: StepName,
  inputFile: string,
  tmpDir: string,
): string {
  const scaleArg = step !== "quantize" ? "--scale 8" : "";
  const cmd = `"${VENV_PYTHON}" "${PY_SCRIPTS[step]}" "${inputFile}" ${scaleArg} --output-dir "${tmpDir}"`;

  // Snapshot the directory before running so we can find the new file
  const before = new Set(readdirSync(tmpDir));

  console.log(`  [py] ${step}: ${basename(inputFile)}`);
  try {
    execSync(cmd, { stdio: "pipe" });
  } catch (e: any) {
    console.error(
      `  Python ${step} failed:\n${e.stderr?.toString() ?? e.message}`,
    );
    process.exit(1);
  }

  // Find the new PNG file Python created
  const newFiles = readdirSync(tmpDir).filter(
    (f) => !before.has(f) && f.endsWith(".png"),
  );
  if (newFiles.length === 0) {
    console.error(`  Python ${step} created no new PNG file in ${tmpDir}`);
    process.exit(1);
  }

  const outFile = join(tmpDir, newFiles[0]);
  console.log(`    → ${basename(outFile)}`);
  return outFile;
}

async function runTsStep(
  step: StepName,
  inputFile: string,
  tmpDir: string,
): Promise<string> {
  // Use a predictable output name based on the step suffix
  const stem = basename(inputFile, extname(inputFile)).replace(
    /_(warp|correct|crop|sample|gbcam)$/,
    "",
  ); // strip previous suffix

  const suffixes: Record<StepName, string> = {
    warp: "_warp",
    correct: "_correct",
    crop: "_crop",
    sample: "_sample",
    quantize: "_gbcam",
  };
  const outFile = join(tmpDir, stem + suffixes[step] + ".png");

  console.log(`  [ts] ${step}: ${basename(inputFile)} → ${basename(outFile)}`);

  const input = await loadImage(inputFile);

  let output: GBImageData;
  switch (step) {
    case "warp":
      output = warp(input, { scale: 8 });
      break;
    case "correct":
      output = correct(input, { scale: 8 });
      break;
    case "crop":
      output = crop(input);
      break;
    case "sample":
      output = sample(input);
      break;
    case "quantize":
      output = quantize(input);
      break;
  }

  await saveImage(output, outFile);
  return outFile;
}

// ─── Accuracy reporting ───

async function reportAccuracy(
  finalFile: string,
  imageName: string,
): Promise<void> {
  // Find reference image - try multiple naming conventions
  // zelda-poster-1 -> look for zelda-poster-output-corrected.png or zelda-poster-1-output-corrected.png
  // thing-1 -> look for thing-output-corrected.png or thing-1-output-corrected.png
  const baseName = imageName.replace(/-\d+$/, ""); // strip trailing number
  const refCandidates = [
    join(TEST_INPUT_DIR, `${imageName}-output-corrected.png`),
    join(TEST_INPUT_DIR, `${imageName}-output.png`),
    join(TEST_INPUT_DIR, `${baseName}-output-corrected.png`),
    join(TEST_INPUT_DIR, `${baseName}-output.png`),
  ];
  const refFile = refCandidates.find(existsSync);
  if (!refFile) {
    console.log(`\n  No reference image found for ${imageName}`);
    return;
  }

  // Load reference (grayscale, snap to palette)
  const { data: refRaw, info: refInfo } = await sharp(refFile)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (refInfo.width !== CAM_W || refInfo.height !== CAM_H) {
    console.log(
      `  Reference is ${refInfo.width}x${refInfo.height}, expected ${CAM_W}x${CAM_H}`,
    );
    return;
  }

  const snapToNearest = (v: number): number => {
    let best = GB_COLORS[0];
    let bestDist = Math.abs(v - best);
    for (const c of GB_COLORS) {
      const d = Math.abs(v - c);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  };

  const ref = new Uint8Array(refRaw.length);
  for (let i = 0; i < refRaw.length; i++) ref[i] = snapToNearest(refRaw[i]);

  // Load output
  const { data: outRaw, info: outInfo } = await sharp(finalFile)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (outInfo.width !== CAM_W || outInfo.height !== CAM_H) {
    console.log(
      `  Output is ${outInfo.width}x${outInfo.height}, expected ${CAM_W}x${CAM_H}`,
    );
    return;
  }

  const out = new Uint8Array(outRaw.length);
  for (let i = 0; i < outRaw.length; i++) out[i] = snapToNearest(outRaw[i]);

  // Compare
  let match = 0;
  const N = CAM_W * CAM_H;
  for (let i = 0; i < N; i++) {
    if (ref[i] === out[i]) match++;
  }

  const pct = ((match / N) * 100).toFixed(2);
  const diff = N - match;
  console.log(`\n  Accuracy: ${match}/${N} pixels match (${pct}%)`);
  console.log(
    `  Different: ${diff} pixels (${((diff / N) * 100).toFixed(2)}%)`,
  );

  if (diff > 0) {
    // Confusion-style summary: which colours are wrong
    const wrongByColor: Record<number, number> = {
      0: 0,
      82: 0,
      165: 0,
      255: 0,
    };
    for (let i = 0; i < N; i++) {
      if (ref[i] !== out[i])
        wrongByColor[ref[i]] = (wrongByColor[ref[i]] ?? 0) + 1;
    }
    for (const [color, count] of Object.entries(wrongByColor)) {
      if (count > 0)
        console.log(`    ref color ${color}: ${count} pixels wrong`);
    }
  }
}

// ─── Main ───

async function main(): Promise<void> {
  const { image, pySteps, tsSteps } = parseArgs();

  // Print plan
  console.log(`\nInterleave test: ${image}`);
  for (const step of STEP_ORDER) {
    const lang = pySteps.has(step) ? "py" : "ts";
    console.log(`  ${step}: ${lang}`);
  }
  console.log();

  // Check input file
  const inputCandidates = [
    ".jpg",
    ".JPG",
    ".jpeg",
    ".JPEG",
    ".png",
    ".PNG",
  ].map((ext) => join(TEST_INPUT_DIR, image + ext));
  const inputFile = inputCandidates.find(existsSync);
  if (!inputFile) {
    console.error(`No input file found for ${image} in ${TEST_INPUT_DIR}`);
    process.exit(1);
  }

  // Create temp dir
  const tmpDir = mkdtempSync(join(tmpdir(), "gbcam-interleave-"));

  // Copy input to temp dir to keep consistent stem
  const tmpInput = join(tmpDir, basename(inputFile));
  copyFileSync(inputFile, tmpInput);

  // Initialize OpenCV (needed for warp and quantize TS steps)
  const needsOpenCV = tsSteps.has("warp") || tsSteps.has("quantize");
  if (needsOpenCV) {
    await initOpenCV();
  }

  // Run pipeline steps in order
  let currentFile = tmpInput;
  let finalFile = tmpInput;

  try {
    for (const step of STEP_ORDER) {
      if (pySteps.has(step)) {
        currentFile = runPythonStep(step, currentFile, tmpDir);
      } else {
        currentFile = await runTsStep(step, currentFile, tmpDir);
      }
      finalFile = currentFile;
    }

    console.log(`\nFinal output: ${finalFile}`);
    await reportAccuracy(finalFile, image);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
