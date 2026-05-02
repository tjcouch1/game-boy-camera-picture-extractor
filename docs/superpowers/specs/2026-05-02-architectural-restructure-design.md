# Architectural Restructure — Warp+Sample+Correct Co-Design — Design

**Date:** 2026-05-02
**Status:** Draft
**Branch base:** `accuracy-bigger` (current HEAD agg 153)
**Supersedes (in part):** `2026-05-02-warp-precision-and-conditional-b-design.md`.
That plan's Phase 2.2 (dash-anchored warp) and Phase 3.1 (lens k1) were
*correct individually* but rejected because each broke the implicit
contract between warp output geometry and the downstream steps that
were tuned for it. This plan re-attempts those changes as a *bundle*
that adapts the downstream steps to the new geometry.

## What `accuracy-bigger` left us with

- Aggregate 153 (was 76 pre-WB, 157 post-WB, now 153 after Phase 4
  conditional 3D quantize).
- White-balance pre-step, conditional 3D RGB quantize, and a
  defensive B-correction infrastructure (currently always falls back
  to passthrough — pathology fires on every useB image).
- A robust dash-detection helper (`detectDashesOnWarp`).
- Warp residual diagnostic metric (maxCornerErr, meanEdgeCurv) and
  the inner-border residual debug image.
- The new yellow-cast image (20260328_165926, rawB ≈ 187) has its
  bottom-middle quadrilateral (output pixels (43,81)→(84,81)→(75,111)
  →(51,111)) **mis-classified as LG when it should be WH**. The user
  confirms this is a clear regression to expectation, not a cluster
  drift artifact.

## What we learned from the bug

Per-pixel sub-pixel inspection of the bottom-middle quadrilateral on
the new image:

For the camera-block at output (60, 95), screen GB (76, 111), the
warped+corrected image's column profile (rows 2–5 of the 8×8 block)
is:

```
col    new image                 thing-1 (test image, well-behaved)
 0     R=247  G=214  B=203       R=114  G=116  B=145
 1     R=207  G=170  B=178       R=109  G=115  B=140
 2     R=144  G=105  B=132       R=130  G=142  B=148   ← LCD interior begins
 3     R=125  G=100  B=124  ←gap R=164  G=181  B=162
 4     R=187  G=182  B=180       R=181  G=187  B=164   ← brightness peak
 5     R=251  G=255  B=227       R=174  G=163  B=157
 6     R=255  G=255  B=231       R=161  G=133  B=150
 7     R=255  G=246  B=217       R=146  G=104  B=138
```

**On the well-behaved test image, the brightness peak (and thus the
LCD pixel centre) sits at cols 3–5**, exactly where the sample step's
G sub-pixel window `[3, 5)` expects it. **On the new image the peak
sits at cols 5–7**, with a dark inter-pixel gap at cols 2–3. The G
sub-pixel window therefore samples the LCD gap, not the LCD G
sub-pixel — yielding G ≈ 100–180 (mean ≈ 141) instead of G ≈ 255.

After clustering, k-means sees pixels at (R=255, G=141, B=149). With
a WH cluster centre that drifted to (R=247, G=203) (because too few
pixels had high G to anchor it) and an LG cluster at (R=226, G=106),
those pixels are closer to LG than to WH:

```
distance to LG cluster (255-226, 147-106): √(29² + 41²) ≈ 50
distance to WH cluster (255-247, 147-203): √(8² + 56²) ≈ 57
```

The proximate cause is the sample step. The root cause is **warp
sub-pixel misalignment**: the new image has lens distortion (mean
edge curvature 2.58 vs ~0.6 on test images) which produces a half-
LCD-pixel cumulative offset by the time we reach the bottom of the
camera region.

## What's structurally wrong

1. **Warp** assumes a perspective transform is enough. It isn't —
   phone-camera lenses introduce barrel/pincushion distortion that
   accumulates to half-GB-pixel offsets across the camera region.

2. **Sample** assumes fixed sub-pixel column ranges per 8×8 block
   (B=[1,3), G=[3,5), R=[5,7)). This is correct *only when the GB
   pixel grid is perfectly aligned with the LCD pixel grid* — which
   the warp can't currently guarantee.

3. **Correct** uses degree-2 polynomial / Coons-patch surfaces fit
   over the frame strip and inner border. Its surfaces don't cover
   the camera interior reliably (samples extrapolate badly to bottom-
   middle), and the per-pixel-affine machinery breaks when the
   surfaces overlap (B inverted-affine pathology fires on all useB
   images).

4. **Quantize** k-means cluster centres drift on images with biased
   palette distributions (e.g., very few WH pixels). The strip
   ensemble + valley refinement help, but only within the limits set
   by what sample produces.

These four are tightly coupled. Phase-by-phase changes to *one* of
them break the implicit geometric/colorimetric contracts the others
rely on. **The plan that follows accepts this**: each phase includes
the changes to *all* affected steps so the bundle stays internally
consistent.

