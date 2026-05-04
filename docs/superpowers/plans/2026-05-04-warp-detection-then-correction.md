# Continuation Plan: Warp Detection → Warp Correction

> **For agentic workers (and future-me on a different computer):**
> This plan continues an iterative session of detection-and-warp work
> that started with the dashed sample-pictures looking visibly
> mis-warped. Read this file end-to-end before touching code. The
> "Memory & invariants" section captures things that will not be
> obvious from the codebase alone and that have already cost
> hours-of-iteration to discover.

**Branch:** `accuracy-bigger` at HEAD `20d5689` (commit
*"warp: safeguard against lens-distortion runaway when corner
detection fails"*).

**Last working state:** all 6 sample images detect 54/54 dashes with
residuals mostly within ±4 image-px; the inner-border detector still
uses the legacy gradient-argmin approach which has known sub-pixel
biases but does not break the warp.

**Test aggregate (`pnpm test:pipeline`):** ~3000 px (regressed from the
153-px historical low while the architectural restructure was in
progress; recovering this is a *separate* track and not the goal of
this plan).

---

## The Goal

Make the **warp step** position the screen content correctly across
all images — both the 6 reference test images and the sample pictures
that have no hand-corrected reference. Specifically:

1. The DG inner-border line should land at warp cols/rows
   `INNER_* * scale` (= 120, 1024, 120, 1152 at scale=8) consistently
   across all images.
2. The detected dashes should land at their expected positions
   (`DASH_INTERIOR_* * scale` — see `warp.ts`).
3. The warp output should not be heavily over-corrected (no extreme
   barrel/pincushion lens distortion artifacts).

We are pursuing this in two phases:

- **Phase A (current):** build *unbiased detectors* for the dashes and
  inner-border corners. The detectors give us a per-image *signal*
  that the warp is good or bad.
- **Phase B (next):** wire those detector signals into the warp
  pipeline so the warp itself is corrected toward what the detectors
  find. We have not started Phase B; everything in commits between
  `46354b3` and `20d5689` is Phase A work.

## What's in place (Phase A)

### Dash detector — solid

`detectDashesOnWarp` in `warp.ts`, called by `findDarkCentroid2D`:

- Adaptive grayscale flat-fielding: subtract a wide gaussian (σ = 4
  GB-px = 32 image-px) of the gray, recenter at 128. Cancels GBA SP
  front-light banding (which can shift "BK" gray from ~10 at the top
  to ~150 at the bottom in the same image).
- Per-search-box adaptive threshold = `min + 0.5 × (max − min)` of the
  *smoothed* row/col mean profile. Avoids absolute-gray issues entirely.
- Box-smoothing of the dash's long-axis 1D profile by `scale` (one
  LCD-pixel period). Bridges the periodic dark/bright sub-bands that
  long dashes show due to LCD inter-pixel gaps + sub-pixel bleed.
  *Don't* smooth the short axis — the dash is uniformly dark across
  16 px there and smoothing biases the centroid.
- Y-axis gap-bridging in the run-finder (allow up to `scale/2` above-
  threshold samples within a contiguous run). Handles the inter-LCD-
  row gap *within* top/bottom dashes, which is a real ~2-3-px brighter
  strip between the two LCD rows. *Don't* gap-bridge X — what looks
  like an "intra-dash gap" on X is actually the DG cap of the adjacent
  dash, and bridging biases the X centroid 2-3 px outward.
- Returns the geometric centre of the largest contiguous below-
  threshold run, in image-pixel-edge coordinates.

**Empirically reliable:** all 6 sample + 6 test images detect 54/54
dashes; residuals on the worst-aligned image (`zelda-poster-3`)
stay within ±4 image-px after pass-2 RANSAC. The detector is
**unbiased** in the sense that it doesn't latch onto sub-pixel BGR
artifacts; what residual remains is the warp itself being misaligned.

### Inner-border corner detector — known-mediocre, do not change without care

