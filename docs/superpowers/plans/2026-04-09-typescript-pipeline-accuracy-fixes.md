# TypeScript Pipeline Accuracy Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ~36.5% accuracy gap between the TypeScript and Python pipelines by fixing three known divergences, then build an interleaving diagnostic script for fine-tuning any remaining gap.

**Architecture:** Fix in severity order — sample (critical), correct (medium), quantize (investigate only if gap persists) — running the pipeline test suite after each fix to measure improvement. Then build a CLI script that can run any mix of Python/TypeScript pipeline steps on a single test image to isolate remaining per-step differences.

**Tech Stack:** TypeScript/Node.js, vitest, tsup, sharp, opencv.js, Python 3 (via child_process), `.venv` at `packages/gbcam-extract-py/.venv`

---

## File Map

**Modify:**
- `packages/gbcam-extract/tests/sample.test.ts` — add subpixel colour output tests
- `packages/gbcam-extract/src/sample.ts` — rewrite with subpixel-aware per-channel sampling
- `packages/gbcam-extract/tests/correct.test.ts` — add `uniformFilter1d` boundary mode test
- `packages/gbcam-extract/src/correct.ts` — fix `uniformFilter1d` nearest boundary, export for testing
- `packages/gbcam-extract/package.json` — add `interleave` script

**Create:**
- `packages/gbcam-extract/scripts/interleave-test.ts` — mixed Python/TypeScript pipeline runner

---

## Task 1: Fix `sample.ts` — subpixel-aware colour sampling

**Background:** The GBA SP TN LCD has BGR sub-pixels (Blue left, Green middle, Red right) within each screen pixel. Python samples the B/G/R channels from separate column ranges within each block, producing a 128×112 colour PNG. TypeScript currently reads only the R channel from the full interior block, producing grayscale. The quantize step clusters in RG colour space — without real colour data it fails to discriminate the four palette colours.

**Column layout at scale=8 (inner_start=1, inner_end=7, inner_w=6):**
- B: cols [1, 3) — `input.data[idx + 2]`
- G: cols [3, 5) — `input.data[idx + 1]`
- R: cols [5, 7) — `input.data[idx + 0]`

**Files:**
- Modify: `packages/gbcam-extract/tests/sample.test.ts`
- Modify: `packages/gbcam-extract/src/sample.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `packages/gbcam-extract/tests/sample.test.ts`, inside the existing `describe("sample", ...)` block:

```typescript
it("samples R/G/B channels from separate subpixel column ranges", () => {
  const scale = 8;
  const w = CAM_W * scale;
  const h = CAM_H * scale;
  const input = createGBImageData(w, h);

  // Fill entire image: R channel=200, G channel=150, B channel=100
  // Since all pixels have these channel values, regardless of which column
  // range each channel is sampled from, each channel's output should equal
  // its distinct channel value — not the R channel value (200) for all.
  for (let i = 0; i < input.data.length; i += 4) {
    input.data[i] = 200;     // R
    input.data[i + 1] = 150; // G
    input.data[i + 2] = 100; // B
    input.data[i + 3] = 255; // A
  }

  const result = sample(input, { scale });

  expect(result.width).toBe(CAM_W);
  expect(result.height).toBe(CAM_H);
  // After fix: R output = 200, G output = 150, B output = 100
  // Before fix: R=G=B = 200 (only R channel read)
  expect(result.data[0]).toBe(200); // R
  expect(result.data[1]).toBe(150); // G  ← fails before fix
  expect(result.data[2]).toBe(100); // B  ← fails before fix
  expect(result.data[3]).toBe(255); // A
});
```

- [ ] **Step 2: Run test to verify it fails**

From the repo root:
```bash
cd packages/gbcam-extract && pnpm test -- --reporter=verbose tests/sample.test.ts
```
Expected: FAIL — `expect(received).toBe(expected)` with `received: 200, expected: 150` for G.

- [ ] **Step 3: Rewrite `sample.ts` with subpixel-aware colour output**

Replace the entire contents of `packages/gbcam-extract/src/sample.ts` with:

```typescript
import { type GBImageData, CAM_W, CAM_H, createGBImageData } from "./common.js";

export interface SampleOptions {
  scale?: number;
  method?: "mean" | "median"; // kept for API compat; internally always uses mean (matching Python)
  marginH?: number;           // ignored; replaced by subpixel col offsets
  marginV?: number;
}

