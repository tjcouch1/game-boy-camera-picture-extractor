# TypeScript Pipeline Accuracy — Design Spec

**Date:** 2026-04-09
**Branch:** web-app-design

## Problem

The Python pipeline achieves ~99.21% pixel accuracy against reference images. The TypeScript pipeline achieves only ~62.65% — a ~36.5 percentage point gap. The root cause is algorithmic divergence introduced during porting, not a fundamental limitation of the TypeScript implementation.

## Approach

Fix known divergences in severity order (Phase A), verifying with the test suite after each fix. Then build an interleaving diagnostic script (Phase B) to isolate any remaining step-level differences for fine-tuning.

Each fix mirrors the Python original as closely as possible — same logic, same magic numbers, same loop structure — to make future diffs easy to spot.

---

## Phase A: Fix Known Divergences

### Fix 1 (Critical) — `sample.ts`: Subpixel-aware colour output

**Problem:** Python's `gbcam_sample.py` outputs a 128×112 colour (RGB) PNG where R, G, B channels are sampled from different LCD sub-pixel column offsets within each block. TypeScript's `sample.ts` treats the input as grayscale and outputs a single brightness value per pixel, with all channels set equal. The quantize step clusters in RG colour space — without real colour data, it cannot discriminate the four palette colours correctly.

**Fix:**
- Accept colour (RGB) input in `sample.ts`
- For each block at the configured scale (default scale=8), sample per-channel means from the interior using the same column offset formula as Python (`inner_start=1, inner_end=scale-1`, B/G/R each get 2 columns):
  - B channel: columns 1–2
  - G channel: columns 3–4
  - R channel: columns 5–6
  - Vertical margins: rows 1–(scale-2) (skip top/bottom 1 row)
- Output a 128×112 colour (RGB) PNG with per-channel mean values

**Expected impact:** Large accuracy jump — this is the dominant divergence.

---

### Fix 2 (Medium) — `correct.ts`: `uniformFilter1d` boundary mode

**Problem:** Python uses `scipy.ndimage.uniform_filter1d(mode='nearest')` which extends the signal with the nearest edge value. TypeScript's `uniformFilter1d()` uses reflection at boundaries. This affects dark surface calibration along the borders of the filmstrip frame strips.

**Fix:** Change `uniformFilter1d` to use nearest-neighbour boundary padding instead of reflection.

**Expected impact:** Modest improvement in border/edge pixel accuracy.

---

### Fix 3 (Medium) — `quantize.ts`: k-means initialization

**Problem:** Python uses `sklearn.KMeans(init=centers, n_init=1)` which starts EM directly from the provided warm centres. TypeScript assigns initial labels by nearest-neighbour and calls `cv.kmeans()` with `KMEANS_USE_INITIAL_LABELS`. These may converge to different local optima.

**Fix:** Align TypeScript's initialization to match Python's warm-start behaviour as closely as possible. Verify cluster centre convergence matches Python on a test image.

**Expected impact:** Minor improvement in ambiguous palette assignments.

---

### Verification

After each fix, run `pnpm test:pipeline` and compare `test-output/test-summary.log` against `test-output-py/test-summary.log`. Phase A is complete when accuracy has meaningfully improved and all three known divergences are resolved. (No specific percentage target — Phase B handles the remaining gap.)

---

## Phase B: Interleaving Diagnostic Script

**Purpose:** Isolate individual TypeScript pipeline steps by running a mixed pipeline — some steps from Python, some from TypeScript — on a single test image.

**Location:** `packages/gbcam-extract/scripts/interleave-test.ts`

**Usage:**
```
pnpm interleave -- --image zelda-poster-1 --py warp,correct --ts crop,sample,quantize
```

**Behaviour:**
- Accepts `--image` (test image name), `--py` (comma-separated steps to run in Python), `--ts` (comma-separated steps to run in TypeScript)
- Runs steps in pipeline order: warp → correct → crop → sample → quantize
- Each step reads the previous step's output from a temp directory and writes its own output there
- Python steps are invoked via `child_process` calling the existing Python scripts in `packages/gbcam-extract-py/`, using the `.venv` at `packages/gbcam-extract-py/.venv`
- TypeScript steps are invoked directly
- Final output is compared pixel-by-pixel against the reference image in `test-input/`
- Reports per-colour accuracy and a confusion matrix (matching the format of `test-summary.log`)

**Use case:** After Phase A, if accuracy is still below Python, run with all steps in Python except one TypeScript step at a time to find which step still diverges.

---

## Files Affected

| File | Change |
|------|--------|
| `packages/gbcam-extract/src/sample.ts` | Subpixel-aware per-channel sampling, colour output |
| `packages/gbcam-extract/src/correct.ts` | `uniformFilter1d` nearest boundary mode |
| `packages/gbcam-extract/src/quantize.ts` | k-means initialization alignment |
| `packages/gbcam-extract/scripts/interleave-test.ts` | New diagnostic script |
