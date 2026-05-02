# Warp Precision & Conditional B-Channel — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans. Read the design spec
> (`docs/superpowers/specs/2026-05-02-warp-precision-and-conditional-b-design.md`)
> first — pay particular attention to the "What we learned" section
> and the per-phase acceptance criteria.

**Spec:** `docs/superpowers/specs/2026-05-02-warp-precision-and-conditional-b-design.md`.

**Goal:** Improve warp precision (sub-pixel residuals + lens
distortion) and add a per-image B-aware quantize gate so the new
yellow-cast image benefits from B information without regressing
blue-cast test images. Drive aggregate back toward and below 76.

**Starting state:** branch `accuracy-bigger`, off `accuracy-big`,
agg 157. Phase A (white-balance) committed; Phase B (3D RGB
quantize) reverted. See
`memory/project_pipeline_accuracy_experiments.md` for the failure
modes that ruled out other approaches.

**Tech stack:** TypeScript, vitest, opencv.js (`@techstark/opencv-js`,
accessed via `getCV()` from `src/opencv.ts`), pnpm workspaces.
Commands run from `packages/gbcam-extract/` unless noted.

---

## Common Workflow

For each task:

1. **Code change.** Tightly scoped — no unrelated refactors.
2. **Unit tests** when applicable: `pnpm test`. Should be green
   except for the 6 pipeline-integration tests which assert
   `different === 0`.
3. **Pipeline test:** `pnpm test:pipeline`. Record aggregate AND
   per-image counts.
4. **Sample extraction:** `pnpm extract --dir ../../sample-pictures
   --output-dir ../../sample-pictures-out`. (No `--` after the script
   name — tsup intercepts it.)
5. **Inspect.** Open `*_warp_b_inner_border_residual.png` after Phase 1
   lands so you have a baseline visual; later phases compare against
   it. Open `*_quantize_*` and `*_gbcam_rgb.png` for new image quality.
6. **Record before deciding.** Per-image error counts, residual
   metrics from `<stem>_debug.json`, anything noteworthy. Commit
   message body.
7. **Decide and commit per phase acceptance.** See spec.

Commit subject format: `phase<N> <step>: <one-line> — Δ<n> agg <new>`.

Branch off `accuracy-bigger`. Don't commit on `accuracy-big`,
`accuracy`, or `main` directly.

---

## Phase 1 — Warp residual diagnostic (commit unconditionally)

### Task 1.1 — Add `pass2.residual` summary metric

**Files:**
- Modify: `packages/gbcam-extract/src/warp.ts`

- [ ] **Step 1.** Inside `refineWarpWithMetrics`, after computing
      `cornerErrors` and `edgeCurvatures`, compute:

  ```ts
  const maxCornerErr = Math.max(
    ...Object.values(cornerErrors).flat().map(Math.abs),
  );
  const meanEdgeCurv = (
    Math.abs(edgeCurvatures.top) +
    Math.abs(edgeCurvatures.bottom) +
    Math.abs(edgeCurvatures.left) +
    Math.abs(edgeCurvatures.right)
  ) / 4;
  ```

  Add to the `metrics` object: `residual: { maxCornerErr, meanEdgeCurv }`.

- [ ] **Step 2.** Log a one-line summary in the warp diagnostic
      block: `[warp] pass2 residual: maxCornerErr=<m> meanEdgeCurv=<m>`.

- [ ] **Step 3.** Run `pnpm test:pipeline` and `pnpm extract`. Aggregate
      should be 157 (unchanged). Capture residual values per image.

- [ ] **Step 4.** Commit:

  ```
  phase1 1.1: warp residual summary metric — Δ0 agg 157
  ```

### Task 1.2 — Add residual visual debug image

**Files:**
- Modify: `packages/gbcam-extract/src/warp.ts`

