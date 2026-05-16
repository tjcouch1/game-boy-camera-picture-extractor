# Warp knowledge-transfer plan

> **For the next agent: read this file end-to-end before touching code.**
> It compresses many iteration cycles' worth of context — user visual
> feedback, what worked, what didn't, what we learned about the warp
> pipeline. The strategic note at the bottom matters as much as the
> technical detail; we are not chasing per-image const tweaks, we are
> fixing detection/correction *algorithms* and finding *signals* that
> work across the whole image set.

## Project goals

### Short term

Fix the **warp step** so the rendered warp PNG visually matches the
GB Camera frame's canonical structure: outer screen edge at the PNG
boundary, inner DG border at canonical position on each side, dashes
at canonical position, camera content inside. The user inspects
`_warp_c_detection_debug.png` (or just `_warp.png`) and reports what's
wrong with the borders, dashes, and corner alignment.

### Long term

Once the warp is correct, tune the downstream pipeline (correct.ts,
crop.ts, sample.ts, quantize.ts) so the extracted GB Camera image
matches the reference. This phase is OUT OF SCOPE for now — do not
touch downstream steps until the user signs off on the warp.

### Signals to use, by phase

| Phase | Primary signal | Secondary signals |
|-------|----------------|-------------------|
| Warp iteration (NOW) | User's visual feedback on warp PNG | **blotch detection on `_gbcam.png`** (large non-BK patches almost always indicate a warp problem in that region), border-distance harness, dash-distance harness, the to-be-built border-detection overlay diagnostic |
| Pipeline iteration (LATER, early) | User's visual feedback on `_gbcam_rgb.png` and structured spot-checks | blotch detection (can also catch downstream classification errors), per-image confusion matrix shapes |
| Pipeline iteration (LATER, late) | `pnpm test:pipeline` aggregate diff vs reference | per-image diff, per-color confusion, blotch detection as sanity check |

**Blotch detection deserves special mention** — the user notes that
"large patches of the same non-BK color in the output `_gbcam.png`
often indicate a warp error in that region" (size ~12×12 and up, not
always rectangular, may contain a few stray pixels of other colors).
This is a SELF-FEEDBACK SIGNAL we can compute without user input.
Build the blotch detector early so you can monitor whether each
warp change is reducing or introducing blotches. Per-image known
blotch positions are in this plan's "Round 7" section; use them as
your ground-truth check that the detector is working before relying
on it for new images.

**Do not use `pnpm test:pipeline` aggregate diff as a signal during
warp work.** The reference images were authored to match the OLD
warp's camera positions, so when the warp legitimately improves and
moves camera content, test diff goes UP. This is expected and
acceptable.

## Branch & code state

- Working branch: `plan-a-detector-bias`
- Bookmark: `warp-tps` at commit `d102b3c` (= when TPS first replaced polynomial)
- Other branches: `warp-poly-checkpoint` (= original polynomial baseline), `accuracy-bigger` (= original mainline)

Recent commits on `plan-a-detector-bias`:

| Commit | Summary | User-reported state |
|--------|---------|---------------------|
| `d102b3c` | TPS post-correction replaces polynomial | Right-side bow on 165926/zp-3, top/bot ~1 px shifts |
| `fff4d08` | Add inner-border points to TPS, with smoothing | (intermediate; not user-feedback-evaluated) |
| `1b39d6f` | 21 border points/side, drop inner-border corner anchors | (intermediate) |
| `53017be` | Gray-channel border detector + MAD outlier rejection | **"All really close except 165926 top-left"** (best state so far per user) |
| `bc2fd1a` | Switch to 2B-R-G DG-signature detector + 33 points + no MAD | Different distortions; 165926 mostly fixed but other images regressed |
| `26afa4d` | Extend sampling to corner endpoints (CORNER_FRAC=0) | (current HEAD) |

The user staged the `53017be` output in `sample-pictures-out-53017be/`
and `test-output-53017be/` so you can compare against the current
HEAD output in `sample-pictures-out/` and `test-output/`.

Test diff at each state (= test pipeline aggregate "Different" sum):
- Polynomial baseline (272c563): **2579** (downstream tuned to this)
- After TPS (d102b3c): 4327
- 53017be: **3056**
- Current HEAD (26afa4d): 7862

The 53017be → current jump is because the DG-signature detector pulls
camera content along with borders when it (incorrectly) snaps onto
DG-like camera pixels.

