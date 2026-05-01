# Pipeline Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve TypeScript pipeline accuracy so all 6 reference test images reach 0 different pixels and the new bright/yellow-tinted sample `20260328_165926.jpg` produces a faithful output, by running a sequenced menu of experiments — keeping the ones that improve aggregate test error count and/or qualitative output, reverting the ones that don't.

**Architecture:** No new architectural pieces. Edits land entirely in `packages/gbcam-extract/src/{quantize,correct,sample,debug}.ts`. The existing `pnpm test:pipeline` runner provides the quantitative metric (aggregate "different pixel" count across the 6 references); `pnpm extract` against `sample-pictures/` provides qualitative inspection on the new image. Each experiment is its own commit so we can revert or bisect cleanly.

**Tech Stack:** TypeScript, vitest, opencv.js (`@techstark/opencv-js`, accessed via `getCV()` from `src/opencv.ts` — never imported directly), pnpm workspaces. All commands below are run from `packages/gbcam-extract/` unless noted.

**Spec:** `docs/superpowers/specs/2026-04-28-pipeline-accuracy-design.md`.

---

## Common Workflow (referenced by every experiment task)

Each experiment task follows the same shape. Concrete commands and edits are inlined per task, but the discipline is shared:

1. **Capture baseline once at the top of the task** — record current per-image error counts and aggregate from the most recent successful test run. The first task records the absolute baseline.
2. **Make the change as a tightly-scoped edit.** No unrelated refactors.
3. **Run vitest unit tests** when the task includes them: `pnpm test` (full vitest suite). Expected: all green.
4. **Run the pipeline test:** `pnpm test:pipeline`. Inspect `test-output/test-summary.log`. Record the new aggregate.
5. **Run the sample extraction:** `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`. Inspect:
   - `sample-pictures-out/20260328_165926_gbcam_rgb.png` — must show mostly black top-left, mostly yellow (WH) bottom third, no large pink (LG) blob in lower-middle.
   - `sample-pictures-out/debug/20260328_165926_quantize_c_rg_scatter.png` — cluster centers should be closer to palette targets than baseline.
   - `sample-pictures-out/debug/20260313_213510_sample.png` — should be less saturated/purple than baseline (qualitative).
6. **Decision rule** is task-specific. Default rule: keep if aggregate test error count drops OR holds while measurably improving the new image qualitatively. Allow up to ~5 pixels of regression for "adventurous" experiments the user judges promising.
7. **Commit on keep, `git restore` on drop.** Commit message format: `experiment(<step>): <one-line summary> — <Δerrors> aggregate <new aggregate>`.

If a task is reverted, mark the checkbox as completed-and-reverted (e.g. `- [x] (reverted)`) and continue to the next. Reverted tasks may be retried later after dependent tasks land.

---

## Task 0: Baseline measurement and worktree setup

**Files:** none modified.

- [ ] **Step 1: Verify you are on the `accuracy` branch (or a worktree branch derived from it)**

Run: `git branch --show-current`
Expected: prints `accuracy` (or your derived branch name).

- [ ] **Step 2: Run the full pipeline test from `packages/gbcam-extract/`**

Run: `pnpm test:pipeline`
Expected: `test-output/test-summary.log` shows 6 tests, all FAIL, with these baseline counts (record any deviation in the plan execution log):

```
thing-1          14318 ( 99.87%)      18 (  0.13%)   FAIL
thing-2          14293 ( 99.70%)      43 (  0.30%)   FAIL
thing-3          14325 ( 99.92%)      11 (  0.08%)   FAIL
zelda-poster-1   14331 ( 99.97%)       5 (  0.03%)   FAIL
zelda-poster-2   14316 ( 99.86%)      20 (  0.14%)   FAIL
zelda-poster-3   14322 ( 99.90%)      14 (  0.10%)   FAIL
```

**Aggregate error count: 111.** This is the baseline every subsequent task is measured against.

- [ ] **Step 3: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Expected: completes without error. Output under `../../sample-pictures-out/`.

- [ ] **Step 4: Inspect the three reference images and note baseline qualitative state**

Open in a viewer:
- `../../sample-pictures-out/20260328_165926_gbcam_rgb.png` — note the LG/pink blob in the lower-middle that should be WH/yellow.
- `../../sample-pictures-out/debug/20260328_165926_quantize_c_rg_scatter.png` — cluster centers visibly drifted from yellow-ring palette targets.
- `../../sample-pictures-out/debug/20260313_213510_sample.png` — heavy purple/pink saturation.

These are the qualitative reference points for the rest of the plan.

- [ ] **Step 5: Run unit tests to confirm a clean starting point**

Run: `pnpm test`
Expected: all vitest tests pass.

- [ ] **Step 6: Commit baseline marker (optional)**

If your branch has uncommitted state, commit it now. Otherwise skip — no code change here.

---

## Task 1: Q1 — G-valley threshold safety clamp

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts` (function `gValleyThreshold`, lines ~210–265)
- Test: `packages/gbcam-extract/tests/quantize.test.ts`

**Why:** The current `gValleyThreshold` can return a value at or extremely close to `whCenterG` when the histogram search is constrained against the upper boundary. On `20260328_165926` this produced threshold=196 with whCenterG=196.7, demoting 1591 WH pixels to LG. The clamp ensures the threshold sits comfortably between the cluster centers.

- [ ] **Step 1: Add a failing unit test that captures the bug**

Append to `packages/gbcam-extract/tests/quantize.test.ts` (after the existing `describe("quantize", ...)` block, at the bottom of the file but inside the file):

```typescript
import { gValleyThresholdForTest } from "../src/quantize.js";

