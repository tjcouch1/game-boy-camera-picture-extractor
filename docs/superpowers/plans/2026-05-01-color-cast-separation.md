# Color-Cast Separation — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans. **Important:** the prior plan's "every
> commit must improve aggregate" decision rule does NOT apply here.
> Tolerance for intermediate aggregate regression is **very loose**
> — Phase A and B may push aggregate into the thousands and that is
> acceptable as long as the qualitative direction is right (sample
> tints reducing, new-image output not getting worse). Read the
> design spec before starting; pay particular attention to the
> "Acceptance criteria" section.

**Spec:** `docs/superpowers/specs/2026-05-01-color-cast-separation-design.md`.

**Goal:** Decouple front-light colour cast from brightness gradient,
make B a first-class channel through to quantize, and reach 0
aggregate test errors with a recognisable output on the new
yellow-tinted sample image.

**Starting state:** branch `accuracy`, aggregate 76, 6 commits already
landed from `2026-04-28-pipeline-accuracy.md`. See
`memory/project_pipeline_accuracy_experiments.md` for what was tried
and why each failed approach failed.

**Tech stack:** TypeScript, vitest, opencv.js (`@techstark/opencv-js`,
accessed via `getCV()` from `src/opencv.ts` — never imported directly),
pnpm workspaces. Commands run from `packages/gbcam-extract/` unless
noted.

---

## Common Workflow

For each task:

1. **Code change.** Tightly scoped — no unrelated refactors.
2. **Unit tests** when applicable: `pnpm test`. Should be green
   except for the 6 pipeline-integration tests which assert
   `different === 0` and only pass at aggregate 0.
3. **Pipeline test:** `pnpm test:pipeline`. Record aggregate AND
   per-image counts.
4. **Sample extraction:** `pnpm extract --dir ../../sample-pictures
   --output-dir ../../sample-pictures-out`. (Note: do **not** use
   `pnpm extract -- --dir ...` — the `--` is incorrectly intercepted
   by tsup. The previous plan documented this incorrectly.)
5. **Inspect.** For Phase A: the `*_sample.png` debug images for all
   7 images should be progressively less tinted. For later phases:
   the `*_gbcam_rgb.png` outputs should look more correct.
6. **Record before deciding.** Even when continuing past a large
   aggregate regression, write down: per-image error counts, raw
   white-balance scales (Phase A), cluster centers (Phase B), frame
   post-correction values, anything noteworthy. The commit message
   body is the right place. This trail is what makes phase-bundle
   debugging tractable later.
7. **Decide and commit.** Phase decision rules below allow much
   larger aggregate regressions than the prior plan; the *only*
   hard stops are listed in the design spec's "Acceptance criteria"
   section.

Commit subject format: `<phase> <step>: <one-line> — <agg delta>
agg <new aggregate>`. Keep the format the same shape as the prior
plan's so `git log` reads cleanly. Even when the delta is +2000,
write it that way — the trail is the point.

---

## Phase 0 — Diagnostics groundwork (lands first)

Before any structural change, add the diagnostics this plan relies on
to judge phases. These are log-only, no behaviour change.

### Task 0.1 — Raw-frame-colour diagnostic

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

**Why:** Phase A needs to know the raw colour of the frame strip
*before* any correction. Currently we log only post-correct stats.
Add a pre-correct log line.

- [ ] **Step 1.** In `correct.ts`, immediately after `chR/chG/chB` are
      extracted from the input but before any white-surface fitting,
      compute the median raw colour of frame-strip blocks via
      `gbBlockSample(..., 50)` summed across the 4 strips. Log:

  ```
  [correct] raw frame median: R=<r> G=<g> B=<b> (target FFFFA5 = 255 255 165)
  ```

- [ ] **Step 2.** Same for the median raw colour of the inner border
      (existing `collectDarkSamples` data, take a quick median):

  ```
  [correct] raw inner-border median: R=<r> G=<g> B=<b> (target 9494FF = 148 148 255)
  ```

- [ ] **Step 3.** Run `pnpm test:pipeline` and `pnpm extract`. Verify
      the new lines appear in every per-image log. Read them off all
      7 images and write the values into the plan execution log
      (commit message body works) — this is the data Phase A's
      white-balance scales should target.

