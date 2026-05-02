# Confidence-Driven Sampling + Frame-Anchored Correction — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans. **Read the memory file
> `~/.claude/projects/.../memory/project_pipeline_accuracy_experiments.md`
> first, especially the 2026-05-02 update.** It documents the four
> rejected experiments before this plan and the architectural
> restructure that just landed. The lessons there cap the search
> space for this plan.

**Branch base:** `accuracy-bigger` at HEAD (after the architectural
restructure; agg 2414, new image user-quadrilateral 97% WH).

**Goal:** Recover test aggregate to ≤ 200 (currently 2414, 1850 of
which is zelda-poster-3 alone) **without losing the new image fix**
(quadrilateral ≥ 90% WH). The architectural restructure
(`2026-05-03-architectural-restructure-design.md`) committed the
big-leverage changes — per-block sub-pixel sampling, lens
correction, multi-anchor warp, drift-conditional cluster anchoring.
What remains is a *confidence model* over those mechanisms so they
don't fire indiscriminately on already-aligned images.

## Starting state recap

| Image | agg | LCD offset (mean) | Notes |
|---|---|---|---|
| thing-1 | 143 | +0.23 | small offset, regression spread across content |
| thing-2 | 77 | -0.04 | well-aligned, R1 misfires on noise |
| thing-3 | 18 | +0.03 | well-aligned |
| zelda-poster-1 | 205 | +0.59 | mid-shift, deadband mostly suppressed |
| zelda-poster-2 | 121 | +0.61 | mid-shift |
| zelda-poster-3 | **1850** | +0.54 | **dominant residual: 1898 px output-WH but reference-LG** |
| 20260328_165926 | — | +0.23 (high spatial variance) | quad 97% WH ✓ |

The dominant pattern: zelda-poster-3's per-block offsets are
*genuinely close to +1* in many blocks, so the deadband doesn't
suppress them, and the R-channel reads brighter than the reference
expects, pushing borderline LG pixels into WH cluster space.

## What we learned that shapes the plan

1. **The diagnostic finding from the architectural plan:** the new
   image's "bottom mostly LG instead of WH" was caused by the
   `sample.ts` sub-pixel windows landing in the LCD inter-pixel gap
   on lens-distorted images. R1's per-block offset detection fixed
   it. Don't undo this — the new image's quad is now 97% WH.

2. **R1's centroid-based detection is content-biased.** It uses
   intensity-weighted centroid of column-mean profile per block. A
   block with a bright object on the right has its centroid pulled
   right, even when the LCD grid is centred. This explains why
   well-aligned test images (thing-2, thing-3) still produced
   mean offsets near 0 but with significant per-block variance —
   real LCD alignment was preserved on average, but content noise
   leaked into per-block decisions.

3. **R2's lens correction picks k1 ≈ -0.01 to -0.02** on every
   image. Either every image actually has the same mild barrel
   distortion, or the search is converging on a local minimum that
   isn't very informative. Worth re-spiking.

4. **Test images are NOT well-served by per-block adaptive
   sampling.** Their LCD-grid-to-GB-grid alignment is uniform across
   the image (single global offset is enough). Per-block detection
   adds noise that flips ~1900 borderline pixels on zelda-poster-3.

5. **The new image IS well-served by per-block.** Lens distortion
   creates a spatially varying LCD offset across the camera region
   (per the offset heatmap, offsets range ~-1 in top-left to ~+2 in
   bottom-right).

These two regimes need a *confidence model* deciding which to use.

## Phase plan

### Phase S1 — Per-image LCD offset confidence model

**Why first:** the test-aggregate residual is dominated by the
mismatch between per-block sampling (good for the new image) and
the test images' need for a single global offset. Until that's
resolved, no other phase can move the needle.

**Bundle:**

1. **sample.ts — global offset estimation pass.** Before the
   per-block pass, compute a *global* LCD offset for the image using
   row-aggregated column profiles:
   - For each row of GB blocks (every `scale` image rows), compute
     the column-mean grayscale profile aggregated over many blocks.
   - The aggregated profile has 8 cols (one GB pixel period), with
     a clear bright peak (LCD pixel centre) and a dark valley (LCD
     gap). Find the peak via the same intensity-weighted centroid.
   - Average the per-row peak positions across the camera region to
     get a single robust global offset.

