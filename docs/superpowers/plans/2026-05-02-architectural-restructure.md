# Architectural Restructure — Warp+Sample+Correct Co-Design — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans. Read the design spec
> (`docs/superpowers/specs/2026-05-02-architectural-restructure-design.md`)
> first. **The "What we learned from the bug" section is required
> reading** — it explains why the prior plan's individual phase
> rejects were each correct *in isolation* but together miss the
> joint solution.

**Spec:** `docs/superpowers/specs/2026-05-02-architectural-restructure-design.md`

**Goal:** Bundle warp + sample + correct + quantize changes so the
new yellow-cast image's bottom-middle quadrilateral classifies as WH
(currently ≈100% LG due to LCD-grid misalignment driving sample
windows into LCD inter-pixel gaps). Test aggregate is allowed to
spike during phases; recover by Phase R6.

**Starting state:** branch `accuracy-bigger`, agg 153. Phase 4 (3D
quantize) and Phase 5 infrastructure (B-correction defensively
inactive) landed.

**Tech stack:** TypeScript, vitest, opencv.js, pnpm workspaces.
Commands run from `packages/gbcam-extract/` unless noted.

---

## Common Workflow

For each *bundle* (= phase):

1. **Implement all parts of the bundle** before running pipeline.
2. **Unit tests** when applicable: `pnpm test`. 30 non-pipeline tests
   must always pass; the 6 pipeline-integration tests fail until
   aggregate=0 — that's expected.
3. **Pipeline test:** `pnpm test:pipeline`. Record aggregate AND
   per-image counts AND new-image quadrilateral WH%.
4. **Sample extraction:** `pnpm extract --dir ../../sample-pictures
   --output-dir ../../sample-pictures-out`. (No `--` after script
   name.)
5. **Inspect.** New image's bottom-middle quadrilateral is the
   primary qualitative gate. Look at
   `sample-pictures-out/debug/20260328_165926_quantize_b_rgb_8x.png`.
6. **Record before deciding.** Aggregate, per-image, residuals,
   anchor counts, B correction status — everything in commit body.
7. **Decide and commit per phase acceptance.** See spec.

Commit subject format: `phaseR<N> <step>: <one-line> — Δ<n> agg <new>`.

Branch off `accuracy-bigger`. Don't commit on `accuracy-big`,
`accuracy`, or `main` directly.

The user-identified quadrilateral on the new image:
output coords (43,81)→(84,81)→(75,111)→(51,111). At plan start, this
region is ≈99.7% LG. By Phase R4 it should be ≥ 90% WH.

---

## Phase R1 — Adaptive sub-pixel sampling (foundation)