Currently uses the legacy `firstDarkFromFrame`: gaussian-smooth the
R-B+128 profile (sigma 1.5) plus a `scale`-wide box pre-smooth, then
take argmin of derivative with quadratic sub-pixel interpolation.

Returns the **outer-low edge** of the DG inner-border pixel:

- For TOP/LEFT this is the frame-side outer edge (= `INNER_TOP * scale`,
  `INNER_LEFT * scale`).
- For BOTTOM/RIGHT this is the camera-facing inner edge, computed by
  reversing the profile and applying `(c2 - 1) - idx - (scale - 1)`.
  Confusingly, both conventions return the *lower-coordinate* GB-pixel-
  grid edge — i.e., 120 / 120 / 1024 / 1152 for TL / TR / BR / BL of
  the inner camera-region quad. This matches the `INNER_* * scale`
  convention used everywhere downstream.

**Known biases** (per user visual measurement):
- TL detection ~2 right + 2 down off from where the eye places the
  visual corner.
- TR ~3 left + 2 down off.
- BR ~3 left + 2 up off.
- BL ~1 up + 1 right off.

These biases are **stable** across iterations — they reflect real
warp misalignment in the current pipeline, not detector noise.

### Earlier attempt that broke other images: do not revert

Commits `dfe3aea` + `001db5c` switched the corner detector to a
"DG-pixel centroid" approach (`innerBorderEdge1D` with `which="centre"`).
This shifted the returned position by `scale/2` from the outer-edge
convention. Pass-1 refinement (`refineWarpWithMetrics`) maps detected
corners to canvas-corners at `INNER_* * scale`, so the new detector's
+4 offset caused pass-1 to over-correct and **shift the entire warp
inward by half a GB pixel**. Sample images 213416 and 165926 came out
heavily over-zoomed.

Commit `10db3f0` reverted the corner detector. The `innerBorderEdge1D`
function is **preserved in the file but unused** — it's available with
the `"outer-low" | "outer-high" | "centre"` flag if/when the
visualization wants to compute centroids without changing the
refinement contract.

### Lens-correction safeguards (commit `20d5689`)

For sample image `213443`, the source-corner contour detection was
returning the entire image bounding box as the "quad" (because the
screen content fills nearly the whole photo — there's almost no bezel
to threshold against). The lens search was then free to pick any k1
(it happened to pick the range boundary k1 = -0.2 = max barrel
correction) since the inner-border curvature score was bogus anyway,
producing a heavily-bowed warp output.

Three layered safeguards now run during lens search:

1. `findScreenCornersWithMetrics` threshold sweep extended to start
   at 220 (was 180) — overexposed photos may have the frame at the
   bright end of the histogram.
2. `scoreUndistortedFrame` adds `100 × quadScore` to the score — the
   lens search now penalises k1 values that result in a bad corner
   detection.
3. `chooseAndApplyK1` falls back to `k1 = 0` (no lens correction) when
   even the best k1's quadScore exceeds 0.3. The downstream pipeline
   produces a recognisable warp from the un-corrected source rather
   than a heavily-bowed one.

### Detection-debug visualization (commit `001db5c` and earlier)

Generated by `addDetectionDebugImage` in `warp.ts`, written as
`<stem>_warp_c_detection_debug.png` next to the regular warp. Renders:

- **Green dashed rectangle** — expected inner-border outer edge
  (cols 120-1159, rows 120-1031 at scale=8). Drawn as 4-on/4-off dashes
  so the underlying transition pixels stay visible.
- **Red 1×1 dots** — multi-point inner-border R-B detections (9 per
  side); should sit on the green rectangle if alignment is good.
  Bottom and right dots are shifted by `scale - 1` so they all
  represent the *outer edge* of their inner-border pixel (matching
  the green rectangle convention).