2. **sample.ts — confidence-based switching.** Compute
   `MAD(per-block-offsets)` (median absolute deviation). If MAD <
   `0.4`, use the *global* offset uniformly (test images, well-
   aligned). If MAD ≥ `0.4`, use the per-block smoothed offsets
   (new image, lens-distorted). Threshold itself comes from the
   data: test images currently have per-block offsets clustered
   tightly around their mean; the new image has high spatial
   variance.

3. **sample.ts — keep the deadband for per-block path.** When using
   per-block, retain `|offset| > 0.75` deadband.

4. Add metric: `lcdOffset = { mode: 'global'|'perBlock', global,
   perBlockMAD, perBlockMean }`.

5. Run pipeline test. **Acceptance:** test aggregate ≤ 600;
   new image quad ≥ 95% WH; on test images that switch to global
   mode, behaviour should be approximately equivalent to pre-R1
   (slight ≤ 1-pixel offset only).

6. Commit:
   ```
   phaseS1 S1.1: per-image LCD offset confidence model — Δ<n> agg <new>
   ```

**Risk if rejected:** revert sample.ts; keep R1+R6 as-is.

### Phase S2 — Frame-anchored colour correction (re-attempt of Phase 6)

**Why now feasible:** R2's bundled warp put `maxCornerErr ≤ 1.33`
and `meanEdgeCurv ≤ 0.57` on every image (most much lower). Phase 6
of the prior `2026-05-02-warp-precision-and-conditional-b` plan was
gated on `maxCornerErr ≤ 1.0 AND meanEdgeCurv ≤ 0.5 on every image`.
We're close to that gate now — close enough to spike.

**Bundle:**