## User visual feedback log

This is the canonical record. Do not paraphrase or compress these
quotes; future iterations need exact magnitudes and positions.

### Round 4 (before TPS, post initial border-detector work)

> "zelda-poster-3 + 20260328_165926: look like their borders and
> dashes are in almost exactly the same spot, which is great. But
> the bottom right dashes are still too far left.
> - On zelda-poster-3, they still need to move right about 3-4 pixels.
> - On 20260328_165926, they still need to move right about 2 pixels.
>
> They bow out to almost exactly the right x position in the middle,
> then they bow back in to about the same distance from the right
> side at the top.
> - The top dashes could go up another pixel or two.
> - The left side dashes are just about perfect.
> - The bottom dashes could probably move up by a pixel (note that
>   the bottom dashes' bottom edge looks different than the others;
>   it seems the WH below them is bleeding up into their space a
>   bit, so the bottom edge should be a bit further from the edge
>   than the other sides should be)."

Implication: dashes had a **bow-shaped residual** (out at middle, in
at corners) that the degree-3 polynomial couldn't fit. TPS fixed this.

### Round 5 (after TPS+border-detection, around commit `53017be`)

> "**zelda-poster-3**: the right border is too far left and is bowed
> outward. The top and bottom corners are 3-4px too far left, but the
> middle is just about right. The right-side dashes look just about
> perfect, so I suspect there is some incorrect distortion stretching
> the image between the border and the dashes. The right side of the
> top border is great, but it slants down to be about 1px too low by
> the time it gets to the top left corner. The left border is about
> right on the corners but bows out to be 1-2px too far left in the
> middle.
>
> **20260328_165926**: the right border is too far left and is bowed
> outward. The top and bottom corners are 3-4px too far left, but the
> middle is just about right. The right-side dashes look just about
> perfect, so I suspect there is some incorrect distortion stretching
> the image between the border and the dashes. The left border is too
> far left and is slanted outward as it goes upward. The bottom left
> corner is about 1px too far left, then it bows outward to be ~4px
> too far left in the middle, then the top left corner comes back and
> is ~3px too far left.
>
> **thing-2**: the right border is just about right. Maybe it could
> go .25px right. The left border looks like it is about right for
> the most part except for the top third which is maybe a pixel too
> far in. The top border is great.
>
> For all three:
> - The right border still seems to be too far to the left while the
>   dashes look like they are at pretty much at the right position.
>   This makes me suspect the right-side dashes should actually be
>   a pixel or two further right. This may be because of the
>   subpixel position of the WH pixel to the right of the BK dash.
>   BK is ___ and WH is _GR, so together they are ____GR. Maybe the
>   dark part needs to extend just a bit into the right-most GB pixel.
> - The bottom border is bowed outward: it's just about right or
>   maybe half a pixel too low on the corners, but the middle of the
>   bottom border is 2-3px too low."

Implication: borders had real distortion (right bowed outward,
others smaller). Dashes were perceived fine, so the dash detector
target was right.

### Round 6 (after DG-signature detector, current HEAD)

> "**thing-2**: the borders are mostly straight! The bottom border
> could probably go up .5-1px. The top border is slightly bowed in;
> the corners are maybe .5-1px too high, but it bows downward to be
> just right around X columns 733-988. This is so slight that it
> might not matter; I'm not sure. The right border is slightly
> bowed outward; the corners are maybe .5-1px too far left, but it
> bows outward to be just right around Y rows 290-615.
>
> **zp-3**: left border is perfect. Bottom border could maybe go up
> .25px, but it's hard to say; it looks pretty much perfect. Right
> border is similar to that of thing-2 but more pronounced: right
> corners are 2-2.5px too far left, but it bows outward to be just
> right around Y rows 320-660. Top border is slanted; top right
> corner is just about right, but it slants down so the top left
> corner is about 2px too low.
>
> **165926**: Right border is bowed outward: corners are 1-1.5px too
> far left, but it bows outward to be just right around Y rows
> 430-760. Bottom border is pretty much just right. Then there's a
> big problem in the top left area; big distortion. The bottom left
> corner is pretty much just right, then it starts to bow way
> outward around Y row 727-216 and gets to be 6px too far left
> around Y row 262. Then it curves sharply in so the top left corner
> is about 5px too far left. The top border is similar; the top
> left corner is pretty much just the right height, but then it
> immediately starts bowing upward until it is at its highest 7px
> too high around X column 285. Then it curves back down to just
> the right height around X column 744 and continues at just the
> right height the rest of the top border - the top right corner is
> about right height."