### Task R1.1 — Per-block sub-pixel offset detection

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts`

- [ ] **Step 1.** In sample.ts, replace the fixed `subB`, `subG`, `subR`
      column ranges with per-block detection:
   ```ts
   function detectSubpixelOffset(block: Float32Array, scale: number): number {
     // Return 0 = grid aligned (default), or shift in cols.
     // Compute column intensity profile (mean over central rows).
     // Find the column index of the brightest run of `scale/2` cols.
     // Return its offset from the expected centre (scale/2).
   }
   ```
- [ ] **Step 2.** For each 8×8 block:
   - Detect offset (0 if profile is too flat, e.g., max-min < 30).
   - Apply: `B = [1+offset, 3+offset)`, `G = [3+offset, 5+offset)`,
     `R = [5+offset, 7+offset)`.
   - Clamp the windows to `[0, scale)`.
- [ ] **Step 3.** Add metric to debug: distribution of detected
      offsets across all blocks.
- [ ] **Step 4.** Run `pnpm test:pipeline`. Capture per-image
      aggregate AND new-image quadrilateral WH%.
- [ ] **Step 5.** Acceptance: test aggregate ≤ 250; new-image
      quadrilateral ≥ 80% WH.
- [ ] **Step 6.** Commit:
  ```
  phaseR1 R1.1: per-block sub-pixel offset detection — Δ<n> agg <new>
  ```

### Task R1.2 — Visualise sub-pixel offsets (debug aid)

**Files:**
- Modify: `packages/gbcam-extract/src/sample.ts`

- [ ] **Step 1.** Add debug image `sample_b_offset_heatmap` rendering
      detected offsets per block (colour scale -3..+3 cols).
- [ ] **Step 2.** Commit unconditionally:
  ```
  phaseR1 R1.2: sub-pixel offset heatmap debug image — Δ0 agg <unchanged>
  ```

---

## Phase R2 — Lens distortion + dash-anchored warp (bundled)

### Task R2.1 — Restore lens-distortion.ts

**Files:**
- Create: `packages/gbcam-extract/src/lens-distortion.ts`

- [ ] **Step 1.** Recreate from the rejected commit
      (b3f1a61 in git history): `makeCalibration`, `undistortBgr`.
- [ ] **Step 2.** Commit:
  ```
  phaseR2 R2.1: restore lens-distortion.ts utility — Δ0 agg <unchanged>
  ```

### Task R2.2 — Bundled warp: lens correction + multi-anchor refinement

**Files:**
- Modify: `packages/gbcam-extract/src/warp.ts`

- [ ] **Step 1.** Add `correctLens?: boolean` option (default true).
      Search k1 ∈ [-0.20, 0.05] coarse step 0.025, fine step 0.005
      around best.
- [ ] **Step 2.** Replace pass-2 back-projection with a multi-anchor
      least-squares fit: detect dashes (using `detectDashesOnWarp`) +
      inner-border points + corners. Fit homography over all anchors,
      with corner weight = 5× dash weight (corners are most reliable
      at the screen perimeter; dashes anchor the interior).
- [ ] **Step 3.** Run pipeline test. Capture aggregate, per-image,
      residuals, new-image quadrilateral WH%.
- [ ] **Step 4.** Acceptance: aggregate ≤ 600 (transient); maxCornerErr
      ≤ 1.0 image-pixel and meanEdgeCurv ≤ 0.5 image-pixel on every
      image including the new one.
- [ ] **Step 5.** Commit:
  ```
  phaseR2 R2.2: bundled warp — lens correction + multi-anchor — Δ<n> agg <new>
  ```

---

## Phase R3 — Correct.ts surface refit + global B scale

### Task R3.1 — Global B-scale correction

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

- [ ] **Step 1.** Replace the role-swapped per-pixel B affine with a
      global scale model. Compute median border B and median frame B
      (use existing `collectWhiteSamples` and `collectDarkSamples`).
      If `medianBorder - medianFrame ≥ 5`:
      ```ts
      // Map medianFrame → 165, medianBorder → 255
      const scale = (255 - 165) / (medianBorder - medianFrame);
      const offset = 165 - scale * medianFrame;
      correctedB[i] = clip(rawB[i] * scale + offset);
      ```
      Else: passthrough (per existing inverted-affine fallback).
- [ ] **Step 2.** Run pipeline test. Capture aggregate; verify B
      correction *applies* on at least the new image.
- [ ] **Step 3.** Acceptance: aggregate ≤ 400 (transient); B applied
      on the new image (not falling back to passthrough).
- [ ] **Step 4.** Commit:
  ```
  phaseR3 R3.1: global B-scale correction — Δ<n> agg <new>
  ```

### Task R3.2 — Re-fit R/G surfaces with R2 geometry

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

- [ ] **Step 1.** Verify the existing `collectWhiteSamples` and
      `collectDarkSamples` continue to operate correctly post-R2 warp
      changes. The frame strip and inner-border positions in image
      space should now be more reliable.
- [ ] **Step 2.** No code change unless a regression is observed.
- [ ] **Step 3.** Commit (only if changes were made):
  ```
  phaseR3 R3.2: re-fit R/G surfaces — Δ<n> agg <new>
  ```

---

## Phase R4 — WH cluster anchoring + 3D quantize tuning

### Task R4.1 — Drift-conditional cluster anchoring

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`