## What the plan rejects

- **Hard-coded threshold tweaks.** Per user direction.
- **The "test aggregate must never go up" gate.** Architectural
  changes legitimately regress test images while paying back later.
  We allow regressions of up to ~1000 pixels on a single phase, with
  the expectation that subsequent phases bring it back.
- **Single-step changes that depend on others.** Bundle them.

## Goal

Drive the new yellow-cast image to a recognisable WH-dominated bottom
third (matching the user's mental model and the actual scene content),
without regressing the test images by more than a healthy iteration
budget. Specifically:

1. The user-identified quadrilateral on the new image is ≥ 90% WH
   after the bundle lands.
2. Test aggregate stays under 200 by end of plan (allowed to spike
   above 1000 mid-phase).
3. The pipeline stops depending on accidental cancellations between
   warp residual and sample-window assumptions.

## Phase plan

Each phase is a *bundle*. Acceptance is measured at the end of the
bundle, not per file.

### Phase R1 — Adaptive sub-pixel sampling (foundation, must land first)

**Why first:** the warp/lens fixes will *change* the LCD-pixel-to-
GB-pixel alignment. If sample.ts is hard-coded to specific column
ranges, those fixes regress everything. Make sample.ts find the
sub-pixel positions per block adaptively, so it tolerates whatever
alignment the warp produces.

**Bundle:**

1. **sample.ts**: replace the fixed `B=[1,3) G=[3,5) R=[5,7)` window
   with a per-block detection. For each 8×8 block:
   - Compute a column intensity profile (mean over rows 2–5).
   - Find the brightest column (the LCD pixel centre).
   - Set R/G/B windows ±2 around the centre with the channel order
     reflecting TN LCD geometry (B left, G middle, R right) shifted
     by the detected offset.
   - Fall back to fixed windows if the profile is flat (BK pixels).
2. **sample.ts** also: weight column samples by an estimated "LCD
   active" mask (low intensity = gap, suppress).
3. Add a debug image: per-block detected sub-pixel offset heatmap.
4. **Run pipeline test.** Expected: aggregate stays roughly constant
   on test images (their alignment is already good); new image's
   bottom-middle gets correct WH samples (G ≈ 255 instead of 140).
5. **Acceptance:** test aggregate ≤ 250 (allow +100 tolerance);
   new image's quadrilateral ≥ 80% WH after this single change.

**Risk if rejected:** revert sample.ts only.

### Phase R2 — Lens distortion + dash-anchored warp (bundled)

**Why bundled:** Phase 3.1 of the prior plan (k1) reduced curvature
but regressed downstream because sample/correct were tuned to the
distorted geometry. With Phase R1 making sample alignment-tolerant,
this is no longer a regression vector. Phase 2.2 of the prior plan
(dash-anchored homography) was a separate failure mode (pulled warp
away from inner-border alignment); we mitigate by *replacing* both
passes with a single multi-anchor lens-corrected fit.

**Bundle:**

1. **lens-distortion.ts**: re-create the helper from `accuracy-bigger`
   commit b3f1a61, with the same coarse-then-fine search.
2. **warp.ts**: pre-warp lens correction with chosen k1.
3. **warp.ts**: replace pass-2 with a unified least-squares fit:
   detect dashes + inner-border points + corners on the lens-
   corrected image; fit a homography over **all** anchors (corners
   weighted higher to preserve inner-border alignment).
4. **correct.ts**: re-tune frame-strip and inner-border sample
   collection to handle the slightly different geometry post-lens-
   correction. (Surface fits should be more accurate not less; the
   risk is the sample collection's mask alignment.)
5. **Run pipeline test.** Expected: temporary aggregate spike
   (~+100–500 px) as test images re-sample slightly different LCD
   sub-pixels. New image's curvature drops below 0.5, sub-pixel
   alignment becomes consistent.
6. **Acceptance:** aggregate ≤ 600 (transient); maxCornerErr ≤ 1.0
   image-pixel and meanEdgeCurv ≤ 0.5 image-pixel on every image
   including the new one.

**Risk if rejected:** revert all three files; keep lens-distortion.ts.

### Phase R3 — Correct.ts surface refit + global B scale

**Why now:** Phase R2's improved warp puts frame anchors at integer
pixel positions. Frame-anchored colour correction (Phase 6 of the
prior plan) becomes feasible. The B inverted-affine pathology that
fires on every image today is a per-pixel-surface artifact; replace
that machinery with a global scale per channel for B.

**Bundle:**

1. **correct.ts**: add a global B scale step. Compute median border B
   and median frame B from the warped-and-WB'd image. Apply
   `correctedB = (rawB - frameB_median) * (255 - 165) / (borderB_median - frameB_median) + 165`
   uniformly. This does *not* model the gradient (which the front-
   light's B does have, but it's small). On images where
   `borderB_median - frameB_median < 5`, fall back to passthrough.
2. **correct.ts**: re-fit R and G surfaces using all 4 frame strips +
   inner-border bands at the better-aligned positions from Phase R2.
3. **Run pipeline test.** Expected: aggregate moves down (test
   images get cleaner R/G correction; new image gets actual B
   correction).
4. **Acceptance:** aggregate ≤ 400 (still transient); B correction
   actually applies on at least the new image.

**Risk if rejected:** revert correct.ts; keep R1+R2.

### Phase R4 — WH cluster anchoring + 3D quantize tuning

**Why:** With sample producing accurate G≈255 for true-WH pixels
post-R1+R2, the WH cluster should naturally sit near (255, 255). If
it still drifts (when the camera region has very few WH pixels), the
quantize step needs to anchor the cluster centres to palette targets
when drift is detected.

**Bundle:**

1. **quantize.ts**: after global k-means, detect cluster drift.
   Specifically, if a cluster centre is more than 30 RGB-units from
   its palette target AND that cluster has < 10% of pixels, snap
   the centre back to the target. Run the strip ensemble with the
   snapped centres.
2. **quantize.ts**: extend the 3D-RGB path's bestClusterToPalette
   distance to include B. With B properly corrected by Phase R3, B
   actively contributes to LG vs WH separation (LG.B = 148 vs
   WH.B = 165).
3. **Run pipeline test.** Expected: aggregate drops on the new image
   (and possibly tests too); user's quadrilateral becomes WH.
4. **Acceptance:** aggregate ≤ 300; user's quadrilateral on the new
   image is ≥ 90% WH.

**Risk if rejected:** revert quantize.ts changes; reconsider Phase
4-style data-derived targets.

### Phase R5 — Iterative correct↔quantize (Phase 7 of prior plan)

**Why:** After R3+R4, we have correct(both R/G surfaces and B global
scale) and quantize(with B and cluster anchoring). The first
quantize gives palette labels per pixel, which can serve as new
correction anchors (median raw values per palette).

**Bundle:**

1. **index.ts**: after first quantize pass, compute median raw RGB
   per palette label.
2. **index.ts**: re-run correct with these per-palette anchors as
   additional surface points.
3. Re-run sample + quantize (one iteration only).
4. **Acceptance:** aggregate ≤ 200; ideally back below 153.

**Risk if rejected:** keep R1-R4; skip R5 for this plan.

### Phase R6 — Reconciliation: re-tune R1 thresholds for test images

**Why:** The bundles above prioritise the new image (sub-pixel
adaptation, lens correction, B). Test images may have small
aggregate increases that small re-tuning recovers. This phase is
*allowed* to be a small set of threshold adjustments, narrowly
scoped, since the architectural restructure is done.

**Acceptance:** aggregate ≤ 153 (back to or below current state),
and new image's user-quadrilateral remains ≥ 90% WH.

## Acceptance criteria summary

| Phase | Aggregate budget                | New-image quadrilateral |
|-------|---------------------------------|--------------------------|
| R1    | ≤ 250 (mid)                     | ≥ 80% WH                 |
| R2    | ≤ 600 (transient)               | —                        |
| R3    | ≤ 400 (transient)               | —                        |
| R4    | ≤ 300                           | ≥ 90% WH                 |
| R5    | ≤ 200                           | ≥ 90% WH                 |
| R6    | ≤ 153 (recovery)                | ≥ 90% WH                 |

Hard-stop conditions in any phase:
- Unit test (non-pipeline) failing.
- New image becomes qualitatively unrecognisable (loses scene structure).
- Aggregate exceeds 1500 on a single image.

## What this plan explicitly is NOT

- It is NOT a series of small reverts-and-retries. Bundles land
  whole or revert whole.
- It is NOT focused on the test images. It's focused on the new
  image as the canonical "harder image"; test images come along.
- It does NOT promise monotonic aggregate improvement phase-to-
  phase. R1-R3 may all show transient regressions.

## Open questions

- How aggressive is the LCD sub-pixel detection in Phase R1? If too
  aggressive (e.g., adapts to noise on dark pixels), it could over-
  correct on test images. Mitigation: confidence threshold based on
  per-block intensity range.
- Phase R2's "corners weighted higher" for the homography: how
  much weight? Need to spike. Could be 5× or 50×.
- Phase R3 global B scale assumes frame B and border B have a clean
  gradient. They do on yellow-cast; verify on blue-cast (where the
  gradient might be near-flat after WB).

## Notes carried from prior plans

- White-balance step stays.
- Conditional 3D RGB quantize gate (rawB < 240) stays.
- Defensive B-correction infrastructure stays (with global-scale
  refit in R3).
- Dash-detection helper stays.
- Warp residual diagnostics stay.
