# Auto-scale Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `scale` parameter from the public TypeScript pipeline API. The pipeline auto-detects the appropriate integer scale from the detected screen quad in `warp.ts`; every downstream step infers its own scale from input dimensions.

**Architecture:** A new pure helper `computeAutoScale(corners)` in `src/auto-scale.ts` chooses `scale = max(1, ceil(max(maxHorizEdge / 160, maxVertEdge / 144)))` from the four corner points already detected by `warp.ts`. `warp` invokes this helper, uses the chosen scale, and emits a debug log line plus structured metrics (`metrics.warp.autoScale`). `correct`, `crop`, and `sample` infer scale from `input.width / SCREEN_W` (or `/ CAM_W` for `sample`) and validate that the input dimensions are a positive integer multiple. Public types lose their `scale?` fields.

**Tech Stack:** TypeScript, vitest, opencv.js (`@techstark/opencv-js` via `init-opencv.ts`), pnpm. Test runner: vitest unit tests + `pnpm test:pipeline` accuracy harness.

**Reference spec:** `docs/superpowers/specs/2026-04-28-auto-scale-detection-design.md`

---

## File Structure

| File | Change |
|---|---|
| `packages/gbcam-extract/src/auto-scale.ts` | **Create.** Pure helper `computeAutoScale(corners)`. |
| `packages/gbcam-extract/tests/auto-scale.test.ts` | **Create.** Unit tests for `computeAutoScale`. |
| `packages/gbcam-extract/src/sample.ts` | Drop `scale` option; infer from `input.width / CAM_W`. |
| `packages/gbcam-extract/src/crop.ts` | Drop `scale` option; infer from `input.width / SCREEN_W`. |
| `packages/gbcam-extract/src/correct.ts` | Drop `scale` option; infer from `input.width / SCREEN_W`. |
| `packages/gbcam-extract/src/warp.ts` | Drop `scale` option; call `computeAutoScale`; emit log + metrics. |
| `packages/gbcam-extract/src/common.ts` | Drop `scale?` from `PipelineOptions`. |
| `packages/gbcam-extract/src/index.ts` | Stop reading/forwarding `scale` in `processPicture`. |
| `packages/gbcam-extract/scripts/extract.ts` | Drop `--scale` CLI flag, help text, args field, step-fn signatures. |
| `packages/gbcam-extract/scripts/interleave-test.ts` | Drop `{ scale: 8 }` from TS-side step calls; add a comment explaining Python keeps `--scale 8`. |
| `packages/gbcam-extract/scripts/run-tests.ts` | Drop `scale` parameter and the `scale: 8` field in `processPicture` calls. |
| `packages/gbcam-extract/tests/sample.test.ts` | Drop `{ scale }` arg from `sample(...)` calls. |
| `packages/gbcam-extract/tests/crop.test.ts` | Drop `{ scale }` arg from `crop(...)` calls. |
| `packages/gbcam-extract/tests/correct.test.ts` | Drop `{ scale }` arg from `correct(...)` calls. |
| `packages/gbcam-extract/tests/warp.test.ts` | Drop `{ scale }` arg; assert dimensions are a valid auto-scale (`width % SCREEN_W === 0`, ratio matches `SCREEN_W : SCREEN_H`). |

---

## Working directory

All paths in this plan are relative to the repo root: `C:\Users\tj_co\source\repos-p\game-boy-camera-picture-extractor\`.

When running `pnpm` commands, run them from `packages/gbcam-extract/` unless otherwise noted. To avoid `cd && pnpm` compound commands (per project memory), use `pnpm --filter gbcam-extract <script>` from the repo root, e.g. `pnpm --filter gbcam-extract test`.

---

## Task 1: Add `computeAutoScale` helper with unit tests

**Files:**
- Create: `packages/gbcam-extract/src/auto-scale.ts`
- Create: `packages/gbcam-extract/tests/auto-scale.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/gbcam-extract/tests/auto-scale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeAutoScale } from "../src/auto-scale.js";