- **Magenta 1×1** + **orange 1×1** — corner detection: magenta at the
  detected sub-pixel position rounded to nearest image-px (= TL of an
  8×8 box), orange at the other 3 corners of that 8×8 box. The 8×8
  box is **anchored at the detection**, not snapped to GB-pixel grid.
  The user uses these to read off detector position to image-pixel
  precision.
- **White 1×1** — the geometric centre of the 8×8 box (= detection +
  scale/2). Shows where the centroid of the inner-border DG corner
  pixel falls per the detector. The user perceives the visual corner
  here, so this dot's position vs the actual visible DG corner is the
  most direct alignment-feedback signal.
- **Cyan rectangles** — dash search boxes (±4 GB-px on long axis,
  ±2 GB-px on short axis).
- **Green crosshairs** — expected dash centres.
- **Magenta hollow squares** — detected dash centroids.
- **Yellow lines** — residual vectors when |residual| > 1 image-px.

## Memory & invariants (won't be in code, often re-discovered painfully)

### BGR sub-pixel layout dominates everything

The GBA SP TN LCD sub-pixels go **B, G, R left-to-right** within each
LCD pixel. At scale=8 (image-px per LCD-px), the sub-pixel column
ranges within an LCD pixel are roughly:

- B sub-pixel: image cols 0-2 of the LCD pixel.
- G sub-pixel: cols 3-4.
- R sub-pixel: cols 5-7.

This creates **strong horizontal periodicity** in any per-image-pixel
signal. Empirical consequences:

- **WH frame's B sub-pixel** is dim (B=165 vs G/R=255). The leftmost
  bright sub-pixel of a WH pixel is the G sub-pixel, ~3 phone-pixels
  into the LCD pixel from its left edge. This biases the source
  contour detection's left edge ~3 phone-pixels rightward of the true
  screen edge.
- **DG's B sub-pixel** is *bright* (B=255), G/R sub-pixels are mid
  (148/255). DG renders in the photo with a bright B-area + dim G/R-
  area pattern. R-B+128 within a single DG pixel zigzags HIGH-NEUTRAL-
  LOW; argmin-of-derivative inside the inner-border detector can latch
  onto this within-pixel transition instead of the actual inter-LCD-
  pixel WH→DG boundary. Box-smoothing the profile by `scale` (one LCD
  period) fixes this.
- A **DG → WH transition** has a visible dark gap (`B___GR`) because
  DG's bright sub-pixel is on the left and WH's bright sub-pixels are
  on the right. The right inner-border + right-side dashes are
  systematically perceived ~1-3 image-px further inward than they are.
- LCD inter-pixel gaps create **vertical** ~2-3-px periodic dark bands
  inside long top/bottom dashes (the 16-px-tall BK body has a brighter
  strip between its two LCD rows). The dash detector's Y-axis gap-
  bridging handles this; *do not* gap-bridge X.

### Frontlight banding

The GBA SP front-light is side-mounted, creating a **strong vertical
brightness gradient** across the screen — especially in dimly lit
photos. On `zelda-poster-3` this shifts a "BK" gray value from ~30
near the top to ~120 near the bottom in the same image. Any **fixed**
threshold that catches BK at the top will exclude BK at the bottom,
and vice versa.

The dash detector's flat-fielding (subtract σ=32-px gaussian, recentre
at 128) handles this. The inner-border R-B+128 channel mostly cancels
this naturally because frontlight shifts both R and B equally, so R-B
stays the same.

### Per-image variability

Different photos have totally different challenges:

- Some have generous bezel (`thing-1`, `thing-3`) — corner detection
  works at any threshold.
- Some have the screen filling the photo (`213443`) — corner detection
  via brightness threshold has *no* signal to bite into. Lens search
  can spuriously converge on a range-boundary k1 if not safeguarded.
- The new image (`20260328_165926`) has visible barrel distortion plus
  a yellow front-light cast. Its k1 search currently finds 0 (no
  correction) — the screen quadrilateral is detected, just with low
  contrast that defeats the lens-fitting.