/**
 * Sample step: reduce each (scale x scale) block to a single colour value.
 *
 * The GBA SP TN LCD has BGR sub-pixels (Blue left, Green middle, Red right).
 * Sampling each channel from its own column range avoids cross-channel
 * contamination and gives values that represent each sub-pixel's actual
 * colour intensity.
 *
 * Layout at scale=8 (inner_start=1, inner_end=7, inner_w=6):
 *   B: cols [1, 3)  — blue sub-pixel columns
 *   G: cols [3, 5)  — green sub-pixel columns
 *   R: cols [5, 7)  — red sub-pixel columns
 *
 * Output: 128×112 colour RGBA PNG (R/G/B channels carry real colour data).
 * The quantize step clusters in RG colour space and requires this.
 */
export function sample(input: GBImageData, options?: SampleOptions): GBImageData {
  const scale = options?.scale ?? 8;
  const vMargin = options?.marginV ?? Math.max(1, Math.floor(scale / 5));

  const expectedW = CAM_W * scale;
  const expectedH = CAM_H * scale;
  if (input.width !== expectedW || input.height !== expectedH) {
    throw new Error(
      `Unexpected input size ${input.width}x${input.height}; ` +
        `expected ${expectedW}x${expectedH} (scale=${scale})`,
    );
  }

  // Subpixel column offsets
  const innerStart = 1;
  const innerEnd = scale - 1;
  const innerW = innerEnd - innerStart;

  const output = createGBImageData(CAM_W, CAM_H);

  for (let by = 0; by < CAM_H; by++) {
    let y1 = by * scale + vMargin;
    let y2 = (by + 1) * scale - vMargin;
    // Fallback if vMargin is too large
    if (y2 <= y1) {
      y1 = by * scale;
      y2 = (by + 1) * scale;
    }

    for (let bx = 0; bx < CAM_W; bx++) {
      const x0 = bx * scale;
      const pi = by * CAM_W + bx;
      const outIdx = pi * 4;

      if (innerW < 3) {
        // Scale too small for sub-pixel columns — fall back to center pixel R channel
        const cy = by * scale + Math.floor(scale / 2);
        const cx = bx * scale + Math.floor(scale / 2);
        const v = input.data[(cy * input.width + cx) * 4];
        output.data[outIdx] = v;
        output.data[outIdx + 1] = v;
        output.data[outIdx + 2] = v;
        output.data[outIdx + 3] = 255;
        continue;
      }

      const bLo = innerStart;
      const bHi = innerStart + Math.floor(innerW / 3);
      const gLo = innerStart + Math.floor(innerW / 3);
      const gHi = innerStart + 2 * Math.floor(innerW / 3);
      const rLo = innerStart + 2 * Math.floor(innerW / 3);
      const rHi = innerEnd;

      let rSum = 0, gSum = 0, bSum = 0;
      let rCount = 0, gCount = 0, bCount = 0;

      for (let y = y1; y < y2; y++) {
        const rowBase = y * input.width;
        for (let dx = rLo; dx < rHi; dx++) {
          rSum += input.data[(rowBase + x0 + dx) * 4];
          rCount++;
        }
        for (let dx = gLo; dx < gHi; dx++) {
          gSum += input.data[(rowBase + x0 + dx) * 4 + 1];
          gCount++;
        }
        for (let dx = bLo; dx < bHi; dx++) {
          bSum += input.data[(rowBase + x0 + dx) * 4 + 2];
          bCount++;
        }
      }

      output.data[outIdx] = Math.round(rCount > 0 ? rSum / rCount : 0);
      output.data[outIdx + 1] = Math.round(gCount > 0 ? gSum / gCount : 0);
      output.data[outIdx + 2] = Math.round(bCount > 0 ? bSum / bCount : 0);
      output.data[outIdx + 3] = 255;
    }
  }

  return output;
}
```

- [ ] **Step 4: Run tests to verify all sample tests pass**

```bash
cd packages/gbcam-extract && pnpm test -- --reporter=verbose tests/sample.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Run pipeline tests and record accuracy**

```bash
cd packages/gbcam-extract && pnpm test:pipeline
```

Then check `test-output/test-summary.log`. Record the new average accuracy (expect significant improvement from ~62.65%).

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/sample.ts packages/gbcam-extract/tests/sample.test.ts
git commit -m "fix: subpixel-aware colour sampling in sample.ts, mirroring Python"
```

---

## Task 2: Fix `correct.ts` — `uniformFilter1d` nearest boundary mode

**Background:** `correct.ts` line 263 has a comment "nearest mode" but the code implements reflection. Python uses `scipy.ndimage.uniform_filter1d(mode='nearest')` which clamps to the edge value. This affects dark surface calibration along filmstrip border strips.

**The bug:**
```typescript
// Current (WRONG — this is reflect, not nearest):
if (idx < 0) idx = -idx;
if (idx >= n) idx = 2 * n - 2 - idx;
idx = Math.max(0, Math.min(n - 1, idx));