- [ ] **Step 4.** Commit (no behaviour change):

  ```
  diagnostics: log raw frame and inner-border medians per image
  ```

**Decision:** keep unconditionally — diagnostic only.

---

## Phase A — Decouple colour cast from brightness gradient

A single coherent change: a new `whiteBalance` step that runs before
`correct`. It reads the raw frame strip, computes per-channel scales
that target `(255, 255, 165)`, applies them globally, hands the
balanced image to `correct`. After this step, `correct.ts` is
unchanged structurally — its inputs are now colour-neutral.

### Task A.1 — Add `whiteBalance.ts`

**Files:**
- Create: `packages/gbcam-extract/src/white-balance.ts`
- Modify: `packages/gbcam-extract/src/index.ts` (orchestration)
- Modify: `packages/gbcam-extract/src/common.ts` if any new constant
  is needed

**Why:** New isolated step that does one job: undo the front-light's
colour cast.

- [ ] **Step 1.** Create `white-balance.ts` exporting a single
      function:

  ```ts
  export interface WhiteBalanceOptions {
    scale?: number;
    debug?: DebugCollector;
    /** Per-channel scale clamp. Default [0.4, 2.5]. */
    clamp?: [number, number];
  }

  /** Returns the input image with per-channel scales applied so the
   *  frame strip's median raw colour lands near (255, 255, 165). */
  export function whiteBalance(
    input: GBImageData,
    options?: WhiteBalanceOptions,
  ): GBImageData;
  ```

  Implementation:
    1. Reuse `collectWhiteSamples` (export it from `correct.ts` if
       not already exported) to get the frame strip pixel block
       medians, separately for R, G, B. Drop blocks below 75% of
       median per channel (existing filter).
    2. Compute `medianR`, `medianG`, `medianB`.
    3. `scaleR = clamp(255 / medianR, clamp)`,
       `scaleG = clamp(255 / medianG, clamp)`,
       `scaleB = clamp(165 / medianB, clamp)`.
    4. Multiply every pixel of the input by the per-channel scales,
       clip to `[0, 255]`, return new RGBA.
    5. Log scales and post-balance frame median if `debug`.
    6. Set metrics under key `whiteBalance` (so it shows in
       `<stem>_debug.json`):

       ```
       { rawFrameMedian: { R, G, B },
         scales: { R, G, B },
         balancedFrameMedian: { R, G, B } }
       ```

- [ ] **Step 2.** Wire into `index.ts`'s `processPicture()` between
      `warp` and `correct`. The corrected output should now be
      `correct(whiteBalance(warp(input)))`.

- [ ] **Step 3.** Add `whiteBalance` to the `intermediates` exposed
      by `processPicture()` if convenient (so the existing
      run-tests-script can dump a debug image for it). Naming the
      debug image `<stem>_white-balance.png`.

- [ ] **Step 4.** Add a unit test
      `tests/white-balance.test.ts` covering:
   - Synthetic input with frame strip raw colour `(200, 220, 130)` →
     after `whiteBalance` the frame median is within 5 of
     `(255, 255, 165)`.
   - Clamp behaviour: synthetic input with frame strip
     `(50, 250, 30)` → scales clamp to `[0.4, 2.5]`, no extreme blow-up.

- [ ] **Step 5.** Run `pnpm test`. Expect the new test passes;
      vitest pipeline tests continue to fail with `different > 0`
      (acceptable per spec).

- [ ] **Step 6.** Run `pnpm test:pipeline` and `pnpm extract`. Record:
   - aggregate test error
   - per-image scale factors (from the new metrics)
   - the new image's `*_sample.png` qualitative state — should be
     visibly less tinted

**Decision:** **Acceptance for Phase A is on QUALITY of sample.png,
not aggregate.** Aggregate is allowed to rise into the **thousands**
during Phase A — the white balance is shifting every pixel, and
downstream `correct` and `quantize` haven't been adapted yet. The
*only* reasons to NOT commit and proceed:

1. The sample tints are *worse* than baseline on any image
   (more colour saturation, not less).
2. The new image's quantize output is qualitatively worse
   (more pink-blob, more dark in regions that should be WH).
3. A unit test that doesn't depend on the pipeline-integration
   accuracy gate is failing.