Implication: my round-5 fix DID help, but the user's expectations
have tightened (= 0.5-1 px deviations now visible and reported).
165926 has structural top-left distortion that's not yet fixed.

### Round 7 (after DG-signature switch, regression)

> "things are not better; worse in many cases:
>
> **20260313_213443**: top border is 2px too low. Left border is
> warped (top-left corner 3px too far right, bends in 4-5px between
> Y 176-311 then bends back outward). Bottom border well-aligned.
> Right border slightly warped (top-right OK, bends inward to 1px
> too far left around Y 650, bottom right 1px too far left).
>
> **20260313_213457**: top border 2px too low. Left border warped
> (top-left OK, bends in 3-4px between Y 160-270 then bends back).
> Bottom border well-aligned. Right border slightly warped (top-right
> 2px too far left, bends out to OK around Y 240 and below).
>
> **20260328_165926**: top border warped (top-left 1-1.5px too low,
> bends up to OK around X 450-780, bends up to 1px too high around
> X 820-1030, then bends back near end. Top-right OK). Left border
> warped (top-left OK, bends in 2.5-3px between Y 180-270, then
> 2px too far right between Y 311-976, then back. Bottom-left OK).
> Bottom border warped (bottom-left OK, bends up to 2px too high
> starting around X 550, bottom-right 2-2.5px too high). Right
> border slightly warped (top-right OK, bends inward to 2px too far
> left around Y 660 and below, bottom-right 3px too far left).
>
> **zelda-poster-3**: bowed in on all borders. Top-left corner 1px
> too low and well-aligned on X-axis. Then almost immediately bows in
> by a couple pixels, then aligns again so bottom-left is OK. Bottom
> border warps up, then back down, then a lot back up such that
> bottom-right is 4px too high. Bottom-right 3px too far left, then
> slants out as it goes up until top-right is 2px too far left.
>
> **thing-2**: left border well-aligned on both corners but bows in
> almost immediately to 2-3px too far right. Bottom border 1-2px
> too low. Top border mostly well-aligned, but top-right and close
> to it are 1px too high. Right border maybe 3px too far right at
> the top, then curves in to maybe 1px too far right, then
> bottom-right is 2px too far right."

User additionally noted: **53017be was "all really close except the
top left corner of 20260328_165926"**. My round-7 changes regressed
most images to "fix" only that one corner.

### Blotch-detection signal (user's heuristic)

User noticed that **large patches of the same non-BK color in the
output `_gbcam.png` often indicate a warp error in that region**.
Not 100% reliable, but useful as an outside-pipeline check. Size
~12×12 and up, often non-rectangular, may have a few stray pixels.

User-confirmed blotch list (current HEAD):
- `sample-pictures-out/20260313_213443_gbcam.png`: large LG patch upper left
- `sample-pictures-out/20260313_213457_gbcam.png`: large LG patch upper middle
- `sample-pictures-out/20260328_165926_gbcam.png` + `..._165926~2-EDIT_gbcam.png`: large DG patch bottom-left through center

User-confirmed blotch list (53017be):
- `sample-pictures-out-53017be/20260313_213443_gbcam.png`: large DG patch upper left + large LG patch right of it
- `sample-pictures-out-53017be/20260313_213457_gbcam.png`: large LG patch upper left + smaller LG patch right of it
- `sample-pictures-out-53017be/20260328_165926_gbcam.png` + `~2-EDIT`: lots of WH in bottom left (should be LG)

**Persistent issue**: 213443 and 213457 have upper-left warp issues
in BOTH commits. The DG-signature change didn't help; the gray-channel
detector didn't help either. This is a deeper problem (= probably
source-corner detection or lens k1 search) that needs a different
approach than border-control-point tweaks.

Image `20260328_165926~2-EDIT.jpg` was added by the user: a recropped
version of 165926 that includes the entire screen (the original is
slightly cut off at top-left). The warp output of both versions has
similar distortion in the top-left, so the cut-off is not the cause.

**Legitimate large non-BK patches** (NOT warp errors — these are real
camera content):
- 20260313_213430.jpg, zelda-poster: large WH patches at top and bottom
- 20260328_165926.jpg, ~2-EDIT: large WH patch at bottom middle-right