There is **no single threshold or k1** that works. The pipeline must
self-diagnose and adapt per image (which is what the existing
quadScore-penalty + k1-fallback does for lens; we'll need similar
adaptiveness for the warp itself).

### "Don't optimise WH% on the new-image quad"

The new image's user-quadrilateral `(43,81)→(84,81)→(75,111)→(51,111)`
is **not** all WH. It contains speckled LG (especially near the
bottom), and chasing 100% WH means over-shifting LG into WH and
breaking the rest of the image. Use it as a sanity floor only.

Specific area expectations the user has stated for
`20260328_165926_gbcam.png` (128×112 GB-pixel coords, top-left origin):

- Rect (97,71) w=31 h=9: mostly LG and DG, a bit of BK and WH.
- Rect (52,28) w=63 h=7: should be LG (currently mostly WH).
- Rect (1,97) w=9 h=15: mostly LG with a couple DG and WH.
- Rect (7,67) w=24 h=9: NO DG; mostly WH with speckled LG.
- Rect (16,77) w=32 h=34: mostly WH with a lot of speckled LG; NO DG.

### "Target alignment quality, not aggregate"

The user has explicitly accepted aggregate-test regressions (going
from 153 px to ~3000 px) during architectural restructures, with the
expectation that follow-up iterations recover the loss while keeping
the alignment fix. Do not gate warp-improvement commits on aggregate
≤ N. Gate on visual border alignment (the user gives feedback on warp
images directly).

### Per-image diagnostic signals for "is the warp broken"

Use these to detect bad warps automatically (and trigger fallbacks):

- `metrics.warp.quadScore` > 0.15: source-corner detection is suspect.
- `metrics.warp.lensDistortion.k1` at the range boundary (-0.2 or
  0.05): lens search converged on noise.
- `metrics.warp.sourceCorners` near the photo boundaries (e.g., a
  corner at (0, 0) or (W-1, H-1)): contour detection fell back to
  bounding rect of the entire image.
- Dash residuals where the count is < 54: detector failed to find
  some dashes. Per-side counts (15/15/12/12) are reported in
  `metrics.warp.pass2.dashResiduals.{top,bottom,left,right}.count`.
- Pass-2 cornerErrors with absolute values > ~5 image-px: the
  inner-border detector found the corner far from where pass-2 RANSAC
  put it.

## Phase B plan: use detection signals to fix the warp

The dash detector now produces unbiased ground-truth signal at 54
points around the perimeter. The warp pipeline currently uses dashes
in pass-2 RANSAC (with weight 1, threshold 15). The remaining
misalignment comes from:

1. Per-image distortions a homography cannot model (lens barrel/
   pincushion, slight screen curvature, perspective from non-
   orthogonal phone angle).
2. The pass-1 refinement using inner-border corner detection that has
   the known ~2-3 px bias.

### Step 1 — accept the diagnostic state

Commit a point release of the current state with detector
documentation. The detectors should be considered "done" for now
unless the user reports specific images that fail to detect dashes.

### Step 2 — corner-detector visualization improvements

The user wants the magenta/orange GB-pixel-corner markers to land at
the position where the **detector** thinks the corner is, with NO GB-
pixel-grid snapping. Then a separate marker (white) at the centroid.
Currently this is in place but needs verification on all images.

If after this the user identifies a systematic ~2-3 px bias on some
specific corners, the path forward is to switch the corner detector
to the `innerBorderEdge1D` function with `which="centre"` mode —
**but only if the pass-1 refinement is updated to expect centroid
positions** (= `INNER_* * scale + scale/2`) at the same time. See
the regression in commits `dfe3aea` + `001db5c` for what happens
when only one of the two is changed.

### Step 3 — dash-driven warp refinement

This is the main Phase B work. Replace pass-1's reliance on the
inner-border corner detector with a dash-driven refinement:

1. Run the initial perspective warp (driven by source-corner contour
   detection from the photo).
2. Detect dashes on this initial warp using the existing detector.
3. Compute per-side mean residuals and per-axis residual gradients
   (e.g., does the left side bow inward in the middle?). The current
   pass-2 RANSAC homography already does the homographic part; what's
   missing is *non-homographic* corrections.
4. Options for handling non-homographic distortion (bowing):
   - **Tighter lens correction:** extend k1 search, add k2 (radial
     distortion 2nd coefficient). The current scoring uses
     inner-border curvature; switch to dash-residual sum so the
     search optimises directly for what we measure as ground truth.
   - **Per-quadrant homographies:** split the warp into 4 sub-quads
     and fit each independently. More flexible than a single
     homography. Resampling at the boundaries needs care.
   - **Thin-plate spline warp:** more flexible still. Higher
     complexity; opencv has primitives but the integration with the
     existing pass-1 + pass-2 chain is non-trivial.

Suggested order of attempts:
- (a) lens-search-via-dashes (smallest change, biggest expected gain
  for the new image which has visible barrel distortion).
- (b) pass-2 RANSAC re-weighting if residuals remain — currently
  CORNER_WEIGHT=0, BORDER_POINT_WEIGHT=0, DASH_WEIGHT=1. May want to
  experiment with adding back corners at low weight as a fallback
  when dashes are noisy.
- (c) per-quadrant or TPS only if (a)+(b) leave significant residuals.

### Step 4 — co-tune downstream when warp moves

Per `feedback_warp_alignment_target.md` (memory file), downstream
steps (`correct.ts`, `sample.ts`, `quantize.ts`) are tuned to the
*current* warp output positions. When the warp shifts by N image-px,
expect a transient regression in test aggregate while the downstream
catches up. The recovery work is a separate iteration; do not let
the aggregate metric block warp-alignment commits.

## Useful commands

```bash
# Run pipeline tests (writes debug output to test-output/, ~3 min)
cd packages/gbcam-extract && pnpm test:pipeline

# Extract sample images (no debug output by default; use test:pipeline
# instead if you want metrics)
cd packages/gbcam-extract && pnpm extract --dir ../../sample-pictures \
  --output-dir ../../sample-pictures-out

# Independent dash probe (verifies detector vs raw warp)
cd packages/gbcam-extract && node --experimental-strip-types \
  scripts/probe-dashes.ts \
  '/c/Users/.../test-output/zelda-poster-3/debug/zelda-poster-3_warp.png'

# Per-image quad WH% (for the new image only)
cd packages/gbcam-extract && pnpm tsx scripts/measure-new-quad.ts

# Quick metrics readout for any test image
node -e "
  const j = JSON.parse(require('fs').readFileSync(
    'test-output/zelda-poster-3/debug/zelda-poster-3_debug.json','utf8'));
  console.log('lens:', j.metrics.warp.lensDistortion);
  console.log('quadScore:', j.metrics.warp.quadScore);
  console.log('sourceCorners:', j.metrics.warp.sourceCorners);
  console.log('pass2 cornerErrors:', j.metrics.warp.pass2.cornerErrors);
  const all = j.metrics.warp.pass2.dashResiduals.all;
  console.log('dash counts:',
    ['top','bottom','left','right'].map(s=>
      s+':'+all.filter(d=>d.side===s).length).join(' '));
"
```

## Files of interest

| File | What's there |
|---|---|
| `packages/gbcam-extract/src/warp.ts` | Whole warp pipeline. The detectors, corner functions, lens-correction safeguards, and debug-image generator are all here. |
| `packages/gbcam-extract/src/correct.ts` | Brightness-gradient correction. Uses inner-border + frame-strip samples. May need to retune after Phase B warp changes. |
| `packages/gbcam-extract/scripts/probe-dashes.ts` | Independent connected-components probe to cross-check the in-pipeline detector. |
| `packages/gbcam-extract/scripts/measure-new-quad.ts` | Quad WH% measurement for the new image (sanity floor metric). |
| `supporting-materials/Frame 02.png` | Reference frame image (160×144 grayscale palette-swapped). The dash centroids in `DASH_INTERIOR_*` constants come from this. |

