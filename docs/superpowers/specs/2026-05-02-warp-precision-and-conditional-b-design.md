# Warp Precision & Conditional B-Channel — Design

**Date:** 2026-05-02
**Status:** Draft
**Branch base:** `accuracy-bigger` (off `accuracy-big`, agg 157 — Phase A landed,
Phase B reverted)
**Supersedes (in part):** `2026-05-01-color-cast-separation-design.md`. That
design's Phase B failed because B clips at the sensor on blue-cast images,
making 3D RGB k-means worse than 2D RG. Phase C of that design depended
on warp accuracy that we now know is borderline. This design picks up
both threads.

## What `accuracy-big` left us with

- White-balance pre-step (`white-balance.ts`) lands frame median at exact
  `(255, 255, 165)` on every image. Structurally clean. **Keep.**
- `correct.ts`'s post-correction frame rescale removed (it was no-op
  after WB). **Keep.**
- 3D RGB quantize **reverted** — see
  `memory/project_pipeline_accuracy_experiments.md` for the full
  failure analysis.
- Aggregate 157 (was 76 before WB, plan budget allowed up to thousands).
  Per-image: 49+9+20+8+34+37.

## What we learned that changes the strategy

### 1. The B channel is per-image informative, not globally

Raw frame B median across the 7 images:
```
thing-1         234   ←  blue cast, B clipped at sensor
thing-2         202
thing-3         196
zelda-poster-1  240   ←  blue cast, B clipped
zelda-poster-2  206
zelda-poster-3  202
20260328_165926 187   ←  yellow cast, B recoverable
```

For B median ≳ 240 the front-light's blue saturated raw B at 255 — both
frame and DG pixels clip there, so post-WB they're indistinguishable in
B. For B median ≲ 240 the cast is yellow-ish or neutral, B carries real
DG-vs-non-DG information and 3D RGB clustering can leverage it.

**Implication:** any 3D-RGB approach must be **conditional on raw B
informativeness**. Apply 3D only when `raw_frame_B_median < 240`.

### 2. Warp residuals are larger than they look

After two-pass inner-border refinement, residual corner errors:
```
                TL              TR              BR              BL          edge curvatures
thing-1         (-1.1, -0.5)    ( 1.2, -0.4)    ( 1.1, -1.6)    (-0.8, -2.0)   bot −4.5
zelda-poster-1  (-1.3, -0.4)    ( 1.8, -0.3)    ( 1.8,  0.5)    (-0.9,  0.1)   right +1.8
zelda-poster-2  (-1.4,  0.2)    ( 1.9, -0.3)    ( 1.6,  0.3)    (-0.8, -0.2)   right +2.1
zelda-poster-3  (-0.9, -0.4)    ( 1.9, -0.5)    ( 1.3,  0.6)    (-0.7, -0.5)   right +2.0
```

Corner errors are 1–2 image-pixels (0.12–0.25 SP pixels at scale=8),
edge curvatures up to 4.5 image-pixels (0.56 SP pixels). The user
observed exactly this: "the frame isn't quite straight or in the right
place… the border sides bow in or out a bit." That's lens distortion
(the perspective transform alone cannot model it).

The pipeline's downstream steps depend on the warp being precise:

- `correct.ts` reads frame strip / inner-border pixel medians for its
  white/dark surface fits. A 1-pixel misalignment puts pixels from the
  *frame* into the *inner border* sample (or vice versa), corrupting
  the surface estimate.
- `sample.ts` uses fixed sub-pixel offsets `B=[1,3) G=[3,5) R=[5,7)` per
  GB-pixel block at scale 8. A half-SP-pixel warp shift makes those
  windows pick up the wrong sub-pixel content.
- A future Phase 4 (frame-anchored colour correction) would fit a
  3×3 affine RGB transform from raw frame pixels to reference frame
  pixels. **That fit collapses if the frame anchor pixels are
  off-grid by 1+ image-pixel.**

### 3. The information-loss problem is upstream, not in quantize

When raw B saturates, the information is gone before any pipeline step
sees it. No quantize redesign can recover it. This means:

- For blue-cast images, there is no B-channel to recover. Stick with
  2D RG and accept that.
- For yellow/neutral-cast images, B is recoverable from raw — and the
  correct.ts B-channel is currently passthrough (no correction). If we
  built a real B correction *only on images where it's recoverable*,
  we could land both improvements without the universal regression
  Phase B's design caused.

### 4. Test images are blue-cast outliers

Of 7 images, 6 are blue-cast (B median 196–240, mostly clipped) and
1 is yellow-cast (B median 187). The reference test set is dominated
by the cast direction that hurts B-channel approaches. Tuning blindly
on test aggregate biases against approaches that help yellow-cast
images. This is a structural issue with the test set; we partially
work around it by judging the new image qualitatively.