describe("gValleyThreshold safety clamp", () => {
  it("never returns a threshold within 8 G-units of either cluster center", () => {
    // Histogram skewed so the natural minimum lands at the WH center
    // (mimics 20260328_165926: lgCenterG=119, whCenterG=197).
    const lgCenterG = 119;
    const whCenterG = 197;
    const gVals: number[] = [];
    // Big mass near lgCenterG
    for (let i = 0; i < 4000; i++) gVals.push(lgCenterG + (Math.random() - 0.5) * 30);
    // Small mass near whCenterG
    for (let i = 0; i < 400; i++) gVals.push(whCenterG + (Math.random() - 0.5) * 8);
    const t = gValleyThresholdForTest(gVals, lgCenterG, whCenterG);
    expect(t).toBeGreaterThanOrEqual(lgCenterG + 8);
    expect(t).toBeLessThanOrEqual(whCenterG - 8);
  });

  it("falls back to midpoint when histogram is too noisy", () => {
    const t = gValleyThresholdForTest([], 100, 200);
    expect(t).toBeCloseTo(150, 1);
  });
});
```

- [ ] **Step 2: Export the helper from `quantize.ts` so the test can call it**

Find the line `function gValleyThreshold(` in `packages/gbcam-extract/src/quantize.ts` (~line 210). At the very bottom of the file (after the existing `function countLabels` at the end), add:

```typescript
// Test-only export so unit tests can exercise gValleyThreshold directly
// without running full quantize. Do not use from production code.
export const gValleyThresholdForTest = gValleyThreshold;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- quantize`
Expected: the new "never returns a threshold within 8 G-units" test FAILS (returns ~197).

- [ ] **Step 4: Apply the safety clamp to `gValleyThreshold`**

In `packages/gbcam-extract/src/quantize.ts`, replace the body of `gValleyThreshold` (the existing function, ~lines 210–265) with:

```typescript
function gValleyThreshold(
  gVals: number[],
  lgCenterG: number,
  whCenterG: number,
): number {
  const SAFETY = 8; // never return a threshold within this many G-units of a center
  const midpoint = (lgCenterG + whCenterG) / 2.0;
  const span = whCenterG - lgCenterG;

  // If centers are too close together, no histogram search can help — use midpoint.
  if (span < 2 * SAFETY + 4) {
    return midpoint;
  }

  const lo = Math.floor(lgCenterG) + 1;
  const hi = Math.floor(whCenterG);
  if (hi <= lo + 4) {
    return midpoint;
  }

  const nBins = hi - lo + 1;
  const hist = new Array<number>(nBins).fill(0);
  let total = 0;
  for (const g of gVals) {
    const bin = Math.floor(g) - lo;
    if (bin >= 0 && bin < nBins) {
      hist[bin]++;
      total++;
    }
  }

  if (total < 10) {
    return midpoint;
  }

  const smooth = gaussianFilter1d(hist, 3.0);

  // Search the safe interior only — never within SAFETY of either center.
  const safeMinIdx = SAFETY; // bin SAFETY corresponds to value lo + SAFETY ≈ lgCenterG+1+SAFETY
  const safeMaxIdx = nBins - 1 - SAFETY;

  if (safeMaxIdx <= safeMinIdx) {
    return midpoint;
  }

  let valleyIdx = safeMinIdx;
  let minVal = smooth[safeMinIdx];
  for (let i = safeMinIdx + 1; i <= safeMaxIdx; i++) {
    if (smooth[i] < minVal) {
      minVal = smooth[i];
      valleyIdx = i;
    }
  }

  return lo + valleyIdx;
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `pnpm test -- quantize`
Expected: the previously-failing test PASSES; all other quantize tests still PASS.

- [ ] **Step 6: Run the full pipeline test**

Run: `pnpm test:pipeline`
Expected: `test-output/test-summary.log` shows aggregate error count ≤ 111 (likely unchanged, since most test images don't trigger the bug). Record per-image counts.

- [ ] **Step 7: Run sample extraction and inspect**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

Inspect `../../sample-pictures-out/20260328_165926_gbcam_rgb.png` — the LG/pink blob in the lower portion should be visibly smaller. The bottom third should now show more yellow (WH).

Inspect `../../sample-pictures-out/debug/20260328_165926_debug.json`: `metrics.quantize.valleyRefinement.changed` should be much smaller (was 1591, expect 0–200), and `valleyRefinement.threshold` should be roughly between the LG and WH G-centers (was 196, expect ~155–170).

- [ ] **Step 8: Decide and commit**

Decision rule: keep if aggregate ≤ 111 AND new image LG-blob visibly smaller. Else `git restore` and document why in the plan execution log.

```bash
git add packages/gbcam-extract/src/quantize.ts packages/gbcam-extract/tests/quantize.test.ts
git commit -m "experiment(quantize): clamp G-valley threshold ≥8 G-units from cluster centers — Δ<n> aggregate <new>"
```

---

## Task 2: X1 — Pipeline drift diagnostics

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts` (after the global k-means log block, ~line 320)
- Modify: `packages/gbcam-extract/src/correct.ts` (after the framePostCorrectionP85 log, ~line 244)

**Why:** Cheap orthogonal observability. Logs a warning whenever cluster centers drift far from palette targets, or when the frame post-correction is off-target. Doesn't fix anything but lets us spot regressions silently introduced by later experiments.

- [ ] **Step 1: Add cluster-drift warning in `quantize.ts`**

In `packages/gbcam-extract/src/quantize.ts`, find the block:

```typescript
    dbg.log(
      `[quantize] after global kmeans: ` +
        ["BK", "DG", "LG", "WH"]
          .map((n, i) => `${n}=${globalCounts[i]}`)
          .join("  "),
    );
  }
```

After the closing brace of the `if (dbg)` block (immediately following the line shown above), add:

```typescript
  // Drift diagnostic: warn when any cluster center is far from its target.
  if (dbg) {
    const DRIFT_THRESHOLD = 40;
    const targets: [number, number][] = [
      [0, 0],
      [148, 148],
      [255, 148],
      [255, 255],
    ];
    const names = ["BK", "DG", "LG", "WH"];
    const drifts: string[] = [];
    for (let pi = 0; pi < 4; pi++) {
      const dr = paletteCenters[pi][0] - targets[pi][0];
      const dg = paletteCenters[pi][1] - targets[pi][1];
      const dist = Math.sqrt(dr * dr + dg * dg);
      if (dist > DRIFT_THRESHOLD) {
        drifts.push(`${names[pi]} drifted ${dist.toFixed(0)} RG-units`);
      }
    }
    if (drifts.length > 0) {
      dbg.log(`[quantize] WARN cluster drift: ${drifts.join("; ")}`);
    }
  }
```

- [ ] **Step 2: Add frame post-correction warning in `correct.ts`**

In `packages/gbcam-extract/src/correct.ts`, find the block:

```typescript
    dbg.log(
      `[correct] frame post-correction p85: ` +
        `R=${framePost.R.toFixed(0)} G=${framePost.G.toFixed(0)} B=${framePost.B.toFixed(0)} ` +
        `(target #FFFFA5 = R255 G255 B165)`,
    );
```

Immediately after that closing `);` line, add:

```typescript
    // Drift diagnostic: warn when frame post-correction is off-target.
    const TARGET = { R: 255, G: 255, B: 165 };
    const TOL = 30;
    const offs: string[] = [];
    if (Math.abs(framePost.R - TARGET.R) > TOL) offs.push(`R off by ${(framePost.R - TARGET.R).toFixed(0)}`);
    if (Math.abs(framePost.G - TARGET.G) > TOL) offs.push(`G off by ${(framePost.G - TARGET.G).toFixed(0)}`);
    if (Math.abs(framePost.B - TARGET.B) > TOL) offs.push(`B off by ${(framePost.B - TARGET.B).toFixed(0)}`);
    if (offs.length > 0) {
      dbg.log(`[correct] WARN frame post-correction off-target: ${offs.join("; ")}`);
    }
```

- [ ] **Step 3: Run unit tests to confirm nothing broke**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 4: Run pipeline test**

Run: `pnpm test:pipeline`
Expected: aggregate error count unchanged (this task only adds logs). Inspect a few `.log` files under `test-output/<test-name>/` — you may see new `[quantize] WARN cluster drift` and `[correct] WARN frame post-correction off-target` lines on stressed images.

- [ ] **Step 5: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Expected: `20260328_165926` debug log should now contain a cluster drift warning (since WH was at G=197).

- [ ] **Step 6: Commit**

```bash
git add packages/gbcam-extract/src/quantize.ts packages/gbcam-extract/src/correct.ts
git commit -m "experiment(diagnostics): warn on cluster drift and frame post-correction off-target — Δ0 aggregate <unchanged>"
```

---

## Task 3: Q2 — Target-anchored decision boundaries

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`
- Test: `packages/gbcam-extract/tests/quantize.test.ts`

**Why:** Eliminate cluster drift as a source of decision-boundary errors by re-classifying *ambiguous* pixels (those near the cluster-pair midpoint) using the fixed palette-target midpoints. Targets:
- DG vs LG split: R = (148 + 255) / 2 = 201.5
- LG vs WH split: G = (148 + 255) / 2 = 201.5
- BK vs DG split: R = (0 + 148) / 2 = 74; G = (0 + 148) / 2 = 74

A pixel is "ambiguous" if its distance to its assigned cluster center is more than 60% of its distance to the *next-nearest* cluster center. Non-ambiguous pixels keep their k-means label.

- [ ] **Step 1: Add a unit test that exercises the override**

Append to `packages/gbcam-extract/tests/quantize.test.ts` inside a new `describe` block at the bottom:

```typescript
describe("target-anchored decision boundaries", () => {
  it("re-classifies an ambiguous mid-R pixel using R=201.5 boundary", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    // Fill with content that gives k-means clusters drifted to:
    //   BK ≈ (15,5), DG ≈ (130,140), LG ≈ (210,140), WH ≈ (240,210)
    // Then a single test pixel at R=200, G=140 (just under the target boundary
    // 201.5) — k-means may put it in LG; target-anchored should put it in DG.
    // We seed three big bands then put the test pixel in a corner.

    const fill = (r: number, g: number, b: number, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < CAM_W; x++) {
          const i = (y * CAM_W + x) * 4;
          input.data[i] = r;
          input.data[i + 1] = g;
          input.data[i + 2] = b;
          input.data[i + 3] = 255;
        }
      }
    };
    fill(15, 5, 30, 0, 28);
    fill(130, 140, 240, 28, 56);
    fill(210, 140, 150, 56, 84);
    fill(240, 210, 170, 84, 112);

    // Test pixel — set in a single position
    const tx = 0, ty = 0;
    const ti = (ty * CAM_W + tx) * 4;
    input.data[ti] = 200;
    input.data[ti + 1] = 140;
    input.data[ti + 2] = 30;

    const out = quantize(input);
    // R=200 < 201.5 => target-anchored picks DG (gray 82). LG would be 165.
    expect(out.data[(ty * CAM_W + tx) * 4]).toBe(82);
  });
});
```

- [ ] **Step 2: Run the test to confirm current failure (or non-deterministic pass)**

Run: `pnpm test -- quantize`
Expected: this test may pass or fail depending on cluster drift; record outcome. Either way, after Step 3 it should reliably PASS.

- [ ] **Step 3: Implement the target-anchored override pass**

In `packages/gbcam-extract/src/quantize.ts`, after the strip ensemble block ends (just after the line `const stripCounts = countLabels(finalLabels);` and *before* the `// ── 3. G-valley LG/WH refinement ──` comment, ~line 448), insert this new section:

```typescript
  // ── 2.5. Target-anchored override for ambiguous pixels ──
  // Targets: BK=(0,0), DG=(148,148), LG=(255,148), WH=(255,255). Any pixel
  // whose RG distance to the assigned cluster is > 60% of distance to the
  // next-nearest cluster is re-classified using fixed midpoints from palette
  // targets, immune to cluster drift.
  const TARGETS_RG: [number, number][] = [[0, 0], [148, 148], [255, 148], [255, 255]];
  const AMBIGUITY_RATIO = 0.6;
  let targetAnchoredChanged = 0;

  function classifyByTargets(r: number, g: number): number {
    // Use fixed midpoints. R=201.5 splits DG/LG; G=201.5 splits LG/WH;
    // R=74 and G=74 split BK from {DG/LG/WH}.
    if (r < 74 && g < 74) return 0; // BK
    if (r < 201.5) return 1; // DG (LG would require R≥201.5)
    return g < 201.5 ? 2 : 3; // LG or WH
  }

  for (let i = 0; i < N; i++) {
    const r = flatRG[i * 2];
    const g = flatRG[i * 2 + 1];
    const cur = finalLabels[i];

    // Distances to cluster centers (in RG).
    let bestDist = Infinity;
    let secondDist = Infinity;
    for (let pi = 0; pi < 4; pi++) {
      const dr = r - paletteCenters[pi][0];
      const dg = g - paletteCenters[pi][1];
      const d = Math.sqrt(dr * dr + dg * dg);
      if (d < bestDist) {
        secondDist = bestDist;
        bestDist = d;
      } else if (d < secondDist) {
        secondDist = d;
      }
    }
    if (secondDist === 0) continue;
    if (bestDist / secondDist < AMBIGUITY_RATIO) continue; // unambiguous, keep

    const targetLabel = classifyByTargets(r, g);
    if (targetLabel !== cur) {
      finalLabels[i] = targetLabel;
      targetAnchoredChanged++;
    }
  }

  if (dbg) {
    dbg.log(
      `[quantize] target-anchored override: changed ${targetAnchoredChanged} px`,
    );
  }
```

- [ ] **Step 4: Run the unit test**

Run: `pnpm test -- quantize`
Expected: all quantize tests PASS, including the new target-anchored test.

- [ ] **Step 5: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: aggregate error count drops. The `LG -> DG` and `DG -> LG` cells of confusion matrices should shrink, especially on `thing-2`. Record the new aggregate.

- [ ] **Step 6: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

Expected: `20260328_165926_gbcam_rgb.png` LG/pink area should shrink further as ambiguous-LG pixels get re-classified.

- [ ] **Step 7: Decide and commit**

Decision: keep if aggregate drops or holds while the new image visibly improves. Be willing to accept a small per-image regression on a previously-low-error test (e.g. `zelda-poster-1` going from 5→8) if aggregate net is favorable. Otherwise tune `AMBIGUITY_RATIO` (try 0.5 or 0.7) or `git restore`.

```bash
git add packages/gbcam-extract/src/quantize.ts packages/gbcam-extract/tests/quantize.test.ts
git commit -m "experiment(quantize): target-anchored override for ambiguous-RG pixels — Δ-<n> aggregate <new>"
```

---

## Task 4: B-Channel Bundle (C-extra-1 + Q-extra-1)

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts` (add B-channel correction)
- Modify: `packages/gbcam-extract/src/quantize.ts` (add B-axis tie-breaker)
- Test: `packages/gbcam-extract/tests/correct.test.ts`, `packages/gbcam-extract/tests/quantize.test.ts`

**Why:** The largest expected improvement. Currently B is uncorrected (passthrough) and unused in quantize. Correcting B + using it as a tie-breaker for ambiguous LG↔DG pixels gives an independent 107-unit-separation axis on the dominant test failure (40 of 43 errors on `thing-2` are LG↔DG).

This is a single commit because each half alone doesn't help (raw B is too noisy for quantize; corrected B has no consumer). If the bundle regresses, revert as a unit.

### Part A — B-channel correction in `correct.ts`

- [ ] **Step 1: Add a unit test for B-channel correction**

Append to `packages/gbcam-extract/tests/correct.test.ts` (after the existing tests):

```typescript
describe("correct B channel", () => {
  it("normalizes B channel of frame strip to ~165", async () => {
    // Build a synthetic correct input: full warp-sized RGBA grid where:
    //   - frame strip rows have R=255, G=255, B=180 (frame target before correction)
    //   - inner border has R=148, G=148, B=240 (DG target before correction)
    //   - interior is constant R=200, G=200, B=200
    // After correction, frame B should be ~165.
    const scale = 8;
    const W = 160 * scale;
    const H = 144 * scale;
    const img = createGBImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        img.data[i] = 200; img.data[i + 1] = 200; img.data[i + 2] = 200;
        img.data[i + 3] = 255;
      }
    }
    // Frame strip: rows 0..15 and (160-16)..H-1
    const frameY = [0, 16 * scale, (160 - 16) * scale, H];
    for (let y = 0; y < 16 * scale; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 180;
      }
    }
    const out = correct(img, { scale });
    // Sample frame strip B
    let bSum = 0, n = 0;
    for (let y = 0; y < 8 * scale; y++) {
      for (let x = 30 * scale; x < 130 * scale; x++) {
        bSum += out.data[(y * W + x) * 4 + 2];
        n++;
      }
    }
    const meanB = bSum / n;
    expect(meanB).toBeGreaterThan(150);
    expect(meanB).toBeLessThan(180);
  });
});
```

(Imports: ensure `correct`, `createGBImageData` are imported from `../src/correct.js` and `../src/common.js` respectively at the top of the file.)

- [ ] **Step 2: Run test, expect it to fail**

Run: `pnpm test -- correct`
Expected: new test FAILS — current code passthroughs B (mean B will be ~180, not ~165).

- [ ] **Step 3: Generalize `applyCorrectionChannel` to handle inverted targets**

In `packages/gbcam-extract/src/correct.ts`, replace `applyCorrectionChannel` (lines ~818–840) with:

```typescript
function applyCorrectionChannel(
  channel: Float32Array,
  whiteSurface: Float32Array,
  darkSurface: Float32Array,
  W: number,
  H: number,
  whiteTarget: number,
  darkTarget: number,
): Float32Array {
  const corrected = new Float32Array(H * W);
  const span = whiteTarget - darkTarget; // may be negative (B has white=165, dark=255)
  const minObservedSpan = 5;

  for (let i = 0; i < H * W; i++) {
    const ws = whiteSurface[i];
    const ds = darkSurface[i];
    const observedSpan = ws - ds;
    // Preserve sign of observedSpan to match the actual surface relationship,
    // but clamp magnitude to avoid blowups.
    const safeObservedSpan =
      Math.sign(observedSpan) *
      Math.max(Math.abs(observedSpan), minObservedSpan);
    const gain = safeObservedSpan / span; // dimensionless
    const offset = ds - gain * darkTarget;
    const val = (channel[i] - offset) / gain;
    corrected[i] = Math.max(0, Math.min(255, Math.round(val)));
  }

  return corrected;
}
```

- [ ] **Step 4: Add B-channel correction in `correct.ts`**

In `packages/gbcam-extract/src/correct.ts`, replace the lines:

```typescript
  // B channel: white=dark (no correction, both are close to ~200)
  // For simplicity, keep B as-is or apply light correction
  let correctedB = new Float32Array(chB);