## Conventions / gotchas

- **GB-pixel-edge units vs image-pixel coords:** `Frame 02.png` is at
  source resolution (160×144). Pixel index N occupies coordinates
  [N, N+1) and the centre of pixel N is at N+0.5. The `DASH_INTERIOR_*`
  arrays are in these units and multiplied by `scale` for warp coords.
- **The dash detector's expected positions are BK-only centroids**, not
  BK+DG centroids. The detector at threshold 130 doesn't see DG (gray
  ~160 in the warp; below threshold by R-B but the dash detector uses
  grayscale). The constants `DASH_TOP_Y=7`, `DASH_BOTTOM_Y=138`,
  `DASH_LEFT_X=2`, `DASH_RIGHT_X=158` are BK-only centroids verified
  against `Frame 02.png`.
- **`INNER_* * scale` is at the outer-low edge** of the DG corner pixel.
  TL/TR/BR/BL all correspond to the lower-coordinate edge of their
  respective DG line. The visualization adds `scale/2` for centroid
  markers.
- **Don't `cd && git`** — use `git -C <path>` instead. (Persistent
  user preference.)

## What "done" looks like for this plan

- All 6 sample images and 6 reference test images warp without visible
  border misalignment by user inspection.
- The user-quadrilateral on the new image has its content
  approximately matching their stated expectations (mostly WH with
  speckled LG, no DG in specific sub-rects).
- The aggregate test metric has recovered to within ~500 px of the
  153-px historical low (or has a clear path to recovery via co-tuning
  downstream steps).

## Open / not-yet-attempted ideas

- **Dash-driven lens correction.** Currently `chooseAndApplyK1` scores
  on inner-border curvature + a quadScore penalty. Switch to scoring
  on dash-residual sum (after running the full warp + dash detection
  for each k1 candidate). Expensive but principled. Could also add k2
  to the search.
- **Use the dashes to *find* the source corners.** Currently
  brightness-threshold contour detection. The dashes are very high-
  contrast (pure black on white frame) and at known relative positions
  on the screen — detecting them in the source phone photo would give
  source-corners more reliably than contour detection. Bigger change.
- **Frame-anchored colour correction (was Phase 6 of the prior plan,
  rejected).** Could re-attempt now that warp is more accurate. See
  `2026-05-02-warp-precision-and-conditional-b-design.md`.

## Branch hygiene

- Don't commit on `accuracy-big`, `accuracy`, or `main` directly.
- Commit subject format prefix: `warp:` or `detector:` or `viz:` for
  this work.
- Track per-commit metric: pass-2 dash residual max abs, pass-2
  cornerErrors max abs, lens k1, quadScore. The `node -e` snippet
  above prints these.

## Memories to recreate on the new computer

These are stored at
`~/.claude/projects/.../memory/` on the original machine. They'll need
to be re-saved on the new machine if you want them. The most
important ones are:

| File | Summary |
|---|---|
| `feedback_no_cd_git_compound.md` | Use `git -C` not `cd && git` |
| `feedback_no_compound_commands.md` | Don't use cwd paths in commands; cd first |
| `project_pipeline_accuracy_experiments.md` | Why B-channel & target-anchored boundaries failed; redesign hints |
| `feedback_quad_metric_and_warp_first.md` | New-image quad isn't pure WH; fix warp before colour areas |
| `project_warp_bgr_subpixel_bias.md` | BGR sub-pixel layout pulls warp's right edge inward 3-4 image-px |
| `feedback_warp_alignment_target.md` | Warp spikes target alignment, not aggregate; co-tune downstream |

The full text of those memories is in this plan file's
"Memory & invariants" section above.