- [ ] **Step 1.** After Pass 2 warp completes (in the main `warp()`
      function, where the pass-2 warped Mat is available), build an
      RGBA debug image:
   - Start from the pass-2 warped output.
   - Overlay the detected inner-border points (red 1-px dots).
   - Overlay the expected inner-border rectangle (green 1-px lines)
     at GB pixel positions `INNER_TOP/BOT/LEFT/RIGHT`.
   - Overlay the detected corners (yellow 3-px discs).

- [ ] **Step 2.** Add via `dbg.addImage("warp_b_inner_border_residual", ...)`.

- [ ] **Step 3.** Run pipeline test and extract. Visually inspect all
      7 images to confirm the red dots cluster around the green lines
      and any deviation is visible.

- [ ] **Step 4.** Commit:

  ```
  phase1 1.2: warp inner-border residual debug image — Δ0 agg 157
  ```

**Decision:** unconditional. Diagnostic only.

---

## Phase 2 — Multi-anchor warp via dash positions

### Task 2.1 — Spike: detect dash positions on current pass-2 warp

**Why:** before redesigning the refinement, verify dashes are reliably
detectable. Pure exploration, no commit.

- [ ] **Step 1.** In `warp.ts`, add a helper `detectDashesOnWarp(warped, scale)`
      that returns dash positions for top/bottom/left/right edges. Use
      template-matching or 1D peak-finding around expected positions.

- [ ] **Step 2.** Wire it as a *temporary* diagnostic — log per-edge
      detected-vs-expected dash positions. Run pipeline test on all
      6 reference images.

- [ ] **Step 3.** Read positions per image. If detection is reliable
      (≥ 90% of dashes within 1 SP pixel of expected) for ≥ 5 of the
      6 images, proceed to 2.2. Otherwise, redesign detection or
      revisit the plan.

- [ ] **Step 4.** Discard the temporary diagnostic. Commit
      `detectDashesOnWarp` (the helper) but not the temporary log:

  ```
  phase2 2.1 spike: dash detection helper — Δ0 agg 157
  ```

### Task 2.2 — Refine warp via least-squares homography over dashes + corners

**Files:**
- Modify: `packages/gbcam-extract/src/warp.ts`