- [ ] **Step 1.** After global k-means, for each palette label:
      compute distance from cluster centre to palette target. If
      `distance > 30 RGB-units` AND `cluster size / total < 0.10`,
      snap the centre to the palette target.
- [ ] **Step 2.** When useB=true, extend cluster-to-palette distance
      to use 3D (R, G, B) — currently the 3D pass already exists in
      Phase 4 but the strip ensemble doesn't use it. Don't rebuild
      strip ensemble; just use the snapped 3D centres for the final
      label assignment.
- [ ] **Step 3.** Run pipeline test. Capture aggregate, new-image
      quadrilateral WH%.
- [ ] **Step 4.** Acceptance: aggregate ≤ 300; user's quadrilateral
      on the new image is ≥ 90% WH.
- [ ] **Step 5.** Commit:
  ```
  phaseR4 R4.1: drift-conditional cluster anchoring + 3D pass — Δ<n> agg <new>
  ```

---

## Phase R5 — Iterative correct↔quantize

### Task R5.1 — One iteration with palette-derived anchors

**Files:**
- Modify: `packages/gbcam-extract/src/index.ts`

- [ ] **Step 1.** After first quantize, compute median raw RGB per
      palette label across all camera-region pixels.
- [ ] **Step 2.** Re-run correct with these as additional anchors.
      (Need to extend correct.ts's API to accept "interior anchors".)
- [ ] **Step 3.** Re-run sample + quantize.
- [ ] **Step 4.** Acceptance: aggregate ≤ 200; new image quadrilateral
      ≥ 90% WH.
- [ ] **Step 5.** Commit:
  ```
  phaseR5 R5.1: iterative correct/quantize — Δ<n> agg <new>
  ```

---

## Phase R6 — Reconciliation

(Conditional on R1-R4 leaving test aggregate above 153.)

### Task R6.1 — Narrow threshold tuning

**Files:**
- Modify: any of the above

- [ ] **Step 1.** Identify which test images regressed from 153
      baseline. Hypothesise narrow cause (e.g., R1's offset detection
      misfiring on a specific class of pixels).
- [ ] **Step 2.** Tune the smallest possible threshold (1-2 lines).
- [ ] **Step 3.** Run pipeline test. Acceptance: aggregate ≤ 153
      AND new image quadrilateral ≥ 90% WH still.
- [ ] **Step 4.** Commit:
  ```
  phaseR6 R6.1: reconciliation — Δ<n> agg <new>
  ```

---

## What the executor should NOT do

- Do **not** revert mid-bundle. Bundles land whole or revert whole.
- Do **not** stop at Phase R1 if test aggregate spikes — that's
  expected, R2-R3 fix it.
- Do **not** treat the test aggregate as the primary metric while
  inside R1-R5. The user's quadrilateral on the new image is the
  primary metric; test aggregate is the recovery target for R6.
- Do **not** re-run the rejected Phase 2.2 (dash-anchored homography
  *replacing* both passes) unbundled. R2.2 keeps pass-1 back-
  projection and replaces pass-2 with a *unified* (dash + corner +
  inner-border) fit, weighted to preserve inner-border alignment.
- Do **not** commit on `accuracy-big`, `accuracy`, or `main` directly.

## Memory & context

- Read `memory/project_pipeline_accuracy_experiments.md` 2026-05-02
  update before starting. The lessons from rejected Phase 2.2 and
  3.1 explain why those changes individually regressed even though
  they were geometrically correct.
- Update memory file as bundles produce new observations
  (especially: which phase recovers test aggregate, where R1's
  offset detection misfires, what the new image's quadrilateral
  WH% actually reaches).
- The new image's bottom-middle quadrilateral
  (43,81)→(84,81)→(75,111)→(51,111) is the canonical bug. Check
  it after every commit.