## Goal

Make the pipeline more precise upstream (warp) and more correct
downstream (quantize) so that:

1. Test aggregate trends back toward and below 76, ideally 0.
2. The new yellow-cast image's `*_gbcam_rgb.png` shows visibly less
   pink/purple blobbing than the Phase 0 baseline.
3. The pipeline becomes robust enough that further improvements
   (hand-corrected reference for the new image, additional sample
   images) are productive next steps, not blocked on structural
   issues.

## Phase plan

Each phase is independently committable and revertable. Acceptance is
phase-specific; aggregate budget tightens as phases progress.

### Phase 1 — Warp residual diagnostic (LOW RISK)

Pure diagnostic. Exposes per-image residual error after pass-2 warp so
later phases can target their improvements. No behaviour change.

- Add a structured metric `pass2.residual` that summarises max corner
  error and mean edge curvature.
- Add a debug image `warp_b_inner_border_residual.png` overlaying the
  detected inner-border points on the warped image with the expected
  rectangle drawn. Reading this image immediately tells a developer
  where the warp is misaligned.

**Acceptance:** unconditional. Diagnostic only.

### Phase 2 — Multi-anchor warp via dash positions (MEDIUM RISK)

The frame has 17 horizontal dashes (top + bottom = 34) and 14 vertical
dashes per side (× 4 sides = 56). After pass-2 warp, every dash should
land at a known position in the (160·scale, 144·scale) canvas. Use
those as additional anchor points for a refined homography.

- For each side, detect dash centres in the pass-2 warped image
  (fit-min the local intensity profile around each expected dash
  position, ±2 SP pixels).
- Reject outliers (any detected centre > 2 SP pixels from expected).
- Build a least-squares homography fit using all valid anchors
  (4 corners + ~50 dashes). `cv.findHomography` with RANSAC.
- Re-warp the original image with the new homography.

**Acceptance:** keep if aggregate drops or new image's frame post-
correction inner-border error visibly drops AND no individual image
regresses by > 30 px. The phase has a tighter budget than Phase A
because warp errors and downstream residuals are correlated and we
expect a *win* here, not a "broken-looking middle".

**Risk:** dash detection on the warped image needs to be robust to
the existing residual error. If a dash is detected at an outlier
position the homography fit can twist. RANSAC mitigates.

### Phase 3 — Lens-distortion correction (HIGHER RISK)

The bowing the user observed is lens distortion (radial), which a
perspective transform mathematically cannot remove. After Phase 2's
multi-anchor fit reduces corner residual, residual edge curvature
becomes the dominant error.

- Fit a single radial-distortion parameter k1 by least-squares so the
  inner-border points all lie on the expected straight lines. (One
  parameter is enough for cellphone-camera barrel distortion at the
  scales we're working with — no need for full 5-parameter Brown-
  Conrady.)
- Apply the inverse distortion to the source image before warping
  (`cv.undistort` with K = identity and dist = `[k1, 0, 0, 0, 0]`).
- Re-warp.

**Acceptance:** keep if aggregate drops AND mean edge curvature
metric drops below 0.5 image-pixels on every image. Reject if any
image regresses by > 20 px.

**Risk:** the distortion model is approximate. If the camera optical
centre is far from image centre or the lens has tangential distortion,
single-parameter k1 can't capture it. Fall back to per-image
polynomial warp residual correction if k1 fails.

### Phase 4 — Conditional 3D RGB quantize (MEDIUM RISK, addresses prior failure)

Switch quantize to 3D RGB only on images where B is recoverable. Use
the raw frame B median (already in metrics from Phase 0) as the gate.

- Add a `useB: boolean` flag computed in `index.ts`:
  `useB = white_balance_metrics.rawFrameMedian.B < 240`.
- Pass it through to `quantize` via options.
- When `useB`, quantize uses 3D RGB k-means with init centres (B from
  data percentiles, not fixed targets). When `!useB`, quantize uses
  the existing 2D RG.
- Add a unit test: `useB=false` matches current 2D-RG behaviour
  exactly; `useB=true` correctly classifies a synthetic 4-band RGB
  image (already exists from prior B.1 attempt — keep that test).

**Acceptance:** test aggregate should not regress on blue-cast images
(useB=false there). New image (useB=true) should show visibly less
pink/purple blobbing. Net agg target: ≤ 157 (current state) and new
image qualitatively better.

**Risk:** the 240 threshold is empirical. Edge cases (B median right
at 240) could flip behaviour. Mitigate by hysteresis or by using a
soft-weighting B contribution proportional to `(240 - B_med) / 60`
clamped to `[0, 1]`.