Blotch detection cannot be in the pipeline itself (= unreliable per
image), but a standalone diagnostic script can flag suspicious
regions for visual inspection.

## What's been tried and the outcomes

### Detector approaches

| Approach | Outcome | Notes |
|---------|---------|-------|
| Gray-channel threshold-crossing on smoothed profile | Works for some images, fails on dim WH corners (= picks up camera→camera-dark transition instead of WH→DG) | Used in 53017be |
| R-B+128 channel detection | Disaster (test diff 7847 → 15143) | Channel has anomalous behavior on real BGR data; reverted |
| G-channel-only detection | Marginal; right max worse | Tried briefly, reverted |
| DG-signature 2B-R-G clipped | Correctly identifies DG strip when WH is dim, but has false positives in camera content with bluish/purplish pixels | Used in current HEAD; introduced regressions |
| Single-detector with strict contrast threshold (80) | Rejected real signal | Reverted |
| Multi-channel consensus | NOT YET TRIED | Likely path forward |

### TPS parameter sweeps

| Parameter | Range explored | Best | Notes |
|-----------|----------------|------|-------|
| `LAMBDA` (smoothness) | 1e-6, 1e-4, 1e-3, 0.01, 0.05, 0.1 | 0.05 | Lower → exact interpolation of noise; higher → leaves real distortion |
| `N_POINTS` per side | 7, 9, 13, 21, 33, 65 | 21–33 | More points helps detect local features, harder to filter noise |
| `CORNER_FRAC` (sampling exclusion) | 0, 0.02, 0.05, 0.15 | 0 | User-reported "corner" issues are right at the endpoints |
| TPS iterations | 3, 5, 7 | 3 | No further convergence past 3 |
| Inner border corner anchors (identity) | with / without | Without | Assumed corner ≡ canonical; not always true |
| MAD outlier rejection (per-side residual) | with / without | TBD | Rejected real local distortions (= 165926 bumps); not currently used |
| Per-point lambda (dash tight, border loose) | tried 0.01/0.2/0.001 | Worse | Border loose lambda = borders bow back |

### Other experiments

- Per-side different detection algorithms (e.g., G channel for left/right): **not tried**
- Smooth-curve fitting through detected points before TPS: **not tried**
- Pre-process warp output (apply correct.ts brightness flattening) before detection: **not tried**
- Source-corner detection improvements for screen-fills-photo images: **not tried**
- Lens k1 search post-pass-2: discussed but not implemented
- Blotch-based feedback loop: user just suggested

## Problems / root causes we've identified

1. **No shared ground truth.** My detector is the only signal I have
   for "where the border is". When my detector is wrong, I can't tell
   without user feedback. Each round of user feedback narrows the
   space but doesn't pinpoint a generic fix.

2. **Detector false positives from camera content.** DG-signature
   peaks at DG-coloured pixels in the camera area (not just the
   inner border). Argmax can land on camera content within the
   peak-search window, pulling the warp toward wrong positions.

3. **Hard-coded thresholds don't generalize.** Contrast threshold,
   peak search width, smoothing kernel, all chosen empirically.
   Each image has different brightness/colour characteristics;
   one value can't fit all.

4. **BGR sub-pixel asymmetry, especially horizontal.** LCD has B-left,
   G-middle, R-right within each pixel. The DG strip on LEFT/RIGHT
   borders is vertical, so detection profiles run horizontally
   across sub-cells → BGR-position-dependent sub-pixel bias.
   TOP/BOTTOM borders are horizontal strips, profiles run
   vertically → BGR is column-uniform within a row → less bias.
   Consistent with the user repeatedly reporting left/right border
   issues more than top/bottom.

5. **TPS over-corrects with many control points.** With 100+ control
   points and a flexible TPS basis, even small per-point errors
   accumulate into local warp distortions. Lower λ → exact-interpolate
   noise; higher λ → leaves real distortion unfixed; there's no
   middle ground when control-point errors are large enough.

6. **Pre-warp distortion in source-corner detection.** 165926 has
   "screen fills photo, no bezel" — corner detection is forced to
   image-edge approximations. The pass-2 + TPS post-correction has
   to do a lot of twisting to fix this, which then introduces new
   distortion in the camera area. The 213443/213457 top-left blotches
   also persist across detector changes, suggesting source-corner
   detection or lens k1 is the underlying issue, not border detection.