If none of those apply, **commit even if aggregate jumped to 5000**.
Record the per-image scales and per-image new aggregate in the
commit message body — that's the trail Phase B needs.

Commit:

```
phaseA: white-balance pre-step undoes front-light colour cast — Δ<n> agg <new>
```

### Task A.2 — Re-tune `correct.ts` to colour-neutral inputs

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`

**Why:** After A.1, `correct.ts` sees colour-neutral data. Some of
its existing tunings (especially the `min observed span = 5` clamp,
the bright-heavy heuristic threshold of 160, the `[0.85, 1.18]` post-
correction scale clamp) were chosen for the cast-tinted regime and
may now be wrong.

- [ ] **Step 1.** Run `pnpm test:pipeline` after A.1 lands. Read the
      per-image `framePostCorrectionP85` (now post-balanced) and
      `cameraMeanR`. The bright-heavy threshold of 160 from C1 may
      now over-fire because R is no longer being bumped up by yellow
      cast. Decide threshold from data; record in plan execution log.

- [ ] **Step 2.** If the post-correction frame scale (C-extra-2,
      Task 7 in the prior plan) is now consistently a no-op (scales
      all near 1), remove it. The pre-correct white-balance has
      taken its job.

- [ ] **Step 3.** Same for the `min observed span` clamp — A.1 should
      have made channel ranges in `correct.ts` larger (because cast
      isn't compressing them), and the clamp may now be unreachable.
      Inspect, simplify, log if changed.

- [ ] **Step 4.** Run `pnpm test:pipeline` and `pnpm extract` after
      each tuning. Aggregate should be ≤ end-of-A.1 aggregate.

**Decision:** keep individual tunings if they don't regress aggregate;
revert any that do. Commit each meaningful tuning separately:

```
phaseA: <retune description> — Δ<n> agg <new>
```

---

## Phase B — Quantize in 3D RGB

After Phase A, the sample step outputs colour-neutral RGB triples
that are meaningful in all three channels. Move quantize to 3D.

### Task B.1 — 3D RGB k-means

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`
- Modify: `packages/gbcam-extract/tests/quantize.test.ts`

**Why:** Adding B as a third clustering dimension separates DG (B=255)
from BK (B=0), LG (B=148), WH (B=165). The 107-unit gap between DG
and the rest (in B alone) was the biggest unused signal in the prior
pipeline.

- [ ] **Step 1.** Update `INIT_CENTERS_RG` → `INIT_CENTERS_RGB` to 3D:

  ```ts
  const INIT_CENTERS_RGB: [number, number, number][] = [
    [80, 20, 40],     // BK
    [148, 148, 255],  // DG
    [240, 148, 148],  // LG
    [250, 250, 165],  // WH
  ];
  ```

- [ ] **Step 2.** Replace `flatRG` (Nx2) with `flatRGB` (Nx3) and
      thread through `runKmeans`, `bestClusterToPalette`, and the
      strip ensemble. `runKmeans` must accept variable dimension —
      generalise it to take a `dim` parameter.

- [ ] **Step 3.** `bestClusterToPalette`'s targets become the RGB
      palette: `[(0,0,0), (148,148,255), (255,148,148), (255,255,165)]`.
      Distances become 3D Euclidean. The permutation logic is
      unchanged.

- [ ] **Step 4.** The G-valley refinement currently runs after the
      strip ensemble on R-high pixels. It still works in principle.
      Keep it as a final 1D pass on G (it disambiguates LG from WH
      among already-classified pixels).

- [ ] **Step 5.** Update the debug `quantize_c_rg_scatter.png` image
      to a 2-projection plot or a `quantize_c_rgb_projections.png`
      that shows three 2D scatters (RG, RB, GB). Cluster centers and
      palette targets overlaid in each.

- [ ] **Step 6.** Update `tests/quantize.test.ts`:
   - Existing test ("maps pixels near palette values") should still
     pass after extending to 3D.
   - The `gValleyThreshold` tests are unchanged.
   - Add a test that creates a synthetic image with 4 bands at the
     RGB palette colours and verifies all 4 land at the right grays.

- [ ] **Step 7.** Run `pnpm test`. New test passes. Run
      `pnpm test:pipeline`.