// Fixed (nearest = clamp to edge):
if (idx < 0) idx = 0;
if (idx >= n) idx = n - 1;
```

**Demonstration:** `uniformFilter1d([10, 20, 30], size=3)`, first element (i=0), window j ∈ [-1, 0, 1]:
- Nearest: idx=-1 → 0 → value=10; result=(10+10+20)/3 = **13.33**
- Reflect: idx=-1 → 1 → value=20; result=(20+10+20)/3 = **16.67**

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts` — fix boundary mode, export function for testing
- Modify: `packages/gbcam-extract/tests/correct.test.ts` — add boundary test

- [ ] **Step 1: Export `uniformFilter1d` from `correct.ts` for testing**

In `packages/gbcam-extract/src/correct.ts`, change the function declaration at line 263 from:
```typescript
function uniformFilter1d(input: Float64Array, size: number): Float64Array {
```
to:
```typescript
export function uniformFilter1d(input: Float64Array, size: number): Float64Array {
```

- [ ] **Step 2: Write the failing test**

Add this import and test to `packages/gbcam-extract/tests/correct.test.ts`:

```typescript
import { correct, uniformFilter1d } from "../src/correct.js";
```

(Replace the existing `import { correct }` line.)

Then add this test inside the existing `describe("correct", ...)` block:

```typescript
it("uniformFilter1d uses nearest (clamp) boundary, not reflection", () => {
  // Input [10, 20, 30], size=3
  // At i=0: window covers j=-1,0,1. With nearest: idx=-1→0, values=[10,10,20], mean=13.33
  //                                  With reflect: idx=-1→1, values=[20,10,20], mean=16.67
  const input = new Float64Array([10, 20, 30]);
  const result = uniformFilter1d(input, 3);

  // nearest boundary: (10 + 10 + 20) / 3 ≈ 13.33
  expect(result[0]).toBeCloseTo(13.33, 1);
  // middle element is unaffected by boundary: (10 + 20 + 30) / 3 ≈ 20
  expect(result[1]).toBeCloseTo(20.0, 1);
  // last element with nearest: (20 + 30 + 30) / 3 ≈ 26.67
  expect(result[2]).toBeCloseTo(26.67, 1);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/gbcam-extract && pnpm test -- --reporter=verbose tests/correct.test.ts
```
Expected: FAIL — `expect(received).toBeCloseTo(13.33)` but received `16.67` (reflect result).

- [ ] **Step 4: Fix the boundary mode in `correct.ts`**

In `packages/gbcam-extract/src/correct.ts`, inside `uniformFilter1d`, replace these three lines:
```typescript
      // Reflect boundary (nearest mode)
      if (idx < 0) idx = -idx;
      if (idx >= n) idx = 2 * n - 2 - idx;
      idx = Math.max(0, Math.min(n - 1, idx));
```
with:
```typescript
      // Nearest boundary: clamp to edge value (matches scipy mode='nearest')
      if (idx < 0) idx = 0;
      if (idx >= n) idx = n - 1;
```

- [ ] **Step 5: Run tests to verify all correct tests pass**

