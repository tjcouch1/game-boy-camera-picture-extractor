# Continuation plan: fix warp residual bow + improve pipeline

> **For agentic workers:** Read this file end-to-end before touching code.
> The "User feedback (round 4)" section has the canonical ground-truth
> measurements. The user has explicitly said visual feedback is rare and
> expensive — DO NOT lose these specific numbers. Self-verify with the
> dash-distance harness (`scripts/dash-distance-from-edge.ts`).

**Branch state:**

- `plan-a-detector-bias` HEAD: `e942c1d` — current working state.
- `warp-precision-restart-checkpoint`: `5c51658` — earlier checkpoint
  before the BORDER_POINT_WEIGHT and dashCount-tracking commits.
- `warp-poly-checkpoint`: `272c563` — original baseline (before any of
  this session's work).
- `accuracy-bigger`: original mainline development branch.

**Aggregate test (`pnpm test:pipeline`)**: 2579 px diff vs the 153-px
historical low. Per-image: thing-1 137, thing-2 8, thing-3 10,
zelda-poster-1 182, zelda-poster-2 218, **zelda-poster-3 2024**.
zelda-poster-3 is the dominant 78% of remaining error and is a quantize
G-valley issue, not a warp issue (see "Pipeline ideas" below).

**Aggregate dash-distance harness** (gray channel, threshold-crossing
on outer BK→{adjacent feature} transition; matches user perception):

| side | baseline (272c563) | current (fac2d6c) |
|---|---|---|
| top    | -1.28 | +0.21 |
| bottom | +0.61 | +0.07 |
| left   | -1.26 | -0.11 |
| right  | +1.14 | +0.33 |

Mean abs bias avg: 1.105 → 0.18 (84% reduction). Aggregate test 2857 →
2579 (9.7% reduction).

---

## User feedback (round 4) — THIS IS THE NEW GROUND TRUTH

Read the user's exact words. Do not paraphrase. Do not lose these.

> **zelda-poster-3 + 20260328_165926** "look like their borders and
> dashes are in almost exactly the same spot, which is great. But the
> bottom right dashes are still too far left.
>
> - On zelda-poster-3, they still need to move right about 3-4 pixels.
> - On 20260328_165926, they still need to move right about 2 pixels.
>
> They bow out to almost exactly the right x position in the middle,
> then they bow back in to about the same distance from the right side
> at the top.
>
> - The top dashes could go up another pixel or two.
> - The left side dashes are just about perfect.
> - The bottom dashes could probably move up by a pixel (note that the
>   bottom dashes' bottom edge looks different than the others; it
>   seems the WH below them is bleeding up into their space a bit, so
>   the bottom edge should be a bit further from the edge than the
>   other sides should be)."

**Decoding:**

1. **Right-side dashes still bow IN at TOP and BOTTOM corners**, but
   are correct in the middle. = barrel-like distortion the polynomial
   can't fully fit. Specifically:
   - 165926 right side: middle ≈ 0 px bias, top/bottom ≈ +2 px.
   - zelda-poster-3 right side: middle ≈ 0 px bias, top/bottom ≈ +3-4 px.
2. **Top dashes need to move outward (= up) 1-2 px.** The current
   harness `top` aggregate bias is +0.21; user says we need an
   additional 1-2 px. Suggests the harness's smoothing-induced offset
   estimate is off by ~1-2 px — the user perceives a TIGHTER threshold-
   crossing position than the harness measures.
3. **Bottom dashes need to move up ~1 px**, BUT the bottom edge has
   asymmetric bleed: WH below the BK body bleeds UP into the dash
   region, making the BK body look smaller from below. The visible
   bottom-edge therefore lands FURTHER from the screen edge than other
   sides' visible outer edges. **The harness's local-baseline approach
   might be sampling baseline TOO CLOSE to the BK body for bottom
   dashes**, picking up bled WH and producing a too-low threshold.
4. **Left side is perfect.** Don't regress it.

The current harness reports for these images:

```
zelda-poster-3:  top +0.13, bot +0.15, left -0.25, right +0.48
20260328_165926: top +0.17, bot +0.10, left -0.04, right +0.56
```

Per-dash detail for 165926 right side (verbose harness):

```
right Y=120  (top):    bias +0.75
right Y=196:           bias +0.89
right Y=280:           bias +1.10
right Y=360:           bias +1.16
right Y=440:           bias +1.25
right Y=516:           bias +1.26  ← peak
right Y=600:           bias +1.34
right Y=680:           bias +1.30
right Y=760:           bias +1.38
right Y=836:           bias +1.30
right Y=920:           bias +1.27
right Y=1000 (bottom): bias +1.28
```

Hmm — my harness reports the bias is RELATIVELY UNIFORM (0.75 to 1.38
across Y), with the largest bias near the middle/bottom. The USER
says the bias is SMALLEST in the middle and biggest at top/bottom.
**The harness disagrees with the user's perception on the SHAPE of
the right-side bias.** This is important: the harness's threshold-
crossing detection may not match user perception in some way.

Possible reasons:
- The harness uses a local-baseline sampled at fixed canonical offset.
  The baseline value differs between top/middle/bottom of the right
  side because the WH frame's brightness varies with front-light.
- The user is judging by EYE which integrates more context. The eye
  may align to the visible BK→WH transition's *steepest gradient*
  rather than the threshold crossing.

The harness's measurement is NOT GROUND TRUTH on its own. The user's
measurements are. The harness is a fast proxy that may differ from
user perception by a constant or near-constant offset per side.

---

## Diagnostic data captured this session

Run on 12 images (6 test-output, 6 sample-pictures-out) at HEAD
`fac2d6c`. Numbers are mean per-side biases in image-px (pos = visible
edge shifted INWARD on left/right; pos = inward=DOWN for top, inward=UP
for bottom).

**Aggregate over 12 images:**

```
side    | meanBias | meanAbsBias | maxAbsBias
top     | +0.21    | 0.21        | 0.67
bottom  | +0.07    | 0.07        | 0.54
left    | -0.11    | 0.13        | 0.94
right   | +0.33    | 0.33        | 1.43
```

**Per-image (165926 worst case for right):**

```
20260328_165926: top +0.17, bot +0.10, left -0.04, right +0.56 (max 1.28)
20260313_213443: top +0.07, bot +0.06, left -0.05, right +0.21 (max 0.60)
20260313_213510: top +0.24, bot +0.04, left +0.05, right +0.22 (max 0.77)
zelda-poster-3:  top +0.13, bot +0.15, left -0.25, right +0.48 (max 1.26)
thing-1:         top +0.12, bot +0.10, left -0.23, right +0.34 (max 1.04)
thing-2:         top +0.10, bot +0.13, left -0.08, right +0.15 (max 0.55)
```

**165926 lens k1**: -0.02 (search range -0.30..+0.10). Scoring uses
dash residual sum + 100×quadScore.

**165926 quadScore**: 0.1227 (below the 0.15 warning threshold).

**165926 source corners**: (0, 23), (1399, 23), (1389, 1274), (7, 1281).
The screen fills the photo frame — there's almost no bezel for the
brightness threshold to bite into.

---

## What this session tried, in order

| commit | summary | aggregate test | net effect |
|---|---|---|---|
| `ec3e684` | dash-distance-from-edge harness (no pipeline change) | 2857 | 0 |
| `cfb9d4c` | smooth dash short-axis profile by ~2 LCD periods | 3286 | -429 (re-tuned later) |
| `740989f` | iterate polynomial post-correction up to 3 times | 3093 | +193 |
| `cdaae4c` | argmin-of-smoothed-profile for SHORT axis | 2743 | +350 |
| `0e43625` | average bbox-centroid + argmin (short axis) | 2718 | +25 |
| `21570dc` | **fit pass-2/poly to dash OUTER EDGE not centroid** | 2446 | +272 (BIG) |
| `0d33f2b` | relax polynomial maxFitError 5→10 px | 2691 | -245 (allows polynomial to run on harder images) |
| `5c51658` | match outer-edge smoothing kernel to harness exactly | 2718 | -27 |
| `e7b57e9` | outer-edge uses raw gray; later commit `e942c1d` moved viz green crosshair to canonical OUTER edge | 2655 | +63 |
| `512dd37` | enable inner-border in pass-2 RANSAC at weight 1 | 2579 | +76 |
| `b7d07bb` | (no source change; doc/cleanup commit) | 2579 | 0 |
| `fac2d6c` | track dashCount for poly sanity (no behaviour change) | 2579 | 0 |

### Reverted experiments (DO NOT REDO without reading why)

- **TPS warp** — not implemented; opencv.js doesn't expose
  `cv.ThinPlateSplineShapeTransformer`. Would need hand-implementation.
  This is the most-likely path to fix the bow-shaped right-side
  residual that a degree-3 polynomial can't model.
- **Inner-border points (36) in polynomial** — caused
  per-image regressions by adding noisy control points; aggregate test
  jumped to 24,000+. The polynomial then over-fits the noisy points.
  Outlier rejection wasn't enough.
- **4 inner-border CORNERS in polynomial** (legacy detector) — minor
  regression (2579 → 2691).
- **Threshold-crossing inner-border in pass-2 RANSAC** — regressed
  vs legacy R-B+128 detector. The legacy detector is more stable for
  pass-2's RANSAC inlier selection.
- **BORDER_POINT_WEIGHT=2** — over-constrained the homography against
  the dashes' detected positions. Regressed.
- **Disabling the bright-heavy refinement skip in correct.ts** —
  zelda-poster-1 improved (-35 px) but zelda-poster-2 regressed (+23)
  and the rest mixed. Net regression.
- **G-valley histogram robustness check** (= require valley < 0.5 ×
  smaller boundary peak) — fixed zelda-poster-3 by 400 px but regressed
  thing-1/zp-1/zp-2 by ~300 px each. Net regression.
- **G-valley = midpoint always** — fixed zelda-poster-3 by 410 px,
  regressed every other image. Net 750 px worse.
- **Per-side bias calibration** (= shift canonical positions by
  observed harness aggregate bias) — discussed but not committed because
  the user-feedback round-4 numbers reveal the harness disagrees with
  user perception, so calibrating to the harness wouldn't match user
  perception either.

---

## The actionable problem statement

After the changes in this session, the dash detector and
pass-2/polynomial pipeline target the user-perceived OUTER edge of each
dash (= threshold-crossing in smoothed grayscale, baseline sampled at
1.5 LCD-px outward of canonical centroid). Dashes converge well; the
harness reads sub-0.5-px aggregate per-side bias.

**What still doesn't work:**

1. **Right-side dash residual has a "bow" shape** — small in the middle
   of the right edge, larger at top-right and bottom-right corners.
   This is non-homographic distortion the degree-3 polynomial can't fit:
   - At 165926: 2 px residual at corners.
   - At zelda-poster-3: 3-4 px residual at corners.
   - Other images: ~1 px corner residual.
2. **Harness disagrees with user perception on the right-side bias
   shape** — harness reports relatively uniform residual along the
   right side; user reports inverted-U shape (= zero in middle,
   max at corners). The harness's threshold-crossing logic has a
   per-image SMOOTHING-INDUCED OFFSET that varies along the side
   (= front-light brightness gradient changes the smoothed profile's
   shape), which masks the true bow shape.
3. **Top/bottom shows small residual** that the user reports needs
   1-2 px additional outward shift.
4. **Bottom dashes specifically have an asymmetric "WH bleed"**
   rendering issue not fully captured by the threshold-crossing
   approach — the visible bottom edge of bottom dashes lands further
   from the screen edge than other sides' visible edges, due to
   adjacent-pixel bleed from below.

---

## Plans to fix the warp (ordered by likely impact / cost)

### Plan A: Implement TPS (thin-plate spline) warp post-correction

**The bow-shaped residual is the canonical case for TPS over polynomial.**
The polynomial has rigid global structure (= one degree-3 fit shapes
the whole warp). TPS is a SCATTERED INTERPOLATION — each control point
has more local influence and less far-field influence, so the warp can
fit a "U-shape" residual on one side without distorting the others.

Steps:
1. Implement TPS in TypeScript (= opencv.js doesn't expose it).
   The math is well-defined:
   - Build kernel matrix K[i][j] = U(|Pi - Pj|) where U(r) = r²·log(r²).
   - Build augmented matrix L = [[K, P], [P^T, 0]] where P[i] = [1, x_i, y_i].
   - Solve `L · [w; a] = [Y; 0]` for both X and Y axes.
   - Evaluate TPS at each output pixel: `f(p) = a₀ + a₁·x + a₂·y + Σ wᵢ·U(|p - Pᵢ|)`.
   - Use cv.remap with the resulting maps.
2. Replace the polynomial post-correction with TPS-based remap.
3. Verify with the harness — sub-0.5 px on all sides on all images.

**Caveats:**
- TPS coefficient solve is `O(N³)` for N control points. For 54 dashes +
  8 anchors = 62 points, that's 62³ = 238k ops. Fast.
- Evaluation is `O(N · M)` for M output pixels. M = 1280·1152 = 1.5M,
  so total ~93M ops per axis. Should run in seconds.
- TPS is more flexible than polynomial → easier to over-fit. Use
  the same `dashCount` sanity check (= drop the TPS if max-fit error >
  some threshold on dashes).

### Plan B: Per-side bow correction in the polynomial

If TPS is too risky, add a **second-order radial/local correction**
specifically targeting the bow shape:

1. After polynomial, fit a 1D quadratic to the RIGHT-side dash residuals
   as a function of Y. Apply a small X-offset along the right edge that
   compensates the bow.
2. Same for top/bottom/left if they bow.

This is bespoke — only useful if the bow shape is consistent across
images. Currently the harness suggests the bow IS consistent in
direction (right-side residual peaks at top/bottom corners) but the
magnitude varies per image. A 1D quadratic per-side would adapt to
the image's specific bow magnitude.

### Plan C: Improve the in-pipeline outer-edge detector to match user perception

Current detector: smoothed grayscale + threshold at midpoint of (BK
floor, baseline-sampled-at-1.5-LCD-out-from-canonical).

The user reports the right-side residual is SHAPED like an inverted U.
The harness reports it's roughly UNIFORM. The discrepancy must come
from how each measures.

Possible improvements:
1. Sample baseline at a per-Y-row offset (not fixed 1.5 LCD-px from
   canonical) — at the corners, the WH frame near the corner may be
   different from the middle, and a fixed-offset sample might pick up
   different absolute brightness.
2. Use multiple baseline samples and the median.
3. Use a different threshold metric (= e.g., 70% of the way from floor
   to baseline) to match where the eye places the edge.
4. Try the **bottom** side specifically with a larger baseline offset
   to account for the user-noted "WH below dashes bleeding up". Maybe
   sample baseline at 2.5 LCD-px outward instead of 1.5.

### Plan D: Improve the lens search

For 165926-class images with visible barrel, the lens search converges
on k1 = -0.02. The user's right-side residual at 165926 is ~2 px which
suggests the actual barrel needs more correction.

1. Try a more sensitive score function — currently dash residual sum +
   100×quadScore. Try INNER-BORDER residual sum (= scoreUndistortedFrame
   could detect inner-border points and score on those, since they're
   closer to the centre and more sensitive to barrel).
2. Or: re-run the lens search AFTER pass-2 (= use the polynomial-
   corrected dashes as the score, since polynomial absorbs k1 errors).

---

## Plans to improve the rest of the pipeline (after warp is fixed)

> ⚠ The user said:
> "Note that your goal is not to increase accuracy immediately; you may
> decrease very significantly at first. Your goal is to make the
> pipeline generically very accurate and robust; do not just make
> little bespoke tweaks just for the sake of fixing the test results."

Aggregate accuracy may DECREASE during this work. Don't optimise
against test_output diff — optimise against generic robustness.

### Pipeline robustness ideas

#### 1. correct.ts — brightness gradient correction

- The "bright-heavy heuristic" skips iterative refinement when
  cameraMeanR > 160. This was a workaround for noisy interior-DG
  detection on bright-camera-content images. Now that the warp is more
  accurate, the interior-DG sampling positions are more reliable;
  re-investigate whether the heuristic is still needed.
- The per-channel correction targets specific colors (R=255 G=255 B=165
  for white frame). Verify these targets still match real-photo
  rendering on the new warp.
- The bright-heavy heuristic threshold of 160 was tuned to old warp.
  Try 170 or 180 as cutoffs.

#### 2. sample.ts — per-pixel sub-pixel-aware sampling

- The detected LCD-pixel-centre offset map varies across the image
  (range -1.59 to +2.0 on 165926). This adapts sub-pixel windows per-
  block. Already robust.
- Verify the V-margin (currently `floor(scale/4) = 2`) is still
  appropriate. Maybe try V-margin = 1 to use more pixels per block,
  or V-margin = 3 to be more conservative.

#### 3. quantize.ts — k-means + strip ensemble + G-valley refinement

This is the dominant source of remaining error (= zelda-poster-3 alone
contributes 2024 of 2579 total).

- The G-valley histogram search picks a too-low threshold (203) for
  zelda-poster-3 because the G-distribution has a noisy valley near
  the LG cluster. Several fix attempts in this session all regressed
  other images.
- **Better approach**: compute the threshold via 2D RG-plane
  Mahalanobis distance from each cluster's full covariance matrix
  (not just centre-Euclidean). Pixels with R near 228 and G near 215
  (= midway between LG and WH centres) would be assigned per the
  cluster shapes' overlap, not just per-axis distance.
- Or: use a **probabilistic** classifier (= 2-Gaussian mixture,
  threshold at intersection point) instead of histogram search.
- Or: use **percentile-based** thresholds — for the high-R subgroup,
  threshold at the (LG_size / total_high_R)th percentile of G.

#### 4. crop.ts — should be unchanged

Just extracts pixels (16, 16) to (16+128, 16+112) at scale. Robust.

#### 5. End-to-end iteration

After making any of the above changes, RE-RUN the test suite and
verify that:
- No test image regresses by more than 50 px diff.
- At least one test image improves by 100+ px (for the change to be
  worth it).
- The dash-distance harness aggregate stays within 0.4 px on all sides.

---

## Useful commands

```bash
# Run pipeline tests (writes debug output to test-output/, ~3 min).
cd packages/gbcam-extract && pnpm test:pipeline

# Aggregate dash-distance harness over all 12 images.
cd packages/gbcam-extract && node --experimental-strip-types \
  scripts/dash-distance-from-edge.ts \
  --dir ../../test-output --dir ../../sample-pictures-out

# Verbose per-dash output for one image.
cd packages/gbcam-extract && node --experimental-strip-types \
  scripts/dash-distance-from-edge.ts --verbose \
  ../../sample-pictures-out/debug/20260328_165926_warp.png

# Quick metrics readout for any test image.
cd <repo-root> && node -e '
  const j = JSON.parse(require("fs").readFileSync(
    "sample-pictures-out/debug/20260328_165926_debug.json","utf8"));
  console.log("lens:", JSON.stringify(j.metrics.warp.lensDistortion));
  console.log("quadScore:", j.metrics.warp.quadScore);
  console.log("polyCorrection:", JSON.stringify(j.metrics.warp.polyCorrection));
  const all = j.metrics.warp.pass2.dashResiduals.all;
  for (const s of ["top","bottom","left","right"]) {
    const items = all.filter(d => d.side === s);
    const dxs = items.map(d => d.err[0]);
    const dys = items.map(d => d.err[1]);
    console.log(s, "meanDx=", (dxs.reduce((a,b)=>a+b,0)/dxs.length).toFixed(2),
                   "meanDy=", (dys.reduce((a,b)=>a+b,0)/dys.length).toFixed(2));
  }
'
```

---

## Detection-debug visualization conventions

The `_warp_c_detection_debug.png` overlay draws three markers per dash:

- **Cyan search box** — drawn around the BK body CENTROID (= the
  actual search area used by the dash detector, ±longHalf × ±shortHalf
  around the canonical centroid). The search box's CENTRE is the
  centroid; the GREEN CROSSHAIR sits at the OUTER edge (= one GB-pixel
  away on the side toward the screen edge).
- **Green crosshair** — drawn at the canonical OUTER EDGE position,
  which is what pass-2/polynomial align the detected dash to. For
  LEFT/RIGHT this is `(canonical_outer_x, canonical_centroid_y)`; for
  TOP/BOTTOM, `(canonical_centroid_x, canonical_outer_y)`. The outer
  edge is 1 GB-pixel from the centroid toward the screen edge — so on
  the right side, the green crosshair sits just inside the screen
  edge with one GB-pixel between it and the right boundary; same for
  the other sides per the frame ASCII (1 px on left/right, 6 px on
  top, 5 px on bottom).
- **Magenta detection marker** + **yellow residual line** — drawn at
  the detected outer-edge position (= where the threshold-crossing
  was found). The yellow line shows the residual the polynomial will
  pull out.

If the user reports that the green crosshair has moved out one GB-px
from where they expect, **the dash search-box X/Y range constants
likely shifted along with the canonical (= centroid + outer-edge
boundary)** — verify cyan boxes still leave the correct gap from the
screen edge per the frame structure. The fix in commit `e942c1d`
re-anchored the cyan box to the centroid (not the outer edge) so
the box and crosshair are at *separate* positions — that's correct.

## Files of interest

| File | What's there |
|---|---|
| `packages/gbcam-extract/src/warp.ts` | Whole warp pipeline. Notably: `findDarkCentroid2D` (= dash detector with outer-edge support), `detectDashesOnWarp`, `findBorderCorners`, `findBorderPoints`, `detectInnerBorderThresholdCrossings` (= utility, currently unused but ready), `chooseAndApplyK1`, `scoreUndistortedFrame`, `refineWarpMultiAnchor` (= pass-2 with BORDER_POINT_WEIGHT=1), `applyPolynomialDashCorrection` (= 3-iteration polynomial post-correction, maxFitError <= 10 px on dashes only). |
| `packages/gbcam-extract/scripts/dash-distance-from-edge.ts` | The harness. Channel options (--channel gray/g/rg/rgb), per-image and aggregate output. **The single most important diagnostic for self-verification when user feedback is unavailable.** |
| `packages/gbcam-extract/scripts/probe-corners.ts` | Independent corner-detector probe (legacy). |
| `packages/gbcam-extract/scripts/probe-dashes.ts` | Independent connected-component dash probe. |
| `packages/gbcam-extract/src/correct.ts`, `crop.ts`, `sample.ts`, `quantize.ts` | Downstream pipeline. |

---

## What "done" looks like for this plan

### For the warp fix:

- 165926 right-side dash bias < 1.0 px on all dashes (currently up to 1.28).
- zelda-poster-3 right-side dash bias < 2.0 px on all dashes (currently
  up to 1.26 per harness, but user reports 3-4 px so harness may be
  underestimating).
- Top dashes shifted outward by 1-2 px from current — user said top
  could go up another pixel or two.
- Left side stays as-is (= user said "just about perfect").
- Bottom dashes shifted up by ~1 px, ACCOUNTING for the WH-bleed
  asymmetry (= bottom edge should be slightly further from screen edge
  than other sides' edges).
- Aggregate harness < 0.3 px abs on every side, < 1.5 px max abs on
  any individual dash on any image.
- A new branch is created to mark the "warp fixed" state.

### For the pipeline:

- One or more of (correct.ts, sample.ts, quantize.ts) is improved
  generically.
- Aggregate test recovers to within 1000 px of the 153-px historical
  low (= currently at ~2500 px above).
- No image regresses by more than 50 px diff from current state.
- The pipeline still works on all 12 sample/test images.

---

## Branches at time of writing

- `plan-a-detector-bias`: HEAD = `fac2d6c`. Current development branch.
- `warp-precision-restart-checkpoint`: `5c51658`. Earlier checkpoint.
- `warp-poly-checkpoint`: `272c563`. Original baseline (before this
  session). The plan recommends NOT branching from here (= we have
  significant improvements; branch from `plan-a-detector-bias` HEAD).
- `accuracy-bigger`: original mainline.

The user has said to **branch from `plan-a-detector-bias` to keep the
detector improvements**. Create a new branch when warp is fixed (=
make incremental progress visible).

---

## Memory notes the next agent should know

These exist in the auto-memory system:

| memory | summary |
|---|---|
| `feedback_no_cd_git_compound.md` | Use `git -C` not `cd && git` |
| `feedback_no_compound_commands.md` | Don't put cwd paths in commands |
| `project_warp_bgr_subpixel_bias.md` | BGR sub-pixel layout effects |
| `feedback_warp_alignment_target.md` | Warp targets alignment, not aggregate; expect to retune downstream |

Plus this session's discovery that **the harness's threshold-crossing
disagrees with user perception on the SHAPE of the right-side bias**
(uniform vs inverted-U). Save as a new memory.

The user has explicitly accepted aggregate-test regressions during
warp-improvement iterations. Don't gate work on aggregate.