```

with:

```typescript
  // B channel: frame target B=165 (#FFFFA5), DG inner-border target B=255 (#9494FF).
  // Note: white target (165) < dark target (255) for B — applyCorrectionChannel
  // handles the negative-span case via Math.sign on observed span.
  const {
    ys: whiteYsB,
    xs: whiteXsB,
    vs: whiteVsB,
  } = collectWhiteSamples(chB, W, H, scale);
  const whiteSurfaceB = fitSurface(whiteYsB, whiteXsB, whiteVsB, H, W, polyDegree);
  const { left: leftB, right: rightB, top: topB, bot: botB } = collectDarkSamples(
    chB,
    W,
    H,
    scale,
  );
  let darkSurfaceB = buildDarkSurface(leftB, rightB, topB, botB, H, W, scale, darkSmooth);
  let correctedB = applyCorrectionChannel(chB, whiteSurfaceB, darkSurfaceB, W, H, 165, 255);
```

- [ ] **Step 5: Add B-channel iterative refinement in the refinement loop**

In `correct.ts`, find the iterative-refinement loop (the `for (let pass = 0; pass < refinePasses; pass++) {` block, ~lines 160–196). After the existing `refinedG` block (immediately before the closing `}` of the for loop), add:

```typescript
    const refinedB = refinePassChannel(
      correctedB,
      chB,
      whiteSurfaceB,
      darkSurfaceB,
      W,
      H,
      scale,
      darkSmooth,
      165,
      255,
    );
    if (refinedB !== null) {
      darkSurfaceB = refinedB.darkSurface;
      correctedB = refinedB.corrected;
    }