1. **Create `frame-correct.ts`.** Load `Frame 02.png` once at module
   init. Palette-swap per AGENTS.md mapping (#FFFFFF → #FFFFA5, etc.).
2. **In `index.ts`, after warp + WB but before `correct()`,** build
   src-dst pixel pairs from the frame strip (where the reference is
   known) and inner-border (also known). Sub-sample to ~3000 pairs
   per image.
3. **Solve `target = M·raw + b`** (12 unknowns) by least-squares.
   Apply to entire warped image. This produces a colour-corrected
   image with frame pixels matching `Frame 02.png` exactly.
4. **Either replace `correct()` or run alongside.** Decide based on
   per-image residual on frame anchors. The simplest first cut: run
   frame-correct *instead* of `correct()`'s R/G surface machinery,
   keep the new B handling.

5. Run pipeline test. **Acceptance:** test aggregate ≤ 400 from S1
   (transient); new image quad ≥ 90% WH.
6. Commit:
   ```
   phaseS2 S2.1: frame-anchored colour correction — Δ<n> agg <new>
   ```

**Risk if rejected:** revert; this phase has high uncertainty
because the affine M+b model assumes the front-light's effect is
linear in colour space, which may not hold across the camera region
distance.

### Phase S3 — Iterative correct↔quantize (the prior plan's R5/Phase 7)

**Why now:** with S2's frame-anchored correction, we have a much
better starting point for the colour pipeline. Adding a second
iteration where the first quantize labels feed back as additional
anchors is now a low-risk refinement.

**Bundle:**

1. **`index.ts` — second pass.** After first quantize:
   - Compute median raw RGB per palette label across camera region.
   - Build new src-dst pairs: 4 palette anchors (raw → palette
     target) + frame anchors from S2.
   - Refit M+b (12 unknowns).
   - Re-correct, re-sample, re-quantize.

2. Add metric: `iterationDelta = { agg_iter1, agg_iter2 }`.

3. Run pipeline test. **Acceptance:** test aggregate ≤ 200; new
   image quad ≥ 90% WH.
4. Commit:
   ```
   phaseS3 S3.1: iterative correct/quantize with palette anchors — Δ<n> agg <new>
   ```

**Risk:** iteration can amplify cluster drift. Mitigate by capping
the M+b update magnitude (don't let any element of M move > 0.2
between iterations).

### Phase S4 — Sample-step robustness alternative (conditional)

**Conditional on S1-S3 leaving test aggregate above 200.**

If the per-image confidence model still flips too many test image
pixels, consider replacing R1's centroid detection with a
*structural* LCD detection:

1. **Smooth the warped image vertically** before sampling (1D
   gaussian, sigma = 1 image-pixel). This blurs the LCD gap pattern
   so the sample step sees a more uniform sub-pixel area.

2. **Or: use a wider sub-pixel window with percentile aggregation.**
   E.g., R window = cols [4, 8) instead of [5, 7); take 75th
   percentile instead of trimmed mean. This is more tolerant of LCD
   gap pixels mixed in.

3. Run pipeline test. **Acceptance:** test aggregate ≤ 150; quad ≥
   90% WH. Hard target — if this doesn't recover, revisit S1's
   confidence threshold.

4. Commit:
   ```
   phaseS4 S4.1: smoothed sample-step alternative — Δ<n> agg <new>
   ```

### Phase S5 — Lens correction re-spike (conditional)

**Conditional on S1-S4 leaving zelda-poster-3 above 200 specifically.**

R2's `chooseAndApplyK1` picks k1 ≈ -0.01 to -0.02 on every image.
This may be a local-minimum problem.

1. **Add k2 to the search.** `dist = [k1, k2, 0, 0, 0]`. Search k2
   in `[-0.05, +0.05]` step `0.01`. Score same as before.
2. **Or: alternate scoring metric.** Use sum of inner-border-point
   *radial* deviations from the expected straight lines (rather than
   mean). This penalizes local bowing more.

3. Run pipeline test. **Acceptance:** zelda-poster-3 ≤ 200.

### Phase S6 — Hand-corrected reference for new image

(User decision-point. Skip unless user provides.)

If the user provides a hand-corrected `test-input/20260328_165926.png`,
add it to the test runner and iterate to drive its aggregate to 0.
Without it, the new image quality is judged qualitatively only.

## Acceptance criteria summary

| Phase | Test aggregate budget | New-image quad |
|---|---|---|
| S1 | ≤ 600 | ≥ 95% WH |
| S2 | ≤ 400 | ≥ 90% WH |
| S3 | ≤ 200 | ≥ 90% WH (target) |
| S4 (cond.) | ≤ 150 | ≥ 90% WH |
| S5 (cond.) | zelda-poster-3 ≤ 200 | ≥ 90% WH |
| S6 (cond.) | new image agg ≤ 100 | ≥ 90% WH |

Hard-stop conditions (any phase):
- New image quad drops below 80% WH.
- Aggregate exceeds 5000 (well outside transient budget).
- Unit tests fail.

## What this plan rejects

- **Reverting back to fixed sub-pixel windows.** Per-block
  adaptation is required for the new image. We're tuning *how* it
  applies, not whether.
- **Threshold-tweaking dance.** S1's confidence model is
  architectural (it picks the *mode*, not just a threshold). S4 is
  conditional and considered architectural (changes the sampling
  primitive). S5 is conditional and adds k2 (model expansion).
- **Hand-correcting the new image without user.** S6 is gated on
  user input.

## What this plan does NOT explicitly do

- It does NOT promise monotonic aggregate improvement phase-to-phase.
  S1 is the high-leverage phase; S2-S3 may show small movements.
- It does NOT touch the warp residual debug image, dash detection,
  3D quantize, or cluster anchoring — those are stable
  infrastructure.

## Memory & context to read

- `memory/project_pipeline_accuracy_experiments.md` — especially the
  2026-05-02 update on the architectural restructure.
- `docs/superpowers/specs/2026-05-02-architectural-restructure-design.md`
  — design rationale for R1/R2/R3/R4/R6.
- `docs/superpowers/plans/2026-05-02-architectural-restructure.md` —
  the plan that just executed (R1-R6).
- `docs/superpowers/specs/2026-05-02-warp-precision-and-conditional-b-design.md`
  — older context including Phase 6 (frame-anchored correction)
  which S2 re-attempts.

## Branch hygiene

- Branch off `accuracy-bigger` (current HEAD has all R1-R6 commits).
- Don't commit on `accuracy-big`, `accuracy`, or `main` directly.
- Bundles land whole or revert whole. Don't piecewise-revert mid-bundle.
- Commit subject format: `phaseS<N> <step>: <one-line> — Δ<n> agg <new>`.
- Track the new image's user-quadrilateral
  (43,81)→(84,81)→(75,111)→(51,111) WH% in every commit body —
  it's the primary acceptance metric.

## A note on philosophy (for the next agent)

The user values **architectural correctness over local accuracy
gains**. They've explicitly accepted thousands-of-pixel regressions
during architectural restructures, with the expectation that
follow-up iterations recover the loss while keeping the
architectural improvement. This plan is the second iteration after
the new image's bottom-middle bug was first diagnosed — it should
recover most of the test-aggregate budget without unwinding the
sample-step adaptation that fixed the new image.

Don't revert R1/R2/R4 to "fix" test aggregate. The right path is
the confidence model in S1.