```bash
cd packages/gbcam-extract && pnpm test -- --reporter=verbose tests/correct.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 6: Run pipeline tests and record accuracy**

```bash
cd packages/gbcam-extract && pnpm test:pipeline
```

Check `test-output/test-summary.log`. Record the new average accuracy (expect modest improvement on top of Task 1 gains).

- [ ] **Step 7: Commit**

```bash
git add packages/gbcam-extract/src/correct.ts packages/gbcam-extract/tests/correct.test.ts
git commit -m "fix: uniformFilter1d nearest boundary mode in correct.ts, mirroring Python"
```

---

## Task 3: Assess quantize accuracy and run full test suite

After Tasks 1 and 2, run the full test suite (unit + pipeline) and compare accuracy against Python.

**Files:**
- Possibly modify: `packages/gbcam-extract/src/quantize.ts`

- [ ] **Step 1: Run full unit test suite**

```bash
cd packages/gbcam-extract && pnpm test
```
Expected: all tests pass (including updated sample and correct tests).

- [ ] **Step 2: Run pipeline tests and compare logs**

```bash
cd packages/gbcam-extract && pnpm test:pipeline
```

Compare `test-output/test-summary.log` (TypeScript) vs `test-output-py/test-summary.log` (Python) side by side. Note the per-test accuracy difference.

- [ ] **Step 3: Decide if quantize changes are needed**

If the accuracy gap is **< 5%** across all tests, quantize is likely not the bottleneck — proceed to Task 4.

If the gap is **> 5%** on some tests, inspect those tests' debug output more closely. Look at `test-output/<test-name>/` — the quantize step receives the new colour input and the k-means initialization path (nearest-neighbor assign + `KMEANS_USE_INITIAL_LABELS`) is algorithmically equivalent to sklearn's `init=centers, n_init=1`. To verify, add a temporary log in `quantize.ts` after the global k-means runs to print the cluster centers, and compare against the Python log for the same test image. If centers differ significantly, investigate why — otherwise this step is a no-op.

- [ ] **Step 4: Commit if any quantize changes were made**

```bash
git add packages/gbcam-extract/src/quantize.ts
git commit -m "fix: align quantize k-means initialization with Python"
```

(Skip this step if no changes were needed.)

---

## Task 4: Build interleaving diagnostic script

A CLI tool that runs a mixed Python/TypeScript pipeline on a single test image. Each step uses the language specified on the CLI. The previous step's output file is fed into the next step, regardless of which language produced it.

**Usage:**
```bash
cd packages/gbcam-extract && pnpm interleave -- --image zelda-poster-1 --py warp,correct --ts crop,sample,quantize
```

**Python step invocations** (using `.venv` Python, from repo root):
| Step | Command |
|------|---------|
| warp | `{venvPython} gbcam_warp.py {input} --scale 8 --output-dir {tmpDir}` |
| correct | `{venvPython} gbcam_correct.py {warpFile} --scale 8 --output-dir {tmpDir}` |
| crop | `{venvPython} gbcam_crop.py {correctFile} --scale 8 --output-dir {tmpDir}` |
| sample | `{venvPython} gbcam_sample.py {cropFile} --scale 8 --output-dir {tmpDir}` |
| quantize | `{venvPython} gbcam_quantize.py {sampleFile} --output-dir {tmpDir}` |

**Python output filenames** (from `gbcam_common.py`'s `STEP_SUFFIX`):
- `{stem}_warp.png`, `{stem}_correct.png`, `{stem}_crop.png`, `{stem}_sample.png`, `{stem}_gbcam.png`

**Files:**
- Create: `packages/gbcam-extract/scripts/interleave-test.ts`
- Modify: `packages/gbcam-extract/package.json`

- [ ] **Step 1: Add `interleave` script to `package.json`**

In `packages/gbcam-extract/package.json`, add to `"scripts"`:
```json
"interleave": "tsup scripts/interleave-test.ts --format esm --out-dir dist-scripts --clean && node dist-scripts/interleave-test.js"
```

- [ ] **Step 2: Create `scripts/interleave-test.ts`**

Create `packages/gbcam-extract/scripts/interleave-test.ts`:

```typescript
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
import { mkdirSync, existsSync, mkdtempSync, rmSync, copyFileSync, readdirSync } from "node:fs";
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

function parseArgs(): { image: string; pySteps: Set<StepName>; tsSteps: Set<StepName> } {
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
    console.error("Usage: pnpm interleave -- --image <name> [--py step1,step2] [--ts step3,step4]");
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

function runPythonStep(step: StepName, inputFile: string, tmpDir: string): string {
  const scaleArg = step !== "quantize" ? "--scale 8" : "";
  const cmd = `"${VENV_PYTHON}" "${PY_SCRIPTS[step]}" "${inputFile}" ${scaleArg} --output-dir "${tmpDir}"`;

  // Snapshot the directory before running so we can find the new file
  const before = new Set(readdirSync(tmpDir));

  console.log(`  [py] ${step}: ${basename(inputFile)}`);
  try {
    execSync(cmd, { stdio: "pipe" });
  } catch (e: any) {
    console.error(`  Python ${step} failed:\n${e.stderr?.toString() ?? e.message}`);
    process.exit(1);
  }

  // Find the new PNG file Python created
  const newFiles = readdirSync(tmpDir).filter(
    (f) => !before.has(f) && f.endsWith(".png")
  );
  if (newFiles.length === 0) {
    console.error(`  Python ${step} created no new PNG file in ${tmpDir}`);
    process.exit(1);
  }

  const outFile = join(tmpDir, newFiles[0]);
  console.log(`    → ${basename(outFile)}`);
  return outFile;
}

async function runTsStep(step: StepName, inputFile: string, tmpDir: string): Promise<string> {
  // Use a predictable output name based on the step suffix
  const stem = basename(inputFile, extname(inputFile))
    .replace(/_(warp|correct|crop|sample|gbcam)$/, "");  // strip previous suffix

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
    case "warp":    output = warp(input, { scale: 8 }); break;
    case "correct": output = correct(input, { scale: 8 }); break;
    case "crop":    output = crop(input, { scale: 8 }); break;
    case "sample":  output = sample(input, { scale: 8 }); break;
    case "quantize": output = quantize(input); break;
  }

  await saveImage(output, outFile);
  return outFile;
}