```

- [ ] **Step 6: Update `refinePassChannel` to handle the inverted-target case**

In `correct.ts`, find `refinePassChannel`. Replace these lines:

```typescript
      const darkMin = Math.max(0, darkTarget - 30);
      const darkMax = Math.min(255, darkTarget + 30);
      if (val >= darkMin && val <= darkMax) {
```

with:

```typescript
      const darkMin = Math.max(0, darkTarget - 30);
      const darkMax = Math.min(255, darkTarget + 30);
      // Also accept whiteTarget-adjacent classification; for B, dark=255 may
      // still be the right anchor when interior pixel is bright-blue (DG).
      if (val >= darkMin && val <= darkMax) {
```

(No semantic change — comment only. The existing `[darkTarget - 30, darkTarget + 30]` band still works for both R/G dark target=148 and B dark target=255, because the band is centered on the right value in each case.)

Then in the same function, replace:

```typescript
  // Clamp: refined surface must not go below initial Coons estimate
  for (let i = 0; i < H * W; i++) {
    newDarkSurface[i] = Math.max(newDarkSurface[i], darkSurface[i]);
  }
```

with:

```typescript
  // Clamp: refined surface must not move further from darkTarget than the
  // initial Coons estimate. For dark targets ≥ whiteTarget (B channel),
  // "further" means lower; for dark targets ≤ whiteTarget (R/G), "further"
  // means lower too — same direction either way: we never let the refined
  // dark surface go below the Coons estimate.
  for (let i = 0; i < H * W; i++) {
    newDarkSurface[i] = Math.max(newDarkSurface[i], darkSurface[i]);
  }
```

(Comment refresh; behavior unchanged. Verify by running tests next.)

- [ ] **Step 7: Run unit tests**

Run: `pnpm test -- correct`
Expected: the new B-channel test PASSES; all existing correct tests still PASS.

### Part B — B-axis tie-breaker in `quantize.ts`

- [ ] **Step 8: Add a unit test for B-axis tie-breaker**

Append to `packages/gbcam-extract/tests/quantize.test.ts` in a new `describe` block:

```typescript
describe("B-axis tie-breaker", () => {
  it("uses B to disambiguate LG vs DG when RG is borderline", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    // Fill background with mostly DG-ish content
    for (let y = 0; y < CAM_H; y++) {
      for (let x = 0; x < CAM_W; x++) {
        const i = (y * CAM_W + x) * 4;
        input.data[i] = 148; input.data[i + 1] = 148; input.data[i + 2] = 240;
        input.data[i + 3] = 255;
      }
    }
    // Borderline-R pixel at (0,0) with B clearly LG-like (low B)
    let i = 0;
    input.data[i] = 200; input.data[i + 1] = 148; input.data[i + 2] = 130; // R=200 borderline, B=130 LG
    // Borderline-R pixel at (1,0) with B clearly DG-like (high B)
    i = 4;
    input.data[i] = 200; input.data[i + 1] = 148; input.data[i + 2] = 250; // R=200 borderline, B=250 DG

    const out = quantize(input);
    // The first should be LG (165), second should be DG (82).
    expect(out.data[0]).toBe(165);
    expect(out.data[4]).toBe(82);
  });
});
```

- [ ] **Step 9: Run test, expect failure**

Run: `pnpm test -- quantize`
Expected: B-axis tie-breaker test FAILS.

- [ ] **Step 10: Implement the B-axis tie-breaker in `quantize.ts`**

In `packages/gbcam-extract/src/quantize.ts`, find this block at the top of `quantize`:

```typescript
  // Extract RG values (Nx2 float32) and full RGB (Nx3)
  const flatRG = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    flatRG[i * 2] = input.data[i * 4]; // R
    flatRG[i * 2 + 1] = input.data[i * 4 + 1]; // G
  }
```

Replace it with:

```typescript
  // Extract RG values (Nx2 float32) and B values (N)
  const flatRG = new Float32Array(N * 2);
  const flatB = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    flatRG[i * 2] = input.data[i * 4]; // R
    flatRG[i * 2 + 1] = input.data[i * 4 + 1]; // G
    flatB[i] = input.data[i * 4 + 2]; // B
  }
```

Then, after the G-valley refinement block ends (just before `// ── 4. Output: map palette indices to grayscale values ──`, ~line 506), insert:

```typescript
  // ── 3.5. B-axis tie-breaker for borderline LG↔DG pixels ──
  // DG target B=255, LG target B=148 (107-unit gap, independent of R/G).
  // Apply only to LG↔DG pairs where R is in the borderline range [170, 230].
  const B_DG_TARGET = 255;
  const B_LG_TARGET = 148;
  const B_MIDPOINT = (B_DG_TARGET + B_LG_TARGET) / 2; // 201.5
  const R_BORDERLINE_LO = 170;
  const R_BORDERLINE_HI = 230;
  let bTieChanged = 0;
  for (let i = 0; i < N; i++) {
    const cur = finalLabels[i];
    if (cur !== 1 && cur !== 2) continue; // only DG↔LG candidates
    const r = flatRG[i * 2];
    if (r < R_BORDERLINE_LO || r > R_BORDERLINE_HI) continue; // not borderline
    const b = flatB[i];
    const targetByB = b >= B_MIDPOINT ? 1 : 2; // high B → DG, low B → LG
    if (targetByB !== cur) {
      finalLabels[i] = targetByB;
      bTieChanged++;
    }
  }
  if (dbg) {
    dbg.log(`[quantize] B-axis tie-breaker: changed ${bTieChanged} px`);
  }
```

- [ ] **Step 11: Run unit tests**

Run: `pnpm test`
Expected: all tests pass, including the new B-axis tie-breaker test.

- [ ] **Step 12: Run pipeline test**

Run: `pnpm test:pipeline`
Expected: aggregate error count drops, especially `LG→DG` and `DG→LG` cells. `thing-2` is the most likely beneficiary. Record new aggregate.

- [ ] **Step 13: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

Expected:
- `20260328_165926_gbcam_rgb.png` improved further — pink (LG) regions where the user expects yellow (WH) should be reduced; some bottom-right WH may now appear correctly.
- `20260328_165926_debug.json`: `metrics.correct.framePostCorrectionP85.B` should now be ~165 (was 195).
- `20260313_213510_sample.png`: visibly less purple/saturated since B is no longer a wild uncorrected channel.

- [ ] **Step 14: Decide and commit (single bundle commit)**

Decision: keep if aggregate drops by ≥10 OR (aggregate holds AND the new image qualitatively improves). The user has authorized adventurous batch acceptance — accept up to ~10 pixels of regression on individual tests if the bundle clearly improves the bright-image case.

```bash
git add packages/gbcam-extract/src/correct.ts packages/gbcam-extract/src/quantize.ts \
        packages/gbcam-extract/tests/correct.test.ts packages/gbcam-extract/tests/quantize.test.ts
git commit -m "experiment(correct,quantize): B-channel correction + B-axis tie-breaker bundle — Δ-<n> aggregate <new>"
```

If the bundle regresses badly, `git restore` everything in this task and document. The bundle can later be retried with a 3D RGB k-means variant instead of tie-breaker.

---