describe("computeAutoScale", () => {
  it("returns scale 1 for a screen-sized axis-aligned quad (160x144)", () => {
    const r = computeAutoScale([
      [0, 0],
      [160, 0],
      [160, 144],
      [0, 144],
    ]);
    expect(r.scale).toBe(1);
    expect(r.edgeLengths.top).toBeCloseTo(160, 6);
    expect(r.edgeLengths.bottom).toBeCloseTo(160, 6);
    expect(r.edgeLengths.left).toBeCloseTo(144, 6);
    expect(r.edgeLengths.right).toBeCloseTo(144, 6);
    expect(r.maxHorizontal).toBeCloseTo(160, 6);
    expect(r.maxVertical).toBeCloseTo(144, 6);
  });

  it("rounds up to the next integer scale (1280x1152 -> 8)", () => {
    const r = computeAutoScale([
      [0, 0],
      [1280, 0],
      [1280, 1152],
      [0, 1152],
    ]);
    expect(r.scale).toBe(8);
    expect(r.maxHorizontal).toBeCloseTo(1280, 6);
    expect(r.maxVertical).toBeCloseTo(1152, 6);
  });

  it("ceils when the screen exceeds an integer multiple (1281x1152 -> 9)", () => {
    const r = computeAutoScale([
      [0, 0],
      [1281, 0],
      [1281, 1152],
      [0, 1152],
    ]);
    expect(r.scale).toBe(9);
  });

  it("uses the larger ratio when horizontal vs vertical disagree", () => {
    // 320 / 160 = 2.0 horizontal, 600 / 144 ≈ 4.166 vertical → ceil(4.166) = 5
    const r = computeAutoScale([
      [0, 0],
      [320, 0],
      [320, 600],
      [0, 600],
    ]);
    expect(r.scale).toBe(5);
    expect(r.maxHorizontal).toBeCloseTo(320, 6);
    expect(r.maxVertical).toBeCloseTo(600, 6);
  });

  it("uses the longer of top/bottom and left/right edges (perspective)", () => {
    // Trapezoid: top edge 200 wide, bottom 400 wide, left/right 144 tall
    // Max horizontal = 400, max vertical = 144
    // ratio = max(400/160, 144/144) = max(2.5, 1) = 2.5 → ceil = 3
    const r = computeAutoScale([
      [100, 0],
      [300, 0],
      [400, 144],
      [0, 144],
    ]);
    expect(r.edgeLengths.top).toBeCloseTo(200, 6);
    expect(r.edgeLengths.bottom).toBeCloseTo(400, 6);
    expect(r.maxHorizontal).toBeCloseTo(400, 6);
    expect(r.scale).toBe(3);
  });

  it("clamps degenerate input to scale=1", () => {
    const r = computeAutoScale([
      [10, 10],
      [10, 10],
      [10, 10],
      [10, 10],
    ]);
    expect(r.scale).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (module not found)**

Run: `pnpm --filter gbcam-extract test -- auto-scale`
Expected: vitest fails to resolve `../src/auto-scale.js` — module-not-found error.

- [ ] **Step 3: Create the helper**

Create `packages/gbcam-extract/src/auto-scale.ts`:

```ts
import { SCREEN_W, SCREEN_H } from "./common.js";

export type Point = [number, number];
export type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL

export interface AutoScaleResult {
  edgeLengths: { top: number; bottom: number; left: number; right: number };
  maxHorizontal: number;
  maxVertical: number;
  scale: number;
}

/**
 * Pick the smallest integer scale that does not downsample the detected
 * screen quad along either axis.
 *
 *   scale = max(1, ceil(max(maxHorizEdge / SCREEN_W, maxVertEdge / SCREEN_H)))
 */
export function computeAutoScale(corners: Corners): AutoScaleResult {
  const [TL, TR, BR, BL] = corners;
  const top = euclidean(TL, TR);
  const bottom = euclidean(BL, BR);
  const left = euclidean(TL, BL);
  const right = euclidean(TR, BR);
  const maxHorizontal = Math.max(top, bottom);
  const maxVertical = Math.max(left, right);
  const ratio = Math.max(maxHorizontal / SCREEN_W, maxVertical / SCREEN_H);
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const scale = Math.max(1, Math.ceil(safeRatio));
  return {
    edgeLengths: { top, bottom, left, right },
    maxHorizontal,
    maxVertical,
    scale,
  };
}

function euclidean(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter gbcam-extract test -- auto-scale`
Expected: 6 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter gbcam-extract typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/auto-scale.ts packages/gbcam-extract/tests/auto-scale.test.ts
git commit -m "feat(gbcam-extract): add computeAutoScale helper

Pure function: choose the smallest integer scale that doesn't
downsample the detected screen quad along either axis.

Used by warp.ts in a follow-up commit; downstream steps will infer
scale from input dimensions."
```

---

## Task 2: Refactor `sample` to infer scale from input dimensions

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts`
- Modify: `packages/gbcam-extract/src/index.ts` (drop `scale` from `sample(...)` call)
- Modify: `packages/gbcam-extract/scripts/extract.ts` (drop `scale` from `STEP_FUNCTIONS.sample`)
- Modify: `packages/gbcam-extract/scripts/interleave-test.ts` (drop `{ scale: 8 }` from TS sample call)
- Modify: `packages/gbcam-extract/tests/sample.test.ts` (drop `{ scale }` from `sample(...)` calls)

- [ ] **Step 1: Update the sample tests to call `sample(input)` without `scale`**

In `packages/gbcam-extract/tests/sample.test.ts`, replace each `sample(input, { scale })` call (currently at lines ~30, 55, 78) with `sample(input)`. The tests already construct `input` at `(CAM_W * scale) x (CAM_H * scale)` dimensions, so `sample` will infer the same scale.

Concretely, for the test at line 6-44 (scale=8), the call:
```ts
const result = sample(input, { scale });
```
becomes:
```ts
const result = sample(input);
```
Apply the same change to the scale=1 test (line 45-60) and the marginV test (line 61-83).

- [ ] **Step 2: Run sample tests — they should fail compile because `sample.ts` still requires the option shape**

Run: `pnpm --filter gbcam-extract test -- sample`
Expected: tests run (TypeScript option is structural; passing fewer fields is allowed). They will pass with the current code because `scale` is optional with default 8 — but the scale=1 test would now hit the default 8 branch with input at 128×112 and throw "Unexpected input size". So expect the scale=1 test to FAIL and the scale=8 tests to PASS.

This confirms the inference work is actually needed.

- [ ] **Step 3: Make `sample` infer scale from input dimensions**

In `packages/gbcam-extract/src/sample.ts`:

Replace the `SampleOptions` interface (lines 4-10):

```ts
export interface SampleOptions {
  method?: "mean" | "median"; // kept for API compat; internally always uses mean (matching Python)
  marginH?: number; // ignored; replaced by subpixel col offsets
  marginV?: number;
  debug?: DebugCollector;
}
```

(i.e. drop the `scale?: number;` line.)

Replace the prologue of `sample(...)` (lines 32-43):

```ts
  const dbg = options?.debug;

  if (input.width === 0 || input.height === 0 || input.width % CAM_W !== 0) {
    throw new Error(
      `[sample] unexpected input size ${input.width}x${input.height}; ` +
        `width must be a positive integer multiple of CAM_W=${CAM_W}`,
    );
  }
  const scale = input.width / CAM_W;
  if (input.height !== CAM_H * scale) {
    throw new Error(
      `[sample] unexpected input size ${input.width}x${input.height}; ` +
        `expected ${CAM_W * scale}x${CAM_H * scale} (inferred scale=${scale})`,
    );
  }
  const vMargin = options?.marginV ?? Math.max(1, Math.floor(scale / 5));
```

Note: `vMargin` previously used `options?.marginV ?? Math.max(1, Math.floor(scale / 5))`, which depended on `scale`; the replacement preserves that semantics by computing `vMargin` after `scale` is inferred.

- [ ] **Step 4: Drop the `scale` arg from internal callers**

In `packages/gbcam-extract/src/index.ts`, change line 62 from:
```ts
  const sampled = sample(cropped, { scale, debug: collector });
```
to:
```ts
  const sampled = sample(cropped, { debug: collector });
```

In `packages/gbcam-extract/scripts/extract.ts`, change line 178 from:
```ts
  sample: (input, scale) => sample(input, { scale }),
```
to:
```ts
  sample: (input, _scale) => sample(input),
```
(We'll remove the `_scale` parameter entirely in Task 6 once all step functions are converted; for now keep the signature uniform.)

In `packages/gbcam-extract/scripts/interleave-test.ts`, change line 206 from:
```ts
      output = sample(input, { scale: 8 });
```
to:
```ts
      output = sample(input);
```

- [ ] **Step 5: Run sample tests + typecheck**

Run: `pnpm --filter gbcam-extract test -- sample`
Expected: all sample tests PASS (including the scale=1 one).

Run: `pnpm --filter gbcam-extract typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/sample.ts packages/gbcam-extract/src/index.ts packages/gbcam-extract/scripts/extract.ts packages/gbcam-extract/scripts/interleave-test.ts packages/gbcam-extract/tests/sample.test.ts
git commit -m "refactor(gbcam-extract): infer scale from input dims in sample step

sample() no longer takes a scale option; it infers scale =
input.width / CAM_W and validates dimensions. Updates all callers
(processPicture, extract CLI step map, interleave-test) and tests."
```

---

## Task 3: Refactor `crop` to infer scale from input dimensions

**Files:**
- Modify: `packages/gbcam-extract/src/crop.ts`
- Modify: `packages/gbcam-extract/src/index.ts` (drop `scale` from `crop(...)` call)
- Modify: `packages/gbcam-extract/scripts/extract.ts` (drop `scale` from `STEP_FUNCTIONS.crop`)
- Modify: `packages/gbcam-extract/scripts/interleave-test.ts` (drop `{ scale: 8 }` from TS crop call)
- Modify: `packages/gbcam-extract/tests/crop.test.ts` (drop `{ scale }` from `crop(...)` calls)

- [ ] **Step 1: Update the crop tests to call `crop(input)` without `scale`**

In `packages/gbcam-extract/tests/crop.test.ts`:

The test at line 6-43 uses `scale=1` and calls `crop(input, { scale })` at line 30. Change to `crop(input)`.

The test at line 44-65 uses `scale=8` and calls `crop(input, { scale })` at line 61. Change to `crop(input)`.

- [ ] **Step 2: Run crop tests to verify the scale=1 case fails**

Run: `pnpm --filter gbcam-extract test -- crop`
Expected: scale=8 test PASSES (default matches), scale=1 test FAILS with "Unexpected input size 160x144; expected 1280x1152 (scale=8)".

- [ ] **Step 3: Make `crop` infer scale from input dimensions**

In `packages/gbcam-extract/src/crop.ts`:

Replace `CropOptions` (lines 11-14):
```ts
export interface CropOptions {
  debug?: DebugCollector;
}
```

Replace the prologue of `crop(...)` (lines 25-36):
```ts
export function crop(input: GBImageData, options?: CropOptions): GBImageData {
  const dbg = options?.debug;

  if (input.width === 0 || input.height === 0 || input.width % SCREEN_W !== 0) {
    throw new Error(
      `[crop] unexpected input size ${input.width}x${input.height}; ` +
        `width must be a positive integer multiple of SCREEN_W=${SCREEN_W}`,
    );
  }
  const scale = input.width / SCREEN_W;
  if (input.height !== SCREEN_H * scale) {
    throw new Error(
      `[crop] unexpected input size ${input.width}x${input.height}; ` +
        `expected ${SCREEN_W * scale}x${SCREEN_H * scale} (inferred scale=${scale})`,
    );
  }
```

Leave the body (lines 38-96) unchanged — it already references the local `scale` constant.

- [ ] **Step 4: Drop the `scale` arg from internal callers**

In `packages/gbcam-extract/src/index.ts`, change line 58 from:
```ts
  const cropped = crop(corrected, { scale, debug: collector });
```
to:
```ts
  const cropped = crop(corrected, { debug: collector });
```

In `packages/gbcam-extract/scripts/extract.ts`, change line 177 from:
```ts
  crop: (input, scale) => crop(input, { scale }),
```
to:
```ts
  crop: (input, _scale) => crop(input),
```

In `packages/gbcam-extract/scripts/interleave-test.ts`, change line 203 from:
```ts
      output = crop(input, { scale: 8 });
```
to:
```ts
      output = crop(input);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter gbcam-extract test -- crop`
Expected: both crop tests PASS.

Run: `pnpm --filter gbcam-extract typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/crop.ts packages/gbcam-extract/src/index.ts packages/gbcam-extract/scripts/extract.ts packages/gbcam-extract/scripts/interleave-test.ts packages/gbcam-extract/tests/crop.test.ts
git commit -m "refactor(gbcam-extract): infer scale from input dims in crop step

crop() no longer takes a scale option; it infers scale =
input.width / SCREEN_W and validates dimensions. Updates all callers
and tests."
```

---

## Task 4: Refactor `correct` to infer scale from input dimensions

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`
- Modify: `packages/gbcam-extract/src/index.ts` (drop `scale` from `correct(...)` call)
- Modify: `packages/gbcam-extract/scripts/extract.ts` (drop `scale` from `STEP_FUNCTIONS.correct`)
- Modify: `packages/gbcam-extract/scripts/interleave-test.ts` (drop `{ scale: 8 }` from TS correct call)
- Modify: `packages/gbcam-extract/tests/correct.test.ts` (drop `{ scale }` from `correct(...)` call)

- [ ] **Step 1: Update the correct test**

In `packages/gbcam-extract/tests/correct.test.ts`, line 29:
```ts
    const result = correct(input, { scale });
```
becomes:
```ts
    const result = correct(input);
```

- [ ] **Step 2: Run correct tests (should still pass — default scale=8 matches input dims)**

Run: `pnpm --filter gbcam-extract test -- correct`
Expected: PASS.

(There's no scale=1 case in `correct.test.ts`, so the test alone does not exercise inference. Coverage for inference comes via the pipeline integration test in Task 7.)

- [ ] **Step 3: Make `correct` infer scale from input dimensions**

In `packages/gbcam-extract/src/correct.ts`:

Replace `CorrectOptions` (lines 50-56):
```ts
export interface CorrectOptions {
  polyDegree?: number;
  darkSmooth?: number;
  refinePasses?: number;
  debug?: DebugCollector;
}
```

Replace the prologue of `correct(...)` (lines 64-81):
```ts
export function correct(
  input: GBImageData,
  options?: CorrectOptions,
): GBImageData {
  const polyDegree = options?.polyDegree ?? 2;
  const darkSmooth = options?.darkSmooth ?? 13;
  const refinePasses = options?.refinePasses ?? 1;
  const dbg = options?.debug;

  if (input.width === 0 || input.height === 0 || input.width % SCREEN_W !== 0) {
    throw new Error(
      `[correct] unexpected input size ${input.width}x${input.height}; ` +
        `width must be a positive integer multiple of SCREEN_W=${SCREEN_W}`,
    );
  }
  const scale = input.width / SCREEN_W;
  if (input.height !== SCREEN_H * scale) {
    throw new Error(
      `[correct] unexpected input size ${input.width}x${input.height}; ` +
        `expected ${SCREEN_W * scale}x${SCREEN_H * scale} (inferred scale=${scale})`,
    );
  }
```

Leave the body unchanged — it already references the local `scale` constant. Note in particular the existing helper at line 303 (`const scale = img.width / SCREEN_W;`) is unrelated to the option and stays as-is.

- [ ] **Step 4: Drop the `scale` arg from internal callers**

In `packages/gbcam-extract/src/index.ts`, change line 54 from:
```ts
  const corrected = correct(warped, { scale, debug: collector });
```
to:
```ts
  const corrected = correct(warped, { debug: collector });
```

In `packages/gbcam-extract/scripts/extract.ts`, change line 176 from:
```ts
  correct: (input, scale) => correct(input, { scale }),
```
to:
```ts
  correct: (input, _scale) => correct(input),
```

In `packages/gbcam-extract/scripts/interleave-test.ts`, change line 200 from:
```ts
      output = correct(input, { scale: 8 });
```
to:
```ts
      output = correct(input);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter gbcam-extract test -- correct`
Expected: PASS.

Run: `pnpm --filter gbcam-extract typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/correct.ts packages/gbcam-extract/src/index.ts packages/gbcam-extract/scripts/extract.ts packages/gbcam-extract/scripts/interleave-test.ts packages/gbcam-extract/tests/correct.test.ts
git commit -m "refactor(gbcam-extract): infer scale from input dims in correct step

correct() no longer takes a scale option; it infers scale =
input.width / SCREEN_W and validates dimensions. Updates all callers
and tests."
```

---

## Task 5: Wire `computeAutoScale` into `warp` and emit debug output

**Files:**
- Modify: `packages/gbcam-extract/src/warp.ts`
- Modify: `packages/gbcam-extract/src/index.ts` (drop `scale` from `warp(...)` call and from the function body)
- Modify: `packages/gbcam-extract/scripts/extract.ts` (drop `scale` from `STEP_FUNCTIONS.warp` and from the iteration)
- Modify: `packages/gbcam-extract/scripts/interleave-test.ts` (drop `{ scale: 8 }` from TS warp call)
- Modify: `packages/gbcam-extract/tests/warp.test.ts` (drop `{ scale }`; assert dimensions match a valid auto-scale)

- [ ] **Step 1: Update the warp test**

Replace `packages/gbcam-extract/tests/warp.test.ts` entirely with:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { warp } from "../src/warp.js";
import { initOpenCV } from "../src/init-opencv.js";
import { SCREEN_W, SCREEN_H } from "../src/common.js";

beforeAll(async () => {
  await initOpenCV();
}, 5_000);

describe("warp", () => {
  it("produces output sized at SCREEN_W*k by SCREEN_H*k for some integer k", () => {
    // Synthetic 640x480 photo with a 400x360 bright rectangle simulating the
    // GB screen frame. Auto-scale should pick scale = ceil(max(400/160, 360/144))
    // = ceil(2.5) = 3 — but we don't pin that exactly because corner detection
    // can shift by a pixel or two. We only assert the shape constraint.
    const w = 640, h = 480;
    const data = new Uint8ClampedArray(w * h * 4);

    // Dark background
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 20; data[i+1] = 20; data[i+2] = 20; data[i+3] = 255;
    }

    // Bright rectangle (simulating GB screen frame)
    const rectW = 400, rectH = 360;
    const rx = Math.floor((w - rectW) / 2);
    const ry = Math.floor((h - rectH) / 2);
    for (let y = ry; y < ry + rectH; y++) {
      for (let x = rx; x < rx + rectW; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = 255; data[idx+1] = 255; data[idx+2] = 165; data[idx+3] = 255;
      }
    }

    const result = warp({ data, width: w, height: h });

    // width and height must both be positive integer multiples of SCREEN_W and
    // SCREEN_H, with the same scale factor applied to each.
    expect(result.width % SCREEN_W).toBe(0);
    expect(result.height % SCREEN_H).toBe(0);
    expect(result.width).toBeGreaterThan(0);
    const k = result.width / SCREEN_W;
    expect(result.height).toBe(SCREEN_H * k);

    // For the synthetic 400x360 quad, auto-scale should land at 3 (small jitter
    // from corner detection won't push past 4 or below 2).
    expect(k).toBeGreaterThanOrEqual(2);
    expect(k).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run the warp test — expect compile/runtime failure because `warp` still requires/defaults to scale=8**

Run: `pnpm --filter gbcam-extract test -- warp`
Expected: the test runs but probably FAILS because `warp` currently defaults to scale=8 and would return 1280×1152, so `k=8` would be outside `[2, 4]`.

- [ ] **Step 3: Refactor `warp.ts` to compute auto-scale and emit debug output**

In `packages/gbcam-extract/src/warp.ts`:

Update the imports (line 15-22) to add the helper and types:

```ts
import { type GBImageData, SCREEN_W, SCREEN_H, INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT } from "./common.js";
import { getCV, withMats, imageDataToMat, matToImageData } from "./opencv.js";
import {
  type DebugCollector,
  cloneImage,
  drawPolyline,
  fillCircle,
} from "./debug.js";
import { computeAutoScale } from "./auto-scale.js";
```

Replace `WarpOptions` (lines 26-30):

```ts
export interface WarpOptions {
  threshold?: number;
  debug?: DebugCollector;
}
```

Replace the prologue of `warp(...)` (lines 32-36) — drop `scale` defaulting:

```ts
export function warp(input: GBImageData, options?: WarpOptions): GBImageData {
  const threshVal = options?.threshold ?? 180;
  const dbg = options?.debug;
```

Insert the auto-scale call right after corner detection. The relevant block today is lines 47-89 (after `const detection = findScreenCornersWithMetrics(...)` and the `corners` log). Add this just before the `// b — Initial perspective warp` comment at line 91:

```ts
  // a2 — Auto-scale: pick the smallest integer scale that doesn't downsample
  // the detected screen quad along either axis.
  const auto = computeAutoScale(corners);
  const scale = auto.scale;

  if (dbg) {
    const fmt = (n: number) => n.toFixed(1);
    dbg.log(
      `[warp] auto-scale: edges T=${fmt(auto.edgeLengths.top)} ` +
        `B=${fmt(auto.edgeLengths.bottom)} L=${fmt(auto.edgeLengths.left)} ` +
        `R=${fmt(auto.edgeLengths.right)}, ` +
        `maxH=${fmt(auto.maxHorizontal)} maxV=${fmt(auto.maxVertical)}, ` +
        `scale=${scale}`,
    );

    // Merge with the warp metrics already set above.
    dbg.setMetrics("warp", {
      threshold: detection.thresh,
      contourArea: Math.round(detection.area),
      aspect: Number(detection.aspect.toFixed(4)),
      quadScore: Number(detection.score.toFixed(4)),
      sourceCorners: corners.map(([x, y]) => [Math.round(x), Math.round(y)]),
      autoScale: {
        edgeLengths: {
          top: Number(auto.edgeLengths.top.toFixed(2)),
          bottom: Number(auto.edgeLengths.bottom.toFixed(2)),
          left: Number(auto.edgeLengths.left.toFixed(2)),
          right: Number(auto.edgeLengths.right.toFixed(2)),
        },
        maxHorizontal: Number(auto.maxHorizontal.toFixed(2)),
        maxVertical: Number(auto.maxVertical.toFixed(2)),
        scale,
      },
    });
  }
```

Important: this replaces the `dbg.setMetrics("warp", { … })` call already present at lines 82-88 (inside the existing `if (dbg)` block at lines 50-89). After your edit, the OLD `dbg.setMetrics("warp", …)` at lines 82-88 must be DELETED to avoid a double-set; only the new merged version above remains. Remove just the `dbg.setMetrics("warp", { ... });` statement, leaving the corner-detection log lines (the `dbg.log` calls and the `overlay` image addition) intact.

The rest of the `warp` body (lines 91-125 — initial warp, two refinement passes, BGR→RGBA conversion) is unchanged; the local `scale` variable now comes from `auto.scale` instead of `options?.scale ?? 8`.

- [ ] **Step 4: Drop the `scale` arg from internal callers**

In `packages/gbcam-extract/src/index.ts`:

Drop the `const scale = options?.scale ?? 8;` line (currently line 43). Update the warp call at line 50:

```ts
const warped = warp(input, { debug: collector });
```

The remaining body of `processPicture` already does not pass `scale` to correct/crop/sample after Tasks 2-4, so no further change needed in `index.ts`.

In `packages/gbcam-extract/scripts/extract.ts`, change line 175 from:
```ts
  warp: (input, scale) => warp(input, { scale }),
```
to:
```ts
  warp: (input, _scale) => warp(input),
```

In `packages/gbcam-extract/scripts/interleave-test.ts`, change line 197 from:
```ts
      output = warp(input, { scale: 8 });
```
to:
```ts
      output = warp(input);
```

- [ ] **Step 5: Run all tests + typecheck**

Run: `pnpm --filter gbcam-extract test`
Expected: ALL unit tests PASS, including the updated warp test (k between 2 and 4).

Run: `pnpm --filter gbcam-extract typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/warp.ts packages/gbcam-extract/src/index.ts packages/gbcam-extract/scripts/extract.ts packages/gbcam-extract/scripts/interleave-test.ts packages/gbcam-extract/tests/warp.test.ts
git commit -m "feat(gbcam-extract): auto-detect scale in warp step

warp() now picks the integer scale that doesn't downsample the
detected screen quad. The chosen scale + edge measurements are
emitted in the debug log and metrics.warp.autoScale. The scale
option is removed from WarpOptions; downstream steps already infer
their own scale from input dimensions."
```

---

## Task 6: Drop `scale` from `PipelineOptions`, `extract.ts` CLI, and `run-tests.ts`

**Files:**
- Modify: `packages/gbcam-extract/src/common.ts`
- Modify: `packages/gbcam-extract/scripts/extract.ts`
- Modify: `packages/gbcam-extract/scripts/run-tests.ts`
- Modify: `packages/gbcam-extract/scripts/interleave-test.ts` (add comment about Python-side `--scale 8`)

- [ ] **Step 1: Drop `scale?` from `PipelineOptions`**

In `packages/gbcam-extract/src/common.ts`, replace the `PipelineOptions` interface (lines 49-53):

```ts
export interface PipelineOptions {
  debug?: boolean;
  onProgress?: (step: string, pct: number) => void;
}
```

- [ ] **Step 2: Clean up `extract.ts`**

In `packages/gbcam-extract/scripts/extract.ts`:

- Remove the `--scale N` line from the help block (line 37).
- Drop `scale` from `CLIArgs` (line 188): delete the `scale: number;` field.
- Drop `scale: 8,` from the args defaults (line 199).
- Remove the `case "--scale":` block (lines 223-225).
- Remove the `STEP_FUNCTIONS` `scale` parameter:

  ```ts
  const STEP_FUNCTIONS: Record<string, (input: GBImageData) => GBImageData> = {
    warp: (input) => warp(input),
    correct: (input) => correct(input),
    crop: (input) => crop(input),
    sample: (input) => sample(input),
    quantize: (input) => quantize(input),
  };
  ```

- Update the call site at line 320 from:
  ```ts
  current = stepFn(current, args.scale);
  ```
  to:
  ```ts
  current = stepFn(current);
  ```

- Update the header log line at line 287-289:
  ```ts
  console.log(
    `Pipeline: ${activeSteps.join(" -> ")}  |  scale=auto  |  ${inputFiles.length} input file(s)`
  );
  ```

- [ ] **Step 3: Clean up `run-tests.ts`**

In `packages/gbcam-extract/scripts/run-tests.ts`:

- Remove the `scale: number = 8` parameter from `runPipeline` (line 371). Adjust the body at lines 374-381:
  ```ts
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
  ```
  (Just remove the `scale,` field from the options object.)

  Verify any callers of `runPipeline` (search the file with `Grep`) don't pass a fourth argument; if they do, remove it. (Current callers do not.)

- In the sample-pictures block at line 563-570, remove the `scale: 8,` field:
  ```ts
  const result = await processPicture(input, {
    debug: true,
    onProgress: (step, pct) => {
      if (pct === 0) process.stdout.write(`    ${step}...`);
      if (pct === 100) process.stdout.write(" done\n");
    },
  });
  ```

- [ ] **Step 4: Add an explanatory comment to `interleave-test.ts`**

In `packages/gbcam-extract/scripts/interleave-test.ts`, find the `runPythonStep` function. Above the line `const scaleArg = step !== "quantize" ? "--scale 8" : "";` (currently line 140), add:

```ts
  // The Python pipeline still takes --scale; the TypeScript pipeline
  // auto-detects scale internally. We hardcode --scale 8 here to keep the
  // Python side comparable to the historical TS scale=8 default. If the TS
  // side now picks a different scale, the per-step interleaving compares
  // outputs at different resolutions, which is expected.
```

- [ ] **Step 5: Run all unit tests + typecheck**

Run: `pnpm --filter gbcam-extract test`
Expected: ALL unit tests PASS.

Run: `pnpm --filter gbcam-extract typecheck`
Expected: no errors.

Run: `pnpm typecheck` (from repo root)
Expected: no errors in either package — confirms the web frontend (which never passed `scale` to `processPicture`) is unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/common.ts packages/gbcam-extract/scripts/extract.ts packages/gbcam-extract/scripts/run-tests.ts packages/gbcam-extract/scripts/interleave-test.ts
git commit -m "refactor(gbcam-extract): remove scale from public API

Drop PipelineOptions.scale, the --scale CLI flag, and the scale
parameter on runPipeline. The TS pipeline now picks scale internally
via the auto-detect logic in warp.ts."
```

---

## Task 7: Verify pipeline accuracy via `pnpm test:pipeline`

**Files:**
- Read-only inspection of `test-output/test-summary.log` and per-image `.log` files.

- [ ] **Step 1: Capture the current accuracy baseline**

Before running the new pipeline, identify the latest accuracy numbers from the previous (pre-refactor) state. From the repo root:

```bash
git stash
pnpm --filter gbcam-extract test:pipeline
```

Note the per-image accuracy and the summary numbers in `packages/gbcam-extract/test-output/test-summary.log`. Save the file to `/tmp/test-summary-baseline.log`:

```bash
cp packages/gbcam-extract/test-output/test-summary.log /tmp/test-summary-baseline.log
```

Restore the new code:
```bash
git stash pop
```

(If there is nothing to stash because the work is already committed, skip the stash and instead run the baseline by checking out the prior commit, e.g. `git worktree add /tmp/baseline HEAD~7`, running `test:pipeline` there, copying the summary out, then removing the worktree.)

- [ ] **Step 2: Run pipeline tests on the new code**

```bash
pnpm --filter gbcam-extract test:pipeline
```

- [ ] **Step 3: Compare summaries**

Diff the new summary against the baseline:

```bash
diff /tmp/test-summary-baseline.log packages/gbcam-extract/test-output/test-summary.log
```

For each per-image log in `packages/gbcam-extract/test-output/<test-name>/<test-name>.log`, look for the new `[warp] auto-scale: …` line and confirm the chosen scale.

- [ ] **Step 4: Inspect any regressions**

If any image's accuracy drops by more than ~0.5%, open its per-image log and check:

1. The chosen scale (`[warp] auto-scale: … scale=N`).
2. Whether the scale differs from 8.
3. Whether the regression correlates with scale change.

Acceptance criteria:
- No image regresses in accuracy by more than 1% pixels-different.
- Total summary accuracy does not regress by more than 0.5%.
- For most images, the chosen scale should be 8 (matching prior behavior). High-resolution photos may legitimately pick a higher scale.

If a regression beyond the criteria is observed and is correlated with a non-8 scale, STOP and report — there is no automated remediation in this plan.

- [ ] **Step 5: Commit any artifacts (or none)**

If `test-output/` is in `.gitignore`, no commit is needed. Otherwise, the test-output is regenerated and may have changed — commit it as part of the verification. Check the project's `.gitignore` first:

```bash
git status
```

If `test-output/` shows as modified and has been committed historically, include it; otherwise leave it out.

```bash
# only if test-output is tracked
git add packages/gbcam-extract/test-output
git commit -m "test(gbcam-extract): refresh pipeline test output for auto-scale"
```

---

## Out of scope

The following are explicitly NOT part of this plan:

- Changes to the Python pipeline (`packages/gbcam-extract-py/`). It keeps its `--scale` CLI argument unchanged.
- Changes to the web frontend's `outputScale` / `previewScale` UI controls — those are unrelated post-pipeline rendering knobs.
- Introducing a non-integer scale or floor/ceiling on the auto-scale value. The spec deferred both to a future iteration.
- Performance optimisation. Higher-resolution photos may push scale above 8 and use more memory / CPU; this is acceptable per the spec.