### Phase 5 — B-channel correction via raw frame anchors (LOW RISK ON GATED IMAGES)

When `useB` is true, currently `correct.ts` passthroughs B. With B
recoverable, we can fit a per-pixel affine surface for B too — same
machinery as R/G. The only reason B was passthrough was because
on blue-cast images the surface fit inverted (frame B > border B).
With the `useB` gate from Phase 4, we apply B correction only when
the surface is well-conditioned.

- Inside `correct.ts`, accept a `correctB: boolean` option (defaulting
  to `true` when `useB` is set in `index.ts`).
- When `correctB`, mirror the R/G correction for B using
  whiteTarget=165 (frame B target) and darkTarget=255 (border B
  target).
- Add a sanity check: if the fitted dark surface ends up *higher*
  than the white surface anywhere (the inverted-affine pathology),
  abort B correction for this image and fall back to passthrough.
  Log a warning.

**Acceptance:** improves the new image without regressing blue-cast
test images (where B passthrough remains). Aggregate should not
worsen.

### Phase 6 — Frame-anchored colour correction (HIGH RISK, GATED ON WARP)

The Phase C from the prior plan: per-image affine RGB transform fit
to known frame pixels. **Now feasible** because Phase 2+3 reduced
warp residual to where frame anchors land at integer pixel positions.

- Load `Frame 02.png` (already in repo).
- For each warp output pixel inside the frame region, look up the
  expected RGB from the reference.
- Fit `target = M · raw + b` (3×3 + 3-vector, 12 unknowns) by
  least-squares on the ~3000 frame anchor pairs.
- Apply M and b globally before/instead of `correct.ts`.

**Acceptance:** keep only if aggregate drops by ≥ 20 from end of
Phase 5. If marginal, gate Phase 6 behind a config flag and revisit
after Phase 7.

### Phase 7 — Iterative correct↔quantize (HIGH RISK)

After first-pass classification, use camera-content classifications
as additional anchors for the colour transform. Refit, re-correct,
re-quantize. One iteration — convergence beyond that is rare.

**Acceptance:** keep if aggregate drops by ≥ 5 from Phase 6.

### Phase 8 — Hand-corrected reference for `20260328_165926`

Once the new image's output is recognisable (top-left mostly BK,
bottom mostly WH, no big blobs), request a hand-corrected reference
from the user. Add it to the test suite. Iterate to drive its
aggregate to 0.

## Acceptance criteria summary

| Phase | Aggregate budget (start 157) | Other gates |
|-------|------------------------------|-------------|
| 1 | unchanged (diagnostic only) | — |
| 2 | ≤ 157, no image >+30 | mean residual < pass-2 baseline |
| 3 | ≤ Phase 2 result | mean edge curvature < 0.5 |
| 4 | ≤ 157 on blue-cast images | new image qualitatively cleaner |
| 5 | ≤ Phase 4 result | no inverted-affine pathology |
| 6 | drop ≥ 20 vs Phase 5 | — |
| 7 | drop ≥ 5 vs Phase 6 | — |
| 8 | new image agg drops over time | — |

Hard-stop conditions in any phase:
- Unit test (non-pipeline) failing.
- New image qualitatively worse.
- An individual reference image regresses by > 50 px (vs phase
  baseline).

## What's NOT in scope

- Python pipeline. Reference only.
- Web app. No UI changes; new options have safe defaults.
- New external dependencies. Stay within OpenCV.js / vitest.
- The Phase B-style universal 3D RGB clustering. The conditional
  approach in Phase 4 supersedes it.
- Synthetic stress images, sub-pixel auto-detect, or other escape
  hatches from the prior-prior plan.

## Open questions

- **Phase 2 dash detection robustness.** Need to verify dashes are
  detectable on cast-tinted images. Spike: dump current dash
  positions before committing to the design.
- **Phase 3 single-parameter k1 sufficiency.** Some cellphone cameras
  have substantial tangential distortion or off-centre principal
  points. If k1-only doesn't drop curvature below 0.5 image-pixels,
  fall back to a per-image 2D polynomial residual warp.
- **Phase 4 threshold (240).** Empirical. Consider replacing with a
  soft weight rather than hard gate.
- **Phase 6 vs Phase 4+5.** If conditional 3D + B correction (4+5)
  reaches agg ≤ 50 on its own, Phase 6's invasive rewrite of
  correct.ts may not be worth the risk.

## Notes carried from prior plans

- The white-balance step (Phase A from the prior plan) stays in.
- Drift diagnostics (X1) stay in.
- `min observed span = 5` clamp in `applyCorrectionChannel` is
  defensively kept (unreachable in practice).
- `bright-heavy refinement skip` (C1) stays at threshold 160.