**Decision (Phase A+B bundle):** by the end of Phase B the bundle
(A.1 + A.2 + B.1) **should** show aggregate trending toward or below
76, but is allowed to remain in the **low thousands** if the
qualitative direction is right. Specifically, accept Phase B even at
aggregate > 76 if:

- Sample tints on all 7 images are clearly cleaner than the
  Phase 0 baseline, AND
- The new image's `*_gbcam_rgb.png` shows visibly less pink/purple
  blobbing than the Phase 0 baseline.

The hard-stop conditions for Phase B are the same as Phase A. Most
likely investigative lines if Phase B is unexpectedly bad:
   1. White-balance scales clamping when they shouldn't.
   2. K-means warm-start labels not reflecting the 3D init centers
      properly (opencv.js's KMEANS_USE_INITIAL_LABELS quirk — the
      existing 2D code routes initial labels via nearest-init-center;
      preserve that pattern in 3D).
   3. The G-valley refinement misclassifying after the cluster
      assignments shifted.

Commit even if aggregate is high:

```
phaseB: quantize in 3D RGB using all four palette anchors — Δ<n> agg <new>
```

The bundle becomes a candidate for revert only if it's *both*
quantitatively much worse AND qualitatively worse than baseline.

### Task B.2 — Re-tune G-valley refinement to the 3D regime (conditional)

**Files:**
- Modify: `packages/gbcam-extract/src/quantize.ts`

**Why:** With B disambiguating DG, the G-valley refinement might be
either redundant (helpful only in 2D) or actively harmful (it
re-flips B-correctly-classified pixels). Decide from data.

- [ ] **Step 1.** Read the per-image valleyRefinement.changed metric
      from `<stem>_debug.json` after B.1. If it's near 0 on all
      images, the refinement is essentially inert — leave it alone.
      If it's >100 on any image, examine the per-image effect:
      compute per-image `aggregate_with_refinement` vs
      `aggregate_without_refinement` by toggling and re-running
      pipeline tests.

- [ ] **Step 2.** Based on data: keep, gate (run only when WH cluster
      is drifted >40 G-units from target), or remove. Commit the
      decision.

---

## Phase C — Frame as ground truth

(Conditional on Phase A+B reaching aggregate ≤ 50 and the new image's
qualitative output being recognisable. If A+B already reaches 0,
skip to final cleanup.)

### Task C.1 — Per-image affine RGB transform fit to frame pixels

**Files:**
- Modify: `packages/gbcam-extract/src/correct.ts`
- Add: `supporting-materials/Frame 02.png` is already present.
- New helper file or extend `white-balance.ts`.

**Why:** White-balance uses one scale per channel from the median
raw frame colour. The frame is *known* at every pixel, ~3000+ anchor
points per image. Fitting a full 3×3 affine RGB transform to those
anchors gives a much stronger correction.

- [ ] **Step 1.** Load `Frame 02.png` (160×144 grayscale palette-
      swapped to the design colours per AGENTS.md mapping):
   - `#FFFFFF → #FFFFA5` (frame interior)
   - `#A5A5A5 → #FF9494` (LG dashes? — see AGENTS.md)
   - `#525252 → #9494FF` (inner border)
   - `#000000 → #000000` (frame dashes)

- [ ] **Step 2.** For each warped image (post-warp, pre-correct):
   1. Identify which `Frame 02.png` pixel each warp-output pixel
      maps to (160·scale → 160 mapping; trivial nearest-neighbour).
   2. Subset to the frame region only (gy < INNER_TOP || gy >
      INNER_BOT || gx < INNER_LEFT || gx > INNER_RIGHT).
   3. For every block-or-pixel pair (raw RGB, target RGB), build a
      least-squares system: `target = M * raw + b` where M is 3×3,
      b is 3×1. 12 unknowns, ~3000 pairs.
   4. Solve via OpenCV `cv.solve` or a manual normal-equations
      solve.
   5. Apply M and b to every pixel of the warped image. This
      replaces both the white-balance step and the per-channel
      brightness correction.

- [ ] **Step 3.** Add a debug image `<stem>_correct_d_residual.png`
      that shows |target - corrected| heatmap on the frame region.
      Should be small everywhere.

- [ ] **Step 4.** Run pipeline and extract. Aggregate should drop
      substantially.