- [ ] **Step 1.** Replace the back-projection refinement (Pass 2's
      `refineWarpWithMetrics` end) with a least-squares fit:
   1. After Pass 1 warp, detect dash positions in warp space (using
      Task 2.1's helper).
   2. Map detected dash positions back to source-image coordinates
      via `M^-1`.
   3. Build src-dst point pairs: 4 corners + ~50 dashes (each at the
      expected canvas position).
   4. Reject outliers with RANSAC (`cv.findHomography` with
      `cv.RANSAC` and a ~2-pixel reprojection threshold).
   5. Re-warp with the new homography.

- [ ] **Step 2.** Update metrics: include `pass2.anchors = { corners: 4,
      dashesDetected: <n>, dashesAccepted: <n>, ransacInliers: <n> }`.

- [ ] **Step 3.** Run pipeline test. Per spec acceptance: keep if
      aggregate drops or maxCornerErr drops by > 50% on every image
      AND no individual image regresses by > 30 px.

- [ ] **Step 4.** Decision and commit:

  ```
  phase2 2.2: dash-anchored homography refinement — Δ<n> agg <new>
  ```

  If reject: revert and document in commit body, keep helper from 2.1.

---

## Phase 3 — Lens distortion correction (k1)

### Task 3.1 — Estimate per-image k1 from inner-border curvature

**Files:**
- Create: `packages/gbcam-extract/src/lens-distortion.ts`
- Modify: `packages/gbcam-extract/src/warp.ts` (call before warp)

- [ ] **Step 1.** Create `lens-distortion.ts` exporting:

  ```ts
  /** Returns undistorted source image and the chosen k1. */
  export function undistort(
    src: GBImageData,
    k1Range?: [number, number],
  ): { undistorted: GBImageData; k1: number };
  ```

  Implementation:
   1. Search k1 in `[-0.20, +0.05]` (range covers typical phone
      cameras). Step size 0.005.
   2. For each k1, apply `cv.undistort(src, K, [k1, 0, 0, 0, 0])`
      with K = `[[fx, 0, cx], [0, fy, cy], [0, 0, 1]]` where
      fx=fy=image_width and cx,cy at image centre.
   3. Run a fast warp + inner-border detection on the undistorted
      image. Score = sum of |edge_curvature| across 4 sides.
   4. Return the k1 that minimises the score.

- [ ] **Step 2.** In `warp.ts`'s entry, optionally call `undistort(input)`
      first when option `correctLens: true` (default true). Log
      chosen k1.

- [ ] **Step 3.** Run pipeline test. Acceptance: aggregate ≤ Phase 2
      result AND mean edge curvature < 0.5 image-pixels on every image.

- [ ] **Step 4.** Commit:

  ```
  phase3 3.1: per-image lens-distortion correction (k1) — Δ<n> agg <new>
  ```

### Task 3.2 — Polynomial residual correction (fallback)

(Conditional on Phase 3.1 not bringing curvature < 0.5 on every image.)

- [ ] **Step 1.** If 3.1 leaves residual curvature on some images, fit
      a per-image 2D polynomial that maps detected inner-border points
      back to expected straight lines. Apply as a remap before warping.

- [ ] **Step 2.** Acceptance: same as 3.1.

---

## Phase 4 — Conditional 3D RGB quantize

### Task 4.1 — Wire `useB` flag through the pipeline

**Files:**
- Modify: `packages/gbcam-extract/src/index.ts`
- Modify: `packages/gbcam-extract/src/quantize.ts`

- [ ] **Step 1.** In `index.ts`, after `whiteBalance()` runs, read
      `collector.data.metrics.whiteBalance.rawFrameMedian.B`. Compute
      `useB = bMed < 240`. Pass to `quantize` via options.

- [ ] **Step 2.** In `quantize.ts`, add `useB?: boolean` to options
      (default `false`). When `useB`, run 3D RGB k-means; otherwise
      keep existing 2D RG behaviour byte-for-byte.

- [ ] **Step 3.** When `useB`:
   1. Init centres = the existing 2D RG init centres extended with B
      values *derived from the data*. Compute B percentiles of pixels
      labelled by a quick 2D-RG pass: BK init.B = p10, DG init.B = p70,
      LG init.B = p30, WH init.B = p50. (Avoids the prior failure mode
      where init DG.B=255 was unreachable.)
   2. Run 3D k-means with those init centres.
   3. Use 3D Euclidean distance in `bestClusterToPalette` with a
      *data-derived* target B for DG (median raw B of pixels labelled
      DG by the 2D pass).

- [ ] **Step 4.** Add a unit test: synthetic 4-band RGB image with
      bands at `(0,0,0), (148,148,200), (255,148,148), (255,255,165)`
      (using DG.B=200, not 255, to mimic post-clip data). With
      `useB=true`, all 4 bands classify correctly.

- [ ] **Step 5.** Run pipeline. Per spec: blue-cast images
      (raw_frame_B ≥ 240) should be byte-identical to current
      output (useB=false). New image (raw_frame_B=187) should
      qualitatively improve.

- [ ] **Step 6.** Commit:

  ```
  phase4 4.1: conditional 3D RGB quantize gated on B informativeness — Δ<n> agg <new>
  ```

  Note: aggregate may not drop because test images use 2D path
  unchanged. Acceptance is qualitative on the new image plus
  no-regression on test images.

---

## Phase 5 — B-channel correction in `correct.ts` (conditional)

### Task 5.1 — Mirror R/G correction for B when `useB`

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

- [ ] **Step 1.** Add `correctB?: boolean` option (default false). When
      true, run the existing R/G machinery for B with whiteTarget=165
      (frame), darkTarget=255 (border).

- [ ] **Step 2.** Sanity check: after building the white and dark
      surfaces for B, if `min(whiteSurface) < max(darkSurface) + 5`
      anywhere in the image (the inverted-affine pathology), abort B
      correction for this image and fall back to passthrough. Log
      warning to debug.

- [ ] **Step 3.** Wire `correctB` from `index.ts` (use the same `useB`
      from Phase 4).

- [ ] **Step 4.** Run pipeline. Acceptance: aggregate doesn't worsen.
      New image should improve further (B now actually corrected
      end-to-end).

- [ ] **Step 5.** Commit:

  ```
  phase5 5.1: B-channel correction when raw B is recoverable — Δ<n> agg <new>
  ```

---

## Phase 6 — Frame-anchored colour correction (conditional)

(Only attempt if Phase 2+3 reduced warp residual to maxCornerErr ≤ 1.0
image-pixel and meanEdgeCurv ≤ 0.5 on every image.)

### Task 6.1 — Per-image affine RGB transform fit to Frame 02.png

**Files:**
- Create or extend: `packages/gbcam-extract/src/frame-correct.ts`
- Modify: `packages/gbcam-extract/src/index.ts`

- [ ] **Step 1.** Load `Frame 02.png` once at module init (palette-swap
      per AGENTS.md mapping: #FFFFFF→#FFFFA5, #A5A5A5→#FF9494,
      #525252→#9494FF, #000000→#000000).

- [ ] **Step 2.** For each warped image, build src-dst pixel pairs
      from frame region (gy < INNER_TOP || gy > INNER_BOT ||
      gx < INNER_LEFT || gx > INNER_RIGHT). Sub-sample to ~3000 pairs.

- [ ] **Step 3.** Solve `target = M·raw + b` (12 unknowns) by
      least-squares. Apply to entire warped image.

- [ ] **Step 4.** Replaces or runs alongside `correct.ts`'s per-channel
      affine surfaces. Decide based on which gives lower frame-anchor
      residual.

- [ ] **Step 5.** Add `correct_d_residual.png` debug image: heatmap of
      |target - corrected| on frame region.

- [ ] **Step 6.** Acceptance: aggregate drops by ≥ 20 from end of
      Phase 5.

---

## Phase 7 — Iterative correct↔quantize (conditional)

### Task 7.1 — One iteration of refit-with-classified-anchors

(Only if Phase 6 lands but aggregate still > 0.)

- [ ] **Step 1.** After first quantize, compute median raw RGB of
      pixels in each palette class. Add to anchor pool.

- [ ] **Step 2.** Refit M+b. Re-correct and re-quantize.

- [ ] **Step 3.** Acceptance: aggregate drops by ≥ 5 from Phase 6.

---

## Phase 8 — Hand-corrected reference for the new image (request user)

(Only when the new image's `*_gbcam_rgb.png` is recognisable.)

- [ ] **Step 1.** Before this task, post the current new-image output
      to the user along with: top-left looks BK? bottom-third WH? any
      remaining blob artifacts?

- [ ] **Step 2.** If recognisable, ask the user for a hand-corrected
      reference. Add as `test-input/20260328_165926.png` reference.

- [ ] **Step 3.** Iterate to drive its aggregate to 0 using
      pipeline-test feedback.

---

## What the executor should NOT do

- Do **not** revert the white-balance step (`white-balance.ts`).
  It's structurally correct and required by every later phase.
- Do **not** introduce a universal 3D RGB quantize. The conditional
  approach in Phase 4 is the lesson from `accuracy-big`'s revert.
- Do **not** attempt Phase 6 before Phase 2+3 confirm warp accuracy.
  Frame-anchored fits collapse on a misaligned warp.
- Do **not** skip the recording step. Per-image numbers in commit
  bodies are how phase bundles get debugged later.
- Do **not** commit on `accuracy-big`, `accuracy`, or `main` directly.

## Memory & context

- Read `memory/project_pipeline_accuracy_experiments.md` before
  starting. The 2026-05-01 update there documents the B-saturation
  insight that drives Phase 4's gating design.
- Update that memory file as Phase 2+ produce new observations
  (especially: dash-detection reliability, lens k1 ranges, whether
  the inverted-affine pathology fires anywhere).