7. **Test diff is misleading.** Reference matches the OLD warp's
   camera positions. A correctly-fixing warp moves camera content
   and increases test diff. We can't use it as an iteration signal
   until we re-tune downstream.

8. **The strategy of "tune values to match latest feedback" doesn't
   compose.** Each round optimizes for the last user feedback and
   breaks the previous one. We need *algorithmic* improvements that
   generalize, not const-tuning.

## Diagnostic tools available

### Pipeline-output debug images (already generated by pipeline)

In `test-output/<image>/debug/` and `sample-pictures-out/debug/`:
- `<stem>_warp.png` — final warp output (160·8 × 144·8)
- `<stem>_warp_a_corners.png` — input photo with detected screen corners
- `<stem>_warp_b_inner_border_residual.png` — visualization of inner-border R-B+128 residuals (pre-TPS)
- `<stem>_warp_c_detection_debug.png` — overlay showing dash detection (cyan box, green crosshair, magenta detection marker, yellow residual)
- `<stem>_debug.json` — structured metrics (lens k1, quadScore, corner errors, dash residuals, polyCorrection/tpsCorrection params)

The `_warp_c_detection_debug.png` does NOT currently overlay border
detection — only dashes. **Adding border-detection markers to this
image would give us shared ground truth between detector and user
perception** (= the very signal we keep missing).

### Standalone harness scripts

| Script | Purpose | Channel |
|--------|---------|---------|
| `packages/gbcam-extract/scripts/dash-distance-from-edge.ts` | Per-dash outer-edge bias vs canonical | Configurable: gray (default), g, rg, rgb |
| `packages/gbcam-extract/scripts/border-distance-from-edge.ts` | Per-border-point bias vs canonical | DG signature (2B-R-G) — switched in commit bc2fd1a |

Usage:
```bash
cd packages/gbcam-extract && pnpm test:pipeline   # full pipeline, ~3-7 min
node --experimental-strip-types scripts/dash-distance-from-edge.ts --dir ../../test-output --dir ../../sample-pictures-out
node --experimental-strip-types scripts/border-distance-from-edge.ts --dir ../../test-output --dir ../../sample-pictures-out
node --experimental-strip-types scripts/dash-distance-from-edge.ts --verbose ../../sample-pictures-out/debug/20260328_165926_warp.png
```

### Diagnostic ideas not yet built

- **Border detection overlay** (= the missing feedback piece). Mark
  every detected border point on the warp output with a coloured dot,
  including bias magnitude. Save as `_warp_e_border_detection.png`.
  Compare with the user's visual perception of where borders are.
- **DG signature heatmap** image showing where the detector finds
  high "DG-ness". Save as `_warp_f_dg_heatmap.png`.
- **Blotch detection script**: scan output `_gbcam.png` for
  connected components of the same non-BK color larger than ~12×12.
  Flag them; cross-reference with input image's known-true bright
  regions. Useful as an external check.
- **Border curve fitter**: detect border points per-side, fit a
  smooth polynomial (degree 2-3) through them, use the SMOOTH curve
  as TPS input instead of noisy individual points. Reject points
  that deviate far from the smooth fit.
- **Multi-channel consensus detector**: run DG-signature + gray +
  G-channel detectors; only accept a point if ≥2 agree within
  2 image-px; use the median of agreeing channels.
- **Pre-warp lens-k1 search refinement**: try scoring k1 candidates
  against post-pass-2 dash residuals (not pre-pass-2). Expand the
  range when source corner detection has low confidence.
- **Source-photo screen-edge re-detection** for screen-fills-photo
  cases: when standard corner detection yields image-edge-adjacent
  corners, fall back to a different algorithm (e.g., direct edge
  detection without thresholding).

## BGR sub-pixel structure & colour blending

The displayed warp PNG renders on a screen with **BGR sub-pixel
layout** (= each display pixel has B sub-cell at left, G middle,
R right). This means:
- A pixel with R=255 G=255 B=165 (= WH) shows DIM-BLUE on its left
  third and BRIGHT-yellow on its middle+right.
- A pixel with R=148 G=148 B=255 (= DG) shows BRIGHT-blue on left
  and DIM-purple on middle+right.
- The eye anchors to where R+G changes (= eye is less sensitive to B).