**Decision:** keep if aggregate drops by ≥ 20 from end-of-Phase-B
state. If marginal, gate Phase C behind a config flag and decide
later. Commit:

```
phaseC: per-image affine RGB transform fit to Frame 02.png anchors — Δ<n> agg <new>
```

---

## Phase D — Iterative correct ↔ quantize

(Conditional on Phase C landing and aggregate still > 0.)

### Task D.1 — One-pass iteration

**Files:**
- Modify: `packages/gbcam-extract/src/index.ts`
- Modify: `packages/gbcam-extract/src/correct.ts`

**Why:** After Phase C correction + Phase B quantize, the camera-area
classifications give us 4 more colour anchors per image (median raw
RGB of pixels classified as each palette colour). Refit the colour
transform with those anchors, re-correct, re-quantize.

- [ ] **Step 1.** After the first quantize, compute median raw RGB
      of pixels in each palette class (use the *warp output* values,
      not the corrected ones). Add these as anchors to the M+b fit
      from C.1. Refit.

- [ ] **Step 2.** Re-correct, re-quantize. Compare new aggregate
      vs first-pass aggregate.

- [ ] **Step 3.** If second pass improves, expose `iterativePasses`
      as an option to `processPicture()` defaulting to 1. Otherwise
      revert and document.

**Decision:** keep if aggregate drops by ≥ 5 from Phase C. Otherwise
revert.

---

## Final cleanup

### Task F.1 — Remove obsoleted prior-plan code

**Files:** various.

After Phase A or C, several prior-plan changes likely became dead
code:

- C-extra-2 (post-correction frame scale, Task 7) — likely a no-op
  after A.1. Remove if so.
- C1 (bright-heavy refinement skip, Task 8) — refinement was net
  harmful in the cast-tinted regime; in the colour-neutral regime
  the calculation may differ. Re-evaluate.
- The drift diagnostics (X1) are still useful — keep.

- [ ] **Step 1.** For each prior-plan change, determine if it now no-ops or
      regresses. Remove or simplify.

- [ ] **Step 2.** Run `pnpm test`, `pnpm test:pipeline`, `pnpm
      typecheck` from repo root. All clean.

- [ ] **Step 3.** Decide PR shape. The phases are large enough that
      one PR per phase is appropriate (or two PRs: Phase A+B
      together, Phase C+D together). Avoid the prior plan's "one PR
      with 6 commits" — these changes are too intertwined and a
      reviewer needs to see the bundles.

### Task F.2 — Hand-corrected reference for `20260328_165926` (deferred)

If, after Phase C or D, the new image's output is recognisable
enough that the user can hand-correct it, request that. Add the
hand-corrected reference as a 7th test image and continue iterating
to drive its aggregate to 0.

---

## What the executor should NOT do

- Do **not** apply the prior plan's "every commit must reduce
  aggregate" rule. Phase A is expected to regress, possibly into the
  thousands. That is by design — large structural changes can't reach
  a clean end state without going through a broken-looking middle.
- Do **not** revert white-balance (A.1) if test aggregate rises but
  the sample image is qualitatively cleaner. The phase decision rule
  is qualitative-first for A.
- Do **not** revert Phase B if aggregate is high but the new image
  is qualitatively better. Same reasoning.
- Do **not** treat the previous plan's escape hatches (sub-pixel
  auto-detect, vertical bleed deconvolution, luminance-first
  quantize, synthetic stress) as next steps after this plan. They
  were ruled out by the architectural redesign here.
- Do **not** start Phase C before Phase A+B are stable and committed.
- Do **not** commit on the `accuracy` branch directly. Branch off
  `accuracy` for this plan; the `accuracy` branch's existing 6
  commits are the starting point.
- Do **not** skip the recording step. Even if aggregate is +3000,
  the per-image counts and the white-balance scales need to be in
  the commit body. They are how the bundle gets debugged later if
  it doesn't converge.

## Memory & context

- Read `memory/project_pipeline_accuracy_experiments.md` before
  starting. It lists the failed approaches and why they failed —
  several of those failures inform decisions in this plan (e.g.
  the B-channel bundle's failure mode is what makes A.1's clamp
  range `[0.4, 2.5]` important).
- Update that memory file as Phase A and beyond produce new
  observations.