// ─── Accuracy reporting ───

async function reportAccuracy(finalFile: string, imageName: string): Promise<void> {
  // Find reference image
  const refDir = join(TEST_INPUT_DIR, imageName);
  if (!existsSync(refDir)) {
    console.log(`\n  No reference found at ${refDir} — skipping accuracy check.`);
    return;
  }

  const refCandidates = [
    join(refDir, `${imageName}-output-corrected.png`),
    join(refDir, `${imageName}-output.png`),
  ];
  const refFile = refCandidates.find(existsSync);
  if (!refFile) {
    console.log(`\n  No reference image found in ${refDir}`);
    return;
  }

  // Load reference (grayscale, snap to palette)
  const { data: refRaw, info: refInfo } = await sharp(refFile)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (refInfo.width !== CAM_W || refInfo.height !== CAM_H) {
    console.log(`  Reference is ${refInfo.width}x${refInfo.height}, expected ${CAM_W}x${CAM_H}`);
    return;
  }

  const snapToNearest = (v: number): number => {
    let best = GB_COLORS[0];
    let bestDist = Math.abs(v - best);
    for (const c of GB_COLORS) {
      const d = Math.abs(v - c);
      if (d < bestDist) { bestDist = d; best = c; }
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
    console.log(`  Output is ${outInfo.width}x${outInfo.height}, expected ${CAM_W}x${CAM_H}`);
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

  const pct = (match / N * 100).toFixed(2);
  const diff = N - match;
  console.log(`\n  Accuracy: ${match}/${N} pixels match (${pct}%)`);
  console.log(`  Different: ${diff} pixels (${(diff / N * 100).toFixed(2)}%)`);

  if (diff > 0) {
    // Confusion-style summary: which colours are wrong
    const wrongByColor: Record<number, number> = { 0: 0, 82: 0, 165: 0, 255: 0 };
    for (let i = 0; i < N; i++) {
      if (ref[i] !== out[i]) wrongByColor[ref[i]] = (wrongByColor[ref[i]] ?? 0) + 1;
    }
    for (const [color, count] of Object.entries(wrongByColor)) {
      if (count > 0) console.log(`    ref color ${color}: ${count} pixels wrong`);
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
  const inputDir = join(TEST_INPUT_DIR, image);
  const inputCandidates = [".jpg", ".JPG", ".jpeg", ".JPEG", ".png", ".PNG"].map(
    (ext) => join(inputDir, image + ext)
  );
  const inputFile = inputCandidates.find(existsSync);
  if (!inputFile) {
    console.error(`No input file found in ${inputDir}`);
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
```

- [ ] **Step 3: Run the script with all TypeScript steps to verify it works**

```bash
cd packages/gbcam-extract && pnpm interleave -- --image zelda-poster-1 --ts warp,correct,crop,sample,quantize
```
Expected: runs pipeline end-to-end, prints accuracy report matching `test-output/test-summary.log` for `zelda-poster-1`.

- [ ] **Step 4: Run with all Python steps to verify Python path works**

```bash
cd packages/gbcam-extract && pnpm interleave -- --image zelda-poster-1 --py warp,correct,crop,sample,quantize
```
Expected: runs Python pipeline, prints accuracy close to `test-output-py/test-summary.log` for `zelda-poster-1`.

- [ ] **Step 5: Run with one TypeScript step at a time to isolate any remaining divergence**

If an accuracy gap remains after Tasks 1–3, isolate the problematic step by swapping one step at a time to TypeScript while keeping all others in Python:

```bash
# Isolate warp:
pnpm interleave -- --image zelda-poster-1 --py correct,crop,sample,quantize --ts warp

# Isolate correct:
pnpm interleave -- --image zelda-poster-1 --py warp,crop,sample,quantize --ts correct

# Isolate sample:
pnpm interleave -- --image zelda-poster-1 --py warp,correct,crop,quantize --ts sample

# Isolate quantize:
pnpm interleave -- --image zelda-poster-1 --py warp,correct,crop,sample --ts quantize
```

The step that causes the biggest accuracy drop when swapped to TypeScript is the remaining bottleneck.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/scripts/interleave-test.ts packages/gbcam-extract/package.json
git commit -m "feat: add interleave-test script for per-step accuracy isolation"
```