GB Camera palette:
- BK: R=0 G=0 B=0
- DG: R=148 G=148 B=255 (purple-blue)
- LG: R=255 G=148 B=148 (pink-red)
- WH: R=255 G=255 B=165 (yellow-white)

DG and WH have **opposite B intensities** (255 vs 165) — the DG
signature `clip(2B − R − G, 0, 255)` exploits this:
- DG → 2*255 − 148 − 148 = +214 (HIGH)
- WH → 2*165 − 255 − 255 = −180 → 0
- BK → 0
- LG → 296 − 255 − 148 = −107 → 0
- camera content → variable, but usually < ~80 unless purple-tinted

**Bleeding / sub-pixel position effects**:
- At BK→WH boundary (e.g., the dash outer edge meeting WH frame), the
  BK ends at a pixel boundary; the next WH pixel's leftmost sub-cell
  is the dim B. From a distance, the dim B looks dark, so the visible
  "BK" appears to extend ~1/3 of a GB pixel into the WH region. This
  is what the user described as "BK is ___ and WH is _GR, so together
  they are ____GR" — and is one reason why dash *outer-edge* and
  *visible-edge* don't agree on sub-pixel positions.
- At WH→DG boundary (the inner border's outer edge), the WH pixel
  has dim-B left + bright G,R middle+right; the DG pixel has bright-B
  left + dim G,R middle+right. The B sub-cell change is small visually
  (eye less sensitive); the G+R change dominates the perceived
  transition. The visible boundary sits inside the G/R sub-cells of
  the WH pixel — at a sub-pixel position offset from the pixel
  boundary.
- These sub-pixel asymmetries are why horizontal-direction transitions
  (= LEFT/RIGHT borders, also dash X-positions) have ~1 sub-cell
  systematic bias between gray-channel threshold-crossing and visible
  edge. Vertical-direction transitions (= TOP/BOTTOM borders, dash
  Y-positions) don't have this because BGR is uniform within a row.

**Implication for detectors**: same algorithm applied to left/right
vs top/bottom is *not equivalent*. Future detection improvements
should consider per-side algorithm variants — e.g., the existing
`subpixelCols` logic in `sample.ts` accounts for sub-pixel position
within each pixel; a similar approach could apply to border detection.

## Files of interest

| File | Responsibility |
|------|----------------|
| `packages/gbcam-extract/src/warp.ts` | All warp logic (= 3300+ lines). Key functions: `chooseAndApplyK1` (lens search), `findScreenCornersWithMetrics` (source corner detection), `initialWarp`, `refineWarpWithMetrics` (pass-1), `refineWarpMultiAnchor` (pass-2 RANSAC), `detectDashesOnWarp` + `findDarkCentroid2D` (dash detection w/ outer edge), `detectInnerBorderThresholdCrossings` (border detection, currently DG-signature), `applyTPSDashCorrection` (TPS post-correction with dashes + border + 8 anchors), `applyPolynomialDashCorrection` (fallback polynomial). |
| `packages/gbcam-extract/scripts/border-distance-from-edge.ts` | Diagnostic harness; currently DG-signature |
| `packages/gbcam-extract/scripts/dash-distance-from-edge.ts` | Diagnostic harness for dashes; gray channel default |
| `packages/gbcam-extract/src/correct.ts` | Brightness correction (post-warp); will need re-tuning later |
| `packages/gbcam-extract/src/crop.ts`, `sample.ts`, `quantize.ts` | Downstream pipeline (defer) |
| `supporting-materials/frame_ascii.txt`, `Frame 02.png` | Reference frame structure |

## Strategic guidance for the next iteration

**Do:**
- Build the missing diagnostic first: a per-image overlay
  visualisation that shows detected border positions vs canonical
  (= `_warp_e_border_detection.png` or similar). Get the user to
  confirm that the overlay matches their visual perception of where
  the border is. **Without this, we are blind, and we will keep
  going in circles.**
- Build the blotch-detection script alongside. Use it as an
  automated self-feedback signal: every warp change should reduce
  the known problem-region blotches without introducing new ones.
- Hypothesize and test *algorithmic* generalizations, not constant
  tweaks. E.g., multi-channel consensus, smooth-curve fitting,
  per-side detector variants, pre-warp brightness normalization.
- Detect distinguishing image *characteristics* and route to
  different algorithms when appropriate (= screen-fills-photo
  vs has-bezel, dim-WH-frame vs bright-WH-frame). This is generic
  if the routing condition is itself generic (= e.g., "WH frame
  brightness > N" as a measured property of the image).
- Treat 213443 / 213457 top-left blotches as ROOT-CAUSE issues
  that border-detection alone cannot fix. Likely culprit:
  source-corner detection or lens k1 search.
- Commit small, frequently. Compare each commit's visual output
  (the user can rapidly check `_warp_c_detection_debug.png` and
  `_gbcam.png` blotches).

**Don't:**
- Tweak hard-coded const values (LAMBDA, CONTRAST_THRESHOLD, N_POINTS,
  peakHalf, etc.) trying to match the latest feedback. We have
  evidence this drifts.
- Optimize for `pnpm test:pipeline` aggregate diff during warp work.
  The reference doesn't reflect warp correctness.
- Bypass user feedback. Even with the new diagnostic overlay, periodic
  visual confirmation is essential because the BGR sub-pixel issue
  means harness ≠ user perception in some cases.
- Add MORE TPS control points without a clean signal. More noisy
  points = more local warp distortion.

## Recommended sequence

1. **Build the two diagnostic tools first** (no warp change yet):

   1a. **Blotch detection script** (= self-feedback signal). Scan
   each output `_gbcam.png` for connected components of the same
   non-BK color larger than ~12×12. Output a list per image
   (color, bounding box, area, centroid). Validate against the
   user-confirmed blotch lists in this plan's Round 7 section to
   ensure the detector matches the user's eye before trusting it
   on new images. This becomes the automated check you can use
   between every warp change to verify you're not introducing
   new blotches.

   1b. **Border-detection overlay** on `_warp_c_detection_debug.png`
   (or a new debug image). Mark every detected border point with a
   coloured dot indicating bias magnitude/direction. Send the
   updated debug PNGs to the user and confirm whether detector
   predictions match the visible border. This anchors what
   "detector says" means in user terms.

2. **Investigate 213443 / 213457 / 165926 root cause**. All three
   have persistent top-left blotches across detector changes (in
   both `53017be` and current HEAD output). Hypothesis: source
   corner detection or lens k1 is the root issue, not border
   detection. Check by:
   - Looking at `_warp_a_corners.png` for whether corners detected
     correctly
   - Inspecting `_debug.json`'s `lensDistortion.k1`, `quadScore`,
     `sourceCorners`, `pass2.cornerErrors`
   - Comparing to a known-good image's diagnostics

3. **Decide branch direction based on Step 1b findings**:
   - **If detector predictions match user perception**: detector
     is fine, TPS is over-correcting. Solutions = smoother
     constraints (curve-fit through detected points), fewer
     constraints, per-side TPS variants.
   - **If detector predictions don't match**: detector is wrong.
     Solutions = multi-channel consensus, BGR-aware per-side
     algorithms, pre-warp brightness flattening.
   - **Likely**: both, in different proportions per image. Build
     both improvements.

4. **Iterate with blotch detection + diagnostic overlay as
   primary signals, user feedback to confirm**. Each warp change
   should:
   - Not introduce blotches in regions that were previously clean
   - Reduce or eliminate the known problematic blotches in 213443
     / 213457 / 165926
   - Keep dash bias near sub-pixel

5. **Once warp converges** (= user sign-off): branch
   `warp-fixed-or-similar`, then proceed to downstream pipeline
   tuning. THAT phase can use test diff as a signal once references
   match the new warp.

## Memory notes

In `~/.claude/projects/.../memory/`:
- `project_warp_border_detection.md` — outdated as of round 7 (says
  DG-signature works; actually it has false positives). Recommend:
  next agent updates this with the round-7 findings.
- `MEMORY.md` — index

In project memory files / settings:
- `AGENTS.md` — codebase overview, frame structure, pipeline steps
- `CLAUDE.md` — points to AGENTS.md

## Open questions for the user (if needed during iteration)

If you reach a fork where you genuinely cannot decide without more
input, you may ask the user *focused* questions like:
- "I built the diagnostic overlay; here's the path: ... Could you
  open `<image>_warp_e_border_detection.png` and tell me if the
  dots match where you see the border?"
- "I think the 213443 top-left blotch is from a source-corner
  detection issue; could you confirm by checking
  `_warp_a_corners.png` for that image?"

Avoid open-ended questions like "what should I try next?". Make
specific, narrow requests.