## Task 5: S1 — Robust per-block aggregation in sample

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts` (the inner sampling loop, lines ~85–110)
- Test: `packages/gbcam-extract/tests/sample.test.ts`

**Why:** Replace the flat mean over each sub-pixel column rectangle with a 20%-trimmed mean. Inter-pixel dark gaps and bright bleeds both pull the mean; trimming removes them.

- [ ] **Step 1: Add a unit test that exercises the trim**

Append to `packages/gbcam-extract/tests/sample.test.ts`:

```typescript
describe("sample trimmed mean", () => {
  it("ignores extreme outliers in a sub-pixel column", () => {
    // Build a single 8x8 block where the R sub-pixel column
    // is mostly value 200 except for two outliers (0 and 255).
    // 20% trim should drop the two outliers and return ~200.
    const scale = 8;
    const input = createGBImageData(CAM_W * scale, CAM_H * scale);
    for (let i = 0; i < input.data.length; i += 4) {
      input.data[i] = 100; input.data[i + 1] = 100; input.data[i + 2] = 100;
      input.data[i + 3] = 255;
    }
    // R sub-pixel cols at x in [5, 7) for block (0,0): rows 1..6 (vMargin=1)
    for (let y = 1; y < 7; y++) {
      for (let x = 5; x < 7; x++) {
        const i = (y * input.width + x) * 4;
        input.data[i] = 200; // R
      }
    }
    // Outlier pixels
    input.data[(1 * input.width + 5) * 4] = 0;     // dark gap
    input.data[(6 * input.width + 6) * 4] = 255;   // bleed

    const out = sample(input, { scale });
    // Block (0,0)'s R should be close to 200 (with trim), not pulled by 0/255.
    expect(out.data[0]).toBeGreaterThan(190);
    expect(out.data[0]).toBeLessThan(210);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm test -- sample`
Expected: test fails — current flat-mean is pulled by outliers.

- [ ] **Step 3: Add a trimmed-mean helper**

In `packages/gbcam-extract/src/sample.ts`, just under the imports at the top (above `export interface SampleOptions`), add:

```typescript
/**
 * Compute the trimmed mean: drop the lowest and highest fraction of values,
 * average the rest. Falls back to plain mean when fewer than ~5 values.
 */
function trimmedMean(values: number[], trimFrac: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n < 5) {
    let s = 0;
    for (const v of values) s += v;
    return s / n;
  }
  values.sort((a, b) => a - b);
  const lo = Math.floor(n * trimFrac);
  const hi = n - lo;
  let s = 0;
  for (let i = lo; i < hi; i++) s += values[i];
  return s / (hi - lo);
}
```

- [ ] **Step 4: Replace the sum/count accumulators with trimmed-mean collection**

In `packages/gbcam-extract/src/sample.ts`, replace the inner loop block:

```typescript
      let rSum = 0,
        gSum = 0,
        bSum = 0;
      let rCount = 0,
        gCount = 0,
        bCount = 0;

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
```

with:

```typescript
      const rVals: number[] = [];
      const gVals: number[] = [];
      const bVals: number[] = [];

      for (let y = y1; y < y2; y++) {
        const rowBase = y * input.width;
        for (let dx = rLo; dx < rHi; dx++) {
          rVals.push(input.data[(rowBase + x0 + dx) * 4]);
        }
        for (let dx = gLo; dx < gHi; dx++) {
          gVals.push(input.data[(rowBase + x0 + dx) * 4 + 1]);
        }
        for (let dx = bLo; dx < bHi; dx++) {
          bVals.push(input.data[(rowBase + x0 + dx) * 4 + 2]);
        }
      }

      const TRIM = 0.2;
      output.data[outIdx] = Math.round(trimmedMean(rVals, TRIM));
      output.data[outIdx + 1] = Math.round(trimmedMean(gVals, TRIM));
      output.data[outIdx + 2] = Math.round(trimmedMean(bVals, TRIM));
      output.data[outIdx + 3] = 255;
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- sample`
Expected: new trim test PASSES; existing sample tests still PASS.

- [ ] **Step 6: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: aggregate may drop slightly. The biggest expected improvement is qualitative (less saturated `_sample.png`), not quantitative.

- [ ] **Step 7: Run sample extraction and inspect**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

Inspect `sample-pictures-out/debug/20260313_213510_sample.png` — visibly less saturated/purple than baseline.

- [ ] **Step 8: Commit (or revert)**

Decision: keep if aggregate ≤ Task-4 result AND sample.png is visibly cleaner. If aggregate regresses by more than ~3, try `TRIM = 0.15` or `0.1` first. If still bad, revert.

```bash
git add packages/gbcam-extract/src/sample.ts packages/gbcam-extract/tests/sample.test.ts
git commit -m "experiment(sample): 20%-trimmed mean per sub-pixel column — Δ<n> aggregate <new>"
```

---

## Task 6: Q-extra-4 — R-valley refinement (mirror of G-valley for LG/DG split)

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`
- Test: `packages/gbcam-extract/tests/quantize.test.ts`

**Why:** The G-valley refinement runs on LG/WH (G-axis split). Mirror the same approach on the R-axis for the LG/DG split — which is where most test errors live. The Q1 safety clamp from Task 1 is reused.

- [ ] **Step 1: Add a unit test**

Append to `packages/gbcam-extract/tests/quantize.test.ts`:

```typescript
describe("R-valley refinement", () => {
  it("re-classifies low-G pixels using R histogram valley", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    // Half DG-like (R~150), half LG-like (R~250), all G≈148 B≈200
    for (let y = 0; y < CAM_H; y++) {
      for (let x = 0; x < CAM_W; x++) {
        const i = (y * CAM_W + x) * 4;
        const isLG = x > CAM_W / 2;
        input.data[i] = isLG ? 250 : 150;
        input.data[i + 1] = 148;
        input.data[i + 2] = 200;
        input.data[i + 3] = 255;
      }
    }
    const out = quantize(input);
    // Left half should be DG (82), right half LG (165). Boundary near x=64.
    expect(out.data[(0 * CAM_W + 10) * 4]).toBe(82);
    expect(out.data[(0 * CAM_W + CAM_W - 10) * 4]).toBe(165);
  });
});
```

- [ ] **Step 2: Run test (likely passes already; this is a regression guard)**

Run: `pnpm test -- quantize`
Expected: passes or fails — record state.

- [ ] **Step 3: Add the R-valley refinement after the G-valley block in `quantize.ts`**

In `packages/gbcam-extract/src/quantize.ts`, find the end of the G-valley refinement block (after the `if (dbg) { dbg.log( ... \`G-valley refinement: ...\`); }` and before `// ── 3.5. B-axis tie-breaker` if Task 4 landed, else before `// ── 4. Output:` ). Insert:

```typescript
  // ── 3.25. R-valley LG/DG refinement (mirror of G-valley for L/W) ──
  let dgClusterIdx = -1;
  let lgClusterIdx2 = -1;
  for (let ci = 0; ci < 4; ci++) {
    if (clusterToPalette[ci] === 1) dgClusterIdx = ci;
    if (clusterToPalette[ci] === 2) lgClusterIdx2 = ci;
  }
  let rValleyThreshold: number | null = null;
  let rValleyChanged = 0;
  if (dgClusterIdx >= 0 && lgClusterIdx2 >= 0) {
    const dgCR = global.centers[dgClusterIdx * 2]; // R component of DG center
    const lgCR = global.centers[lgClusterIdx2 * 2]; // R component of LG center
    // Collect R values of low-G pixels (G < 200, candidates for DG/LG split)
    const rLowG: number[] = [];
    for (let i = 0; i < N; i++) {
      if (flatRG[i * 2 + 1] < 200) {
        rLowG.push(flatRG[i * 2]);
      }
    }
    const rThresh = gValleyThresholdForTest(rLowG, dgCR, lgCR);
    rValleyThreshold = rThresh;

    // Apply threshold to DG/LG pixels
    for (let i = 0; i < N; i++) {
      if (flatRG[i * 2 + 1] < 200 && (finalLabels[i] === 1 || finalLabels[i] === 2)) {
        const newLabel = flatRG[i * 2] >= rThresh ? 2 : 1;
        if (newLabel !== finalLabels[i]) {
          rValleyChanged++;
          finalLabels[i] = newLabel;
        }
      }
    }
    if (dbg) {
      dbg.log(
        `[quantize] R-valley refinement: threshold=${rThresh.toFixed(1)} ` +
          `(DG center R=${dgCR.toFixed(1)}, LG center R=${lgCR.toFixed(1)}), ` +
          `changed ${rValleyChanged} px`,
      );
    }
  }
```

(The function `gValleyThresholdForTest` was exported in Task 1. The clamp built into it works as well for the R axis as for G.)

- [ ] **Step 4: Run unit tests**

Run: `pnpm test -- quantize`
Expected: all pass.

- [ ] **Step 5: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: aggregate drops further — `thing-2`'s LG→DG count especially.

- [ ] **Step 6: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

Expected: minor effect on the new image (B-tie-breaker from Task 4 already covers most LG/DG separation there). Watch for over-correction.

- [ ] **Step 7: Decide and commit**

```bash
git add packages/gbcam-extract/src/quantize.ts packages/gbcam-extract/tests/quantize.test.ts
git commit -m "experiment(quantize): add R-valley refinement for LG/DG split — Δ-<n> aggregate <new>"
```

If R-valley over-corrects (e.g. `zelda-poster-1` regresses by >3), constrain it to apply only when the RG cluster centers' R-axis distance is in a narrow band (160–250) — or revert.

---

## Task 7: C-extra-2 — Frame post-correction calibration check

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

**Why:** After the existing correction step, measure frame post-correction p85 (already computed) and apply a global per-channel scale to land the frame on `(255, 255, 165)`. Cheap belt-and-suspenders for residual systematic miscalibration.

- [ ] **Step 1: Add the calibration step in `correct.ts`**

In `packages/gbcam-extract/src/correct.ts`, find the section at the bottom that computes `framePost` (in the `if (dbg)` block, ~line 239). Move the framePost computation OUT of the `if (dbg)` block so it always runs, then apply a global scale before assembling the output. Concretely, replace:

```typescript
  // ── Build output RGBA ──
  const output = createGBImageData(W, H);
  for (let i = 0; i < H * W; i++) {
    const j = i * 4;
    output.data[j] = Math.max(0, Math.min(255, Math.round(correctedR[i])));
    output.data[j + 1] = Math.max(0, Math.min(255, Math.round(correctedG[i])));
    output.data[j + 2] = Math.max(0, Math.min(255, Math.round(correctedB[i])));
    output.data[j + 3] = 255;
  }
```

with:

```typescript
  // ── Build provisional output to measure frame post-correction ──
  const provisional = createGBImageData(W, H);
  for (let i = 0; i < H * W; i++) {
    const j = i * 4;
    provisional.data[j] = Math.max(0, Math.min(255, Math.round(correctedR[i])));
    provisional.data[j + 1] = Math.max(0, Math.min(255, Math.round(correctedG[i])));
    provisional.data[j + 2] = Math.max(0, Math.min(255, Math.round(correctedB[i])));
    provisional.data[j + 3] = 255;
  }

  // ── Frame post-correction calibration (global per-channel scale) ──
  const framePostMeasured = framePost85(provisional);
  const TARGET_FRAME = { R: 255, G: 255, B: 165 };
  const TOL = 8;
  // Avoid divide-by-zero / extreme scales
  const safeScale = (m: number, t: number): number => {
    if (m < 1) return 1; // measurement is noise; skip
    const s = t / m;
    return Math.max(0.85, Math.min(1.18, s));
  };
  const scaleR =
    Math.abs(framePostMeasured.R - TARGET_FRAME.R) > TOL
      ? safeScale(framePostMeasured.R, TARGET_FRAME.R)
      : 1;
  const scaleG =
    Math.abs(framePostMeasured.G - TARGET_FRAME.G) > TOL
      ? safeScale(framePostMeasured.G, TARGET_FRAME.G)
      : 1;
  const scaleB =
    Math.abs(framePostMeasured.B - TARGET_FRAME.B) > TOL
      ? safeScale(framePostMeasured.B, TARGET_FRAME.B)
      : 1;

  const output = createGBImageData(W, H);
  for (let i = 0; i < H * W; i++) {
    const j = i * 4;
    output.data[j] = Math.max(0, Math.min(255, Math.round(provisional.data[j] * scaleR)));
    output.data[j + 1] = Math.max(0, Math.min(255, Math.round(provisional.data[j + 1] * scaleG)));
    output.data[j + 2] = Math.max(0, Math.min(255, Math.round(provisional.data[j + 2] * scaleB)));
    output.data[j + 3] = 255;
  }
```

Then in the existing `if (dbg)` block, where `framePost85(output)` is called, change it to log both the pre-scale and post-scale values:

```typescript
    const framePost = framePost85(output);
    dbg.log(
      `[correct] frame post-correction p85 (pre-scale): ` +
        `R=${framePostMeasured.R.toFixed(0)} G=${framePostMeasured.G.toFixed(0)} B=${framePostMeasured.B.toFixed(0)}`,
    );
    dbg.log(
      `[correct] frame post-correction p85 (post-scale): ` +
        `R=${framePost.R.toFixed(0)} G=${framePost.G.toFixed(0)} B=${framePost.B.toFixed(0)} ` +
        `(target #FFFFA5 = R255 G255 B165, scales R=${scaleR.toFixed(3)} G=${scaleG.toFixed(3)} B=${scaleB.toFixed(3)})`,
    );
```

(Replace the existing single `dbg.log(...frame post-correction p85...)` line with these two.)

- [ ] **Step 2: Run unit tests**

Run: `pnpm test -- correct`
Expected: all pass.

- [ ] **Step 3: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: small aggregate change. Most useful for validating the diagnostics signal.

- [ ] **Step 4: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Inspect debug log for `20260328_165926` — `framePostCorrectionP85` post-scale should be very close to (255,255,165).

- [ ] **Step 5: Decide and commit**

```bash
git add packages/gbcam-extract/src/correct.ts
git commit -m "experiment(correct): apply global per-channel scale to land frame post-correction on target — Δ<n> aggregate <new>"
```

If aggregate regresses by >5, revert — the scale clamp `[0.85, 1.18]` may be too wide.

---

## Task 8: C1 — White surface estimation for bright-heavy content

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

**Why:** When the camera region has very high mean brightness (heuristic: mean R > 180), the iterative refinement using interior DG-classified pixels may pull the white surface around because the "DG-classified" pixels are wrong on bright-heavy images. Skip iterative refinement when the bright-heavy heuristic fires.

- [ ] **Step 1: Add a brightness heuristic and skip iterative refinement when triggered**

In `packages/gbcam-extract/src/correct.ts`, find the iterative refinement loop (`for (let pass = 0; pass < refinePasses; pass++) {`). Just before the loop, add:

```typescript
  // Bright-heavy content heuristic: if camera region mean R is very high,
  // the interior DG calibration is likely to mis-classify and pull the
  // surfaces. Skip iterative refinement in that case.
  let cameraMeanR = 0;
  {
    const x0 = FRAME_THICK * scale;
    const y0 = FRAME_THICK * scale;
    const x1 = (FRAME_THICK + CAM_W) * scale;
    const y1 = (FRAME_THICK + CAM_H) * scale;
    let sum = 0; let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += correctedR[y * W + x];
        n++;
      }
    }
    cameraMeanR = n > 0 ? sum / n : 0;
  }
  const BRIGHT_HEAVY_THRESH = 180;
  const skipRefinement = cameraMeanR > BRIGHT_HEAVY_THRESH;
  if (dbg) {
    dbg.log(
      `[correct] bright-heavy heuristic: cameraMeanR=${cameraMeanR.toFixed(1)}` +
        ` skipRefinement=${skipRefinement}`,
    );
  }
```

Then change the for loop to:

```typescript
  for (let pass = 0; pass < refinePasses && !skipRefinement; pass++) {
```

- [ ] **Step 2: Run unit tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 3: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: aggregate likely unchanged for the 6 reference images (none are bright-heavy enough to trigger the heuristic).

- [ ] **Step 4: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Inspect `20260328_165926_debug.json`: `metrics.correct.dgCalibrationPixels` should now be 0 (or refinement skipped). The corrected image should look less saturated, as the dark surface no longer over-fits.

- [ ] **Step 5: Decide and commit**

```bash
git add packages/gbcam-extract/src/correct.ts
git commit -m "experiment(correct): skip iterative refinement on bright-heavy images (mean R > 180) — Δ<n> aggregate <new>"
```

If aggregate regresses, lower the threshold to 200 or revert. The heuristic threshold may need tuning.

---

## Task 9: Q3 — Constrained k-means

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`

**Why:** Alternative to Q2 (target-anchored) — allow k-means to converge but reject final centers that drift more than 60 RG units from their target. If a center drifts too far, snap it back to a midpoint between its current position and the target.

This is most useful as a *backup* — try only if Tasks 3 + 4 didn't fully close the LG↔DG gap.

- [ ] **Step 1: Add cluster-snap logic after global k-means**

In `packages/gbcam-extract/src/quantize.ts`, find the line:

```typescript
  const global = runKmeans(flatRG, N, INIT_CENTERS_RG);
```

Immediately after, insert:

```typescript
  // Snap any center that drifted more than DRIFT_MAX from its eventual palette
  // target back to a 70/30 blend of current/target.
  {
    const tmpC2P = bestClusterToPalette(global.centers, targetsRG);
    const DRIFT_MAX = 60;
    for (let ci = 0; ci < 4; ci++) {
      const pi = tmpC2P[ci];
      const tr = targetsRG[pi][0];
      const tg = targetsRG[pi][1];
      const cr = global.centers[ci * 2];
      const cg = global.centers[ci * 2 + 1];
      const dist = Math.sqrt((cr - tr) ** 2 + (cg - tg) ** 2);
      if (dist > DRIFT_MAX) {
        global.centers[ci * 2] = cr * 0.7 + tr * 0.3;
        global.centers[ci * 2 + 1] = cg * 0.7 + tg * 0.3;
        // Re-assign labels with the snapped centers
        for (let i = 0; i < N; i++) {
          let bestK = 0;
          let bestD = Infinity;
          for (let k = 0; k < 4; k++) {
            const dr = flatRG[i * 2] - global.centers[k * 2];
            const dgg = flatRG[i * 2 + 1] - global.centers[k * 2 + 1];
            const d = dr * dr + dgg * dgg;
            if (d < bestD) { bestD = d; bestK = k; }
          }
          global.labels[i] = bestK;
        }
      }
    }
  }
```

- [ ] **Step 2: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: aggregate changes; particularly watch `thing-2` and `20260328_165926`.

- [ ] **Step 3: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Inspect `20260328_165926_quantize_c_rg_scatter.png` — cluster centers (white +) should now sit closer to palette targets (yellow rings).

- [ ] **Step 4: Decide and commit**

```bash
git add packages/gbcam-extract/src/quantize.ts
git commit -m "experiment(quantize): snap drifted k-means centers toward palette targets — Δ<n> aggregate <new>"
```

Most likely outcome: this duplicates Q2's effect. If neither does much when both are present, revert this one and keep Q2.

---

## Task 10: Q-extra-2 — Spatial regularization for ambiguous pixels

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`

**Why:** Pixels at cluster boundaries that are nearly equidistant from two clusters benefit from voting with neighbors. Reduces salt-and-pepper noise at boundaries.

- [ ] **Step 1: Add spatial regularization pass**

In `packages/gbcam-extract/src/quantize.ts`, just before `// ── 4. Output: map palette indices to grayscale values ──`, insert:

```typescript
  // ── 3.75. Spatial regularization for ambiguous pixels ──
  // For each pixel where the assigned cluster's distance is within 80% of the
  // next-nearest cluster's distance, do a 3x3 majority vote among neighbors.
  // If 5+ of 8 neighbors disagree with the current label, switch to the
  // majority label.
  let spatialChanged = 0;
  const labelsCopy = new Int32Array(finalLabels);
  for (let y = 1; y < CAM_H - 1; y++) {
    for (let x = 1; x < CAM_W - 1; x++) {
      const pi = y * CAM_W + x;
      const r = flatRG[pi * 2];
      const g = flatRG[pi * 2 + 1];
      const cur = labelsCopy[pi];
      // Compute first/second nearest cluster distance ratio
      let bestD = Infinity;
      let secondD = Infinity;
      for (let ci = 0; ci < 4; ci++) {
        const dr = r - paletteCenters[ci][0];
        const dgg = g - paletteCenters[ci][1];
        const d = dr * dr + dgg * dgg;
        if (d < bestD) { secondD = bestD; bestD = d; }
        else if (d < secondD) { secondD = d; }
      }
      if (secondD === 0 || Math.sqrt(bestD / secondD) < 0.8) continue;

      // 3x3 majority vote
      const counts = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          counts[labelsCopy[(y + dy) * CAM_W + (x + dx)]]++;
        }
      }
      let majLabel = cur;
      let majCount = counts[cur];
      for (let li = 0; li < 4; li++) {
        if (counts[li] > majCount) { majCount = counts[li]; majLabel = li; }
      }
      if (majLabel !== cur && majCount >= 5) {
        finalLabels[pi] = majLabel;
        spatialChanged++;
      }
    }
  }
  if (dbg) {
    dbg.log(`[quantize] spatial regularization: changed ${spatialChanged} px`);
  }
```

- [ ] **Step 2: Run pipeline tests**

Run: `pnpm test:pipeline`
Expected: aggregate may drop on tests with isolated boundary errors. Risk: smoothing fine details.

- [ ] **Step 3: Run sample extraction and inspect**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Inspect outputs for over-smoothing (e.g. small sharp features lost).

- [ ] **Step 4: Decide and commit**

```bash
git add packages/gbcam-extract/src/quantize.ts
git commit -m "experiment(quantize): 3x3 spatial regularization for ambiguous pixels — Δ<n> aggregate <new>"
```

If aggregate regresses, tighten the ambiguity ratio (0.8 → 0.7) or vote count threshold (5 → 6). Revert if still bad.

---

## Task 11: Q-extra-3 — 2D tile k-means

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`

**Why:** The current strip ensemble captures column gradients only. 2D tiles capture row + column gradients. Implement a 4×4 tile grid; for each tile run k-means; final label is consensus among overlapping tiles.

- [ ] **Step 1: Add 2D tile ensemble**

In `packages/gbcam-extract/src/quantize.ts`, find the strip-ensemble block (`// ── 2. Strip k-means refinement ──`). After the strip ensemble (just after `const stripCounts = countLabels(finalLabels);`), insert:

```typescript
  // ── 2.6. 2D tile k-means refinement ──
  const TILE_H = Math.ceil(CAM_H / 3); // ~38
  const TILE_W = Math.ceil(CAM_W / 4); // 32
  const TILE_OVERLAP = Math.floor(TILE_H / 2);
  const tileLabels: number[][] = []; // per pixel: list of palette labels from covering tiles
  for (let i = 0; i < N; i++) tileLabels.push([]);

  for (let ty = 0; ty < CAM_H; ty += TILE_H - TILE_OVERLAP) {
    for (let tx = 0; tx < CAM_W; tx += TILE_W - Math.floor(TILE_W / 2)) {
      const y0 = ty;
      const y1 = Math.min(ty + TILE_H, CAM_H);
      const x0 = tx;
      const x1 = Math.min(tx + TILE_W, CAM_W);
      const tw = x1 - x0;
      const th = y1 - y0;
      const tn = th * tw;
      if (tn < 64) continue;
      const tileRG = new Float32Array(tn * 2);
      let tIdx = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const pi = y * CAM_W + x;
          tileRG[tIdx * 2] = flatRG[pi * 2];
          tileRG[tIdx * 2 + 1] = flatRG[pi * 2 + 1];
          tIdx++;
        }
      }
      const result = runKmeans(tileRG, tn, globalCentersPO);
      const c2p = bestClusterToPalette(result.centers, targetsRG);
      tIdx = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const pi = y * CAM_W + x;
          tileLabels[pi].push(c2p[result.labels[tIdx]]);
          tIdx++;
        }
      }
    }
  }
  // Consensus: replace finalLabels[pi] only when ALL covering tiles agree
  // and disagree with finalLabels[pi].
  let tileChanged = 0;
  for (let i = 0; i < N; i++) {
    const tl = tileLabels[i];
    if (tl.length < 2) continue;
    const first = tl[0];
    let allAgree = true;
    for (let k = 1; k < tl.length; k++) if (tl[k] !== first) { allAgree = false; break; }
    if (allAgree && finalLabels[i] !== first) {
      finalLabels[i] = first;
      tileChanged++;
    }
  }
  if (dbg) {
    dbg.log(`[quantize] 2D tile ensemble: changed ${tileChanged} px`);
  }
```

- [ ] **Step 2: Run pipeline tests**

Run: `pnpm test:pipeline`

- [ ] **Step 3: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

- [ ] **Step 4: Decide and commit**

```bash
git add packages/gbcam-extract/src/quantize.ts
git commit -m "experiment(quantize): 2D tile k-means consensus refinement — Δ<n> aggregate <new>"
```

This is high-risk because tile centers can drift just like global. Revert if aggregate regresses.

---

## Task 12: S2 — Sub-pixel column auto-detection

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts`

**Why:** Sub-pixel column boundaries are hardcoded at scale=8 to `B=[1,3) G=[3,5) R=[5,7)`. If warp alignment is off by ±1 pixel, R bleeds into G and vice versa. Auto-detect the boundaries from a representative row by finding the dark vertical valleys between sub-pixels.

- [ ] **Step 1: Add per-image sub-pixel column detection**

In `packages/gbcam-extract/src/sample.ts`, just before the `for (let by = 0; by < CAM_H; by++) {` loop, add:

```typescript
  // ── Auto-detect sub-pixel column boundaries ──
  // Default boundaries (hardcoded fallback):
  let bLo = innerStart;
  let bHi = innerStart + Math.floor(innerW / 3);
  let gLo = bHi;
  let gHi = innerStart + 2 * Math.floor(innerW / 3);
  let rLo = gHi;
  let rHi = innerEnd;

  // Try to detect: for a representative row band (say middle 4 rows of a
  // mid-block), compute mean luminance per x-offset within a block. The two
  // darkest valleys mark the inter-sub-pixel gaps.
  if (innerW >= 6) {
    const sampleBlockY = Math.floor(CAM_H / 2);
    const colSums = new Array<number>(scale).fill(0);
    let nRowsUsed = 0;
    const yMid1 = sampleBlockY * scale + Math.floor(scale / 2) - 1;
    const yMid2 = yMid1 + 2;
    for (let y = yMid1; y < yMid2; y++) {
      for (let bx = 0; bx < CAM_W; bx++) {
        const xb = bx * scale;
        for (let dx = 0; dx < scale; dx++) {
          const i = (y * input.width + xb + dx) * 4;
          // luminance approximation: G channel
          colSums[dx] += input.data[i + 1];
        }
      }
      nRowsUsed++;
    }
    if (nRowsUsed > 0) {
      // Look for two valleys in colSums between innerStart and innerEnd
      let v1 = -1, v2 = -1;
      let v1Min = Infinity, v2Min = Infinity;
      for (let dx = innerStart + 1; dx < innerEnd - 1; dx++) {
        if (colSums[dx] < colSums[dx - 1] && colSums[dx] < colSums[dx + 1]) {
          if (colSums[dx] < v1Min) {
            v2Min = v1Min; v2 = v1;
            v1Min = colSums[dx]; v1 = dx;
          } else if (colSums[dx] < v2Min) {
            v2Min = colSums[dx]; v2 = dx;
          }
        }
      }
      if (v1 > 0 && v2 > 0 && Math.abs(v1 - v2) >= 2) {
        const lower = Math.min(v1, v2);
        const upper = Math.max(v1, v2);
        bHi = lower; gLo = lower;
        gHi = upper; rLo = upper;
      }
    }
  }
```

Then later in the same function, replace the existing hardcoded `bLo`/`bHi`/`gLo`/`gHi`/`rLo`/`rHi` declarations inside the main loop (the `const bLo = innerStart;` etc. lines) with usage of the outer-scope variables (i.e. delete those `const` declarations inside the loop since the values are now provided by the auto-detect block above).

Update the debug log block to show the detected values:

```typescript
    dbg.log(
      `[sample] subpixel cols (scale=${scale}): ` +
        `B=[${bLo},${bHi}) G=[${gLo},${gHi}) R=[${rLo},${rHi}) vMargin=${vMargin}`,
    );
```

- [ ] **Step 2: Run unit tests**

Run: `pnpm test -- sample`
Expected: existing tests still pass (auto-detect should produce the same boundaries on the existing synthetic test inputs).

- [ ] **Step 3: Run pipeline tests**

Run: `pnpm test:pipeline`

- [ ] **Step 4: Run sample extraction and inspect**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`
Inspect logs for the detected sub-pixel cols on each image; they should all sit roughly at `[1,3) [3,5) [5,7)` but may vary by ±1.

- [ ] **Step 5: Decide and commit**

```bash
git add packages/gbcam-extract/src/sample.ts
git commit -m "experiment(sample): auto-detect sub-pixel column boundaries from valleys — Δ<n> aggregate <new>"
```

If the detection often fails (boundaries don't match the data well), revert and stick with hardcoded.

---

## Task 13: S3 — Vertical margin tuning

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts`

**Why:** Tiny experiment. Try `vMargin=2` instead of `vMargin=1` (default at scale=8) to skip more of the inter-row gaps.

- [ ] **Step 1: Change the default margin**

In `packages/gbcam-extract/src/sample.ts`, find:

```typescript
  const vMargin = options?.marginV ?? Math.max(1, Math.floor(scale / 5));
```

Change to:

```typescript
  const vMargin = options?.marginV ?? Math.max(2, Math.floor(scale / 4));
```

(At scale=8, this gives `vMargin = max(2, 2) = 2`.)

- [ ] **Step 2: Run pipeline tests**

Run: `pnpm test:pipeline`

- [ ] **Step 3: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

- [ ] **Step 4: Decide and commit**

```bash
git add packages/gbcam-extract/src/sample.ts
git commit -m "experiment(sample): bump default vertical margin to 2 at scale=8 — Δ<n> aggregate <new>"
```

If aggregate regresses, revert. Otherwise keep.

---

## Task 14: S4 — Vertical bleed deconvolution (escape hatch — only if Tasks 1–13 leave structured errors)

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts`

**Why:** Brighter pixels bleed light into the pixel below. If Tasks 1–13 leave a residual pattern of "WH→LG below bright pixels" or similar, model and subtract this bleed before sampling.

**Pre-check before attempting:** Look at the test-output diagnostic images (`*_diag_*.png`) for spatial structure in the errors. If errors look random, skip this task.

- [ ] **Step 1: Implement a 1D vertical deconvolution**

In `packages/gbcam-extract/src/sample.ts`, just inside the function body before the main sampling loop:

```typescript
  // ── Vertical bleed deconvolution ──
  // Model: pixel[y] receives 5% of pixel[y-1]'s value (luminance bleed).
  // Approximate inverse: subtract 5% of estimated pixel[y-1] iteratively.
  const BLEED_FRAC = 0.05;
  const bleedPasses = 1;
  // Make a working copy of the input we can mutate
  const wd = new Uint8ClampedArray(input.data);
  for (let pass = 0; pass < bleedPasses; pass++) {
    for (let y = 1; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const i = (y * input.width + x) * 4;
        const iAbove = ((y - 1) * input.width + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const corrected = wd[i + ch] - BLEED_FRAC * wd[iAbove + ch];
          wd[i + ch] = Math.max(0, Math.min(255, Math.round(corrected)));
        }
      }
    }
  }
  // Substitute the deconvolved data for sampling
  const samplingInput: GBImageData = { data: wd, width: input.width, height: input.height };
```

Then change every `input.data[...]` reference inside the sampling loop to `samplingInput.data[...]`. (Find/replace: search `input.data[`, scope to inside the main loop, replace with `samplingInput.data[`. Be careful not to touch the auto-detect block from Task 12 if you want both.)

- [ ] **Step 2: Run pipeline tests**

Run: `pnpm test:pipeline`

- [ ] **Step 3: Run sample extraction**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

- [ ] **Step 4: Decide and commit**

```bash
git add packages/gbcam-extract/src/sample.ts
git commit -m "experiment(sample): vertical bleed deconvolution (5% subtractive) — Δ<n> aggregate <new>"
```

Most likely outcome: marginal change. Revert if regress.

---

## Task 15: S5 — Luminance-first quantize (escape hatch — only if RGB quantize is structurally broken)

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`

**Why:** Reformulate quantize to use luminance only with a small color discriminator. Skip unless Tasks 1–14 leave systemic errors.

**Outline (do not implement until pre-check):** Add a luminance value per pixel: `Y = 0.6*G + 0.3*R + 0.1*B`. Run 1D k-means on Y to find 4 luminance clusters. Use R-G to disambiguate DG from LG (DG has R≈G; LG has R>G). Use B to confirm DG vs LG (DG has high B, LG has low B). The R/G/B raw values become tie-breakers, not primary discriminators.

**Pre-check:** Inspect post-Task-13 confusion matrices. If errors are concentrated in one specific cell (e.g. all `LG→WH`), this restructuring is unlikely to help. If errors are spread across cells with no clear pattern, this restructuring may help.

- [ ] **Step 1: Decide whether to attempt** — based on the post-Task-13 state. If skipping, mark this task `- [x] (skipped — see plan execution log)`.

- [ ] **Step 2: If attempting:** branch off of the current commit (`git checkout -b experiment-luminance-first`), implement, measure, and either merge back or abandon. No detailed code provided — this is a redesign and the right shape depends on what the previous tasks left behind.

---

## Task 16: X2 — Synthetic stress images (escape hatch — diagnostic only)

**Files:**
- Create: `packages/gbcam-extract/scripts/generate-synthetic-tests.ts`
- Create: `test-input/synthetic-*.jpg` (generated)
- Create: `test-input/synthetic-*-correct.png` (ground-truth)

**Why:** Programmatically generate inputs where the ground truth is known: constant-color patches, smooth gradients, single-cluster-dominant. Used to isolate which step is misbehaving for any failure mode found in earlier tasks.

**Pre-check:** Only attempt if existing 6 tests + new sample fail to give enough signal to localize a remaining failure.

- [ ] **Step 1: Decide whether to attempt** — based on whether you have an unisolated bug after Tasks 1–15.

- [ ] **Step 2: If attempting:** create `scripts/generate-synthetic-tests.ts` that produces (a) a perfectly-flat WH-only test, (b) a 50/50 BK/WH test, (c) a smooth gradient test, (d) a high-contrast checkerboard. Each is a synthetic 1280×1152 RGBA "warped" frame. Add to `test-input/` with a matching reference image. Run through the test runner; any failures localize to a specific step.

---

## Task 17: Final cleanup, summary, and aggregation

**Files:** none new; cleanup only.

- [ ] **Step 1: Run the full pipeline test one final time**

Run: `pnpm test:pipeline`
Record the final aggregate error count and per-image counts.

- [ ] **Step 2: Run the full vitest suite**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 3: Run the typechecker from repo root**

Run: `pnpm typecheck` (from repo root)
Expected: no errors.

- [ ] **Step 4: Run sample extraction one final time and inspect**

Run: `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out`

Confirm:
- `20260328_165926_gbcam_rgb.png` shows mostly black top-left, mostly yellow bottom third, no large pink blob.
- `20260313_213510_sample.png` is much less saturated than baseline.

- [ ] **Step 5: Write a short summary into the plan execution log**

For each task: noted whether it was kept, reverted, or skipped, and the per-task aggregate impact. This becomes the basis for the PR description and for any follow-up improvements.

- [ ] **Step 6: Decide on PR**

If aggregate is 0 (full pass) — open PR with the running summary as description.
If aggregate dropped meaningfully but isn't 0 — propose a follow-up plan in `docs/superpowers/plans/` and open a partial PR.
If aggregate is unchanged or regressed in net — abandon the branch, document why in the plan execution log.

(Per the user's instruction earlier in the brainstorming, do NOT commit at the end of writing this plan. The plan above will be executed in a future session.)
