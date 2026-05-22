# Warp rethink + pipeline tuning — handoff for next iteration

> **Read this whole file end-to-end before touching code.** It compresses
> the project's current state, what the diagnostics tell you, what the
> goals and constraints are, and where the iteration appears to be stuck.
> The much-longer history of what's been tried lives in
> `2026-05-15-warp-knowledge-transfer.md` — read that too, especially
> the Round 6 user-feedback log and the Round 9/10/11 "what didn't
> work" sections. **But don't feel constrained by either document's
> approach. Nothing in the current warp pipeline is sacred.**

## Mission

This pipeline turns a phone photo of a Game Boy Camera image displayed
on a Game Boy Advance SP screen into a clean 128×112 four-colour Game
Boy Camera image. The goal is to produce *the same image the GBA SP
is rendering* — pixel-by-pixel — regardless of phone angle, distance,
ambient lighting, and front-light gradient.

### Goal sequence, in order

1. **Get the warp step right** — for every test image AND every sample
   image, the warped `<stem>_warp.png` should land the GBA frame's
   inner DG border at canonical position on every side, dashes at
   canonical position, and camera content correctly inside. **Use the
   diagnostics; do NOT use `pnpm test:pipeline`'s pixel-diff as the
   warp signal** — references match the OLD warp's positions, so a
   correctly-fixing warp can make pixel diff go up. The right signals
   for the warp phase are listed below.

2. **Tune the rest of the pipeline (correct, crop, sample, quantize) to
   match the now-correct warp.** This phase still does NOT use test
   pixel diff as the primary signal — it follows the same "match the
   user's perception of the original GBA image" goal. The diagnostic
   `_warp_e_border_detection.png`, the blotch overlays, and the user's
   visual feedback remain the signals.

3. **Polish: precise improvements to bring the test pixel diff down.**
   By this phase, the warp and pipeline produce correct outputs; only
   per-pixel dither alignment with the hand-corrected references
   remains. This is the right time to use `pnpm test:pipeline`'s
   matching percentage as the iteration signal.

### Non-negotiable constraint

**No hard-coding to the test image set.** The pipeline must be robust
across any phone photo of a GBA Camera screen. If you find yourself
adding "if image is 213443, do X" logic or a magic number that just
happens to fit the seven sample images, stop — that's bad. Algorithmic
fixes derived from physics, optics, or display geometry are good. The
plan from `2026-05-15-...md`'s Round 8-12 has many examples of both
classes: the BGR sub-cell pre-blur work is the "good" pattern; the
parameter-sweep tuning attempts (LAMBDA, CONTRAST_THRESHOLD, peak-search
width, valley-threshold ad-hoc fallbacks) are the "drift" pattern that
broke things.

## Current state — what works, what's still broken

### Recent commit history

```
dc16ffc diag: blotch overlay PNG + tuned defaults to catch 213443 LG / 213457 WH
71ff7be quantize: midpoint fallback for wide-span asymmetric valleys
b5201e5 plan: Round 12 — quantize G-valley smarter fallback
8a9b532 quantize: smarter G-valley fallback for wide LG-WH cluster spans
7fd6c6f plan: Round 11 — G-channel LCD-centre detection in sample.ts
56377cd sample: detect LCD pixel centre using G channel only
474a157 plan: Round 10 — blotch detector rewrite + full BGR pre-blur sweep
dcead65 warp: BGR sub-cell pre-blur for dash detection
051923a warp: BGR sub-cell pre-blur for pass-1 + pass-2 border detection
9af0cff diag: morphological-opening blotch detector for usable counts
ceb35b0 plan: Round 9 — source-corner pre-blur win + failed experiments
9a1dbfa warp: BGR sub-cell pre-blur for source-corner detection
9d53237 warp: BGR sub-cell pre-blur before border detection
debb5f2 diag: blotch detection script + warp border-detection overlay
```

### Blotch count (= warp-error proxy)

Sample-pictures-out has 9 detected blotches. 7 are real warp errors;
2 are legitimate camera content (213430 WH top + WH bottom). After
session-arc improvements:

| image | total | legit | warp errors |
|---|---|---|---|
| 20260313_213416 | 0 | 0 | 0 |
| 20260313_213430 | 2 | 2 (WH top + WH bot) | 0 |
| 20260313_213443 | 1 | 0 | 1 (LG upper-left) |
| 20260313_213457 | 1 | 0 | 1 (WH middle-left) |
| 20260313_213510 | 0 | 0 | 0 |
| 20260328_165926 | 2 | 1 (WH bot-right) | 1 (LG middle) |
| 20260328_165926~2-EDIT | 3 | 1 (WH bot-right) | 2 (LG middle + WH middle-right) |
| **total** | **9** | **4** | **5** |

Test-output has 7 blotches across 6 images: thing-1/2/3 = 0 each, zelda-poster-1/2 = 2 each (matches reference legit-pattern), zelda-poster-3 = 3 (2 reference + 1 extra WH at top-left = real warp error per the high pixel diff on that image).

### `pnpm test:pipeline` pixel diff (= polish-phase signal, not warp signal)

```
thing-1:           330  (2.30%)
thing-2:           216  (1.51%)
thing-3:           208  (1.45%)
zelda-poster-1:    264  (1.84%)
zelda-poster-2:   2038 (14.22%)
zelda-poster-3:   4016 (28.01%)
```

zelda-poster-2 + zp-3 are the major outliers; both correspond to high
warp residual + significant content-distortion.

### `_warp_e_border_detection.png` per-side metrics (= the warp signal)

Sample of the worst image (165926):

```
top   n=31 missing=2  meanBias= 0.009 maxAbsBias=0.57
bot   n=31 missing=2  meanBias= 0.005 maxAbsBias=0.34
left  n=26 missing=7  meanBias=-0.018 maxAbsBias=0.72
right n=31 missing=2  meanBias= 0.002 maxAbsBias=0.91
```

So at the detector's own resolution, the warp puts inner-border points
near canonical. **But** the user reported (Round 6 of the old plan)
that the visible 165926 top-left has **3–7 px** of real local
distortion. The detector misses 7 left-side points exactly where that
distortion lives, so TPS extrapolates linearly across that gap and
leaves the camera content nearby misclassified. Same pattern for
213443 (= 1 LG blotch from residual top-left curve).

### Sample.lcdOffset clamping ratios (= warp-vs-sample alignment)

```
213416  mean= 0.12 clamped= 0.4%
213443  mean= 0.57 clamped=21.7%
213457  mean= 0.19 clamped= 4.4%
213510  mean= 0.26 clamped= 3.6%
165926  mean= 0.22 clamped=24.4%
~2-EDIT mean= 0.24 clamped=23.9%
zp-3    mean= 0.26 clamped=16.3%
thing-1 mean= 0.12 clamped= 0.4%
```

High `clamped%` on 165926 / ~2-EDIT / 213443 / zp-3 = the warp positions
have ≥2 image-px residual error in ~20% of GB-pixel blocks. Sample's
`OFFSET_CLAMP=2` caps the compensation, leaving wrong sub-cell windows
on those pixels. **This is the central remaining warp issue.** The
warp positions perimeter dashes + inner-border points at canonical
(meanAbsBias 0.2 px), but the *interior* of the warp output drifts
by 2-3+ px in 15-25% of the pixels on the worst images.

## Diagnostics — what to look at

All live under `<image>/debug/` or `sample-pictures-out/debug/`.

| File | What it shows |
|---|---|
| `<stem>_warp_a_corners.png` | Source photo with the four detected screen corners overlaid. First thing to check if anything looks wrong. |
| `<stem>_warp_b_inner_border_residual.png` | Pass-1 inner-border R-B+128 detections overlaid on the warp. |
| `<stem>_warp_c_detection_debug.png` | Comprehensive overlay: green expected dash centroids + magenta detected dashes + green dashed inner-border outer rectangle + red border points + magenta-and-orange inner-border corners. Look here when validating "do the dashes land at canonical?" |
| `<stem>_warp_e_border_detection.png` | The actual TPS-input border detector's output: magenta crosses at each detected position, green dashed canonical rectangle, yellow lines for |bias|>1 px, cyan ticks for contrast. **This is the user's primary "is the warp right" overlay.** |
| `<stem>_gbcam_blotches.png` | The final 128×112 output upscaled 8×, with each detected blotch's pixel boundary traced in bright green. **The blotch metric is the self-feedback signal between warp changes** — anywhere a green ring shows up that's not legitimate camera content, the warp shifted pixel content into a solid-colour band that shouldn't exist. |
| `<stem>_debug.json` | All structured metrics in one place. Key keys: `warp.lensDistortion.{k1,k2}`, `warp.quadScore`, `warp.{pass1,pass2}.cornerErrors`, `warp.borderDetectionPostTps.{perSide,perPoint,nLargeBias}`, `sample.lcdOffset.{mean,distribution}`, `quantize.clusterCenters`. |

Running the standalone blotch detector: `pnpm blotch -- --dir <out>`
(adds `--overlay` to write standalone overlay PNGs next to inputs, but
test:pipeline already writes them to `debug/` automatically).

## What's been tried that DIDN'T work — don't repeat

- **Tuning LAMBDA / CORNER_FRAC / contrast threshold / peak-search
  width** — every attempt drifts. (See Round 8/9/10 in the old plan.)
- **Smooth-curve-fit (degree-2 polynomial) per side before feeding
  border points to TPS** — wipes out genuine local distortion
  (165926 top-left). Reverted.
- **TPS canonical→canonical corner anchors** — wrong semantics; pins
  the warp at canonical but doesn't move the actual visible border
  there. Made things worse.
- **TPS detected-corner→canonical anchors via the legacy
  `findBorderCorners` (R-B+128 channel)** — the legacy detector's
  BGR bias propagates back into the anchors. Neutral overall.
- **Brightness flattening for source-corner detection with a giant
  Gaussian kernel** — made one image take 55+ min. (Generally: never
  use `cv.GaussianBlur` with σ > ~30; opencv.js is not FFT-based
  for large kernels. Downsample → small blur → upsample if you need
  it. The bug came back when I tried to add a wider lens-k1+k2 search
  — same root cause.)
- **Lens k2 search using the existing dash-residual scorer** —
  every image picked k2 = 0 because the scorer measures perimeter
  dashes, and k2 affects radial distortion in the INTERIOR. A
  perimeter-based scorer literally cannot see k2's effect.
- **Swapping pass-2's `findBorderPoints` (R-B+128) with the new
  multi-channel DG-signature detector** — regressed 213443 (different
  RANSAC inlier set on a heavily-dithered image).

## What's been tried and DID work — what's there now

- **BGR sub-cell pre-blur** for: source-corner detection (9a1dbfa),
  inner-border DG-signature detection (9d53237), pass-1 + pass-2
  R-B+128 channel build (051923a), dash detection gray channel
  (dcead65). Same physics: a single sub-cell within an LCD pixel
  emits in only one channel (B-left / G-middle / R-right at scale=8);
  averaging across the LCD-pixel width before any per-channel
  detection removes the per-sub-cell bias that was offsetting every
  detector by ~1.5-3 image-px. **Same fix pattern applied wherever
  a per-channel quantity is computed from raw warp output.**
- **Morphological-opening blotch detector** (9af0cff + dc16ffc):
  7×7 opening + minArea 220 + 4-connected components after opening.
  Tuned per parameter-sweep so it matches the user's manual
  identification across the whole image set (12 sample + 6 test +
  2 reference) within ±1 detection.
- **G-channel-only LCD-centre detection in sample.ts** (56377cd):
  the prior combined-RGB centroid was content-colour-biased
  (DG-content → left-biased, LG-content → right-biased) and
  saturating OFFSET_CLAMP on solid-colour regions. G channel peaks
  at the LCD pixel CENTRE regardless of pixel colour, so the centroid
  measures pure warp alignment. **Huge improvement** on 213443
  (3 warp blotches → 0).
- **Quantize G-valley smarter fallback** (8a9b532 + 71ff7be):
  use midpoint when the histogram has no real valley between LG and
  WH cluster centres, conditioned on the cluster span. Cleaned up
  zelda-poster-2's WH↔LG confusion by ~1600 pixels without
  regressing anything else.

## Where the iteration is stuck — and the suspicion that something
## bigger needs to change

**The last many iterations have not really changed the warp much.**
The blotch count has dropped from many to 5 real warp errors, and
those 5 are concentrated in 3 photos that share a common pattern:
high `lcdOffset.clamped%` (15-25%), low post-TPS border bias (= the
detector + TPS aligns the *perimeter* to canonical), and visible
*interior* distortion that the user can see in `_warp.png` directly
(curvy borders, etc.).

This very strongly suggests that **the perimeter-anchored TPS warp
model is the limit**: it can pin the dashes and inner-border at
canonical, but the camera-area interior has no constraints and is
left to whatever the lens-k1 + pass-2 homography + TPS smoothness
prior produces. Inside the camera area, the actual warp residual is
2-3+ image-px in 15-25% of GB-pixel blocks on the worst images.

The plan-text in the old plan lists a few "untried" ideas (2D
unbiased corner detector, k2 with a non-dash scorer, iterative source-
corner refinement). These might or might not help, but **none of them
fundamentally change the warp model.** Be willing to:

- **Re-think the warp model.** Maybe perspective + radial k1 (+k2) +
  TPS isn't the right pipeline. Some directions worth thinking about:
  - **Multi-source-feature direct calibration**: detect ALL 54
    interior dashes + all 4 inner-border corners + all 4 source
    screen corners in the photo, fit a more flexible camera+screen
    model (per-feature back-projection, optimised jointly).
  - **Iterative refinement**: after a full pipeline pass, re-detect
    the source corners on the *back-projected* warp output, update
    the homography, repeat until convergence.
  - **A non-rigid warp at the SOURCE photo step**, before any
    perspective transform — e.g., detect the SCREEN's actual outline
    in the photo (not just 4 corners — the whole rectangle including
    any local bow) via edge detection, then use that as the source
    quadrilateral.
  - **Higher-DOF lens model with a scorer that sees the interior**:
    e.g., run the full pipeline once at k1=best, then for each k2
    candidate measure the *interior* `lcdOffset.clamped%` rather
    than perimeter dash residual. Slow but principled.
  - **Per-region warp** — split the photo into regions, fit a
    homography per region, blend. Or use a finer TPS grid with
    interior control points derived from the dither-pattern's
    sub-pixel periodicity.

- **Re-think the sample step.** OFFSET_CLAMP = 2 is a fundamental
  limit on how much warp residual sample can tolerate. If the warp
  consistently leaves 3-4 px residual on certain images, no amount
  of warp-only iteration helps — the SAMPLE step needs a wider
  search window AND a way to confirm it's reading the right LCD
  pixel (G-channel centroid is robust to colour but still can't
  jump 4 px if clamped). Could the LCD pixel grid be detected
  globally on the warp output (e.g., Hough on inter-pixel gaps)
  and the per-block offset map be unconditionally set from that?

- **Re-think the quantize step.** Currently the k-means cluster
  centers depend on the input image's actual RGB distribution. For
  images where the cluster centres land far from the canonical
  palette (e.g., zelda-poster-2's LG G=159 vs canonical 148, WH
  G=244 vs 255), the LG/WH boundary becomes ambiguous. Could the
  quantize step *first* estimate the per-image affine RGB transform
  back to the canonical GB palette, then do nearest-canonical-colour
  classification?

## Sequence of attack

1. **Pick one of the 3 stubborn images** (165926, ~2-EDIT, 213443)
   and trace through every step's debug output. Look at the
   `warp_c_detection_debug.png` AND `warp_e_border_detection.png`
   AND `sample_b_offset_heatmap.png` for that image. Where does the
   warp residual ACTUALLY come from? Is it lens k1 imperfection?
   Source-corner misdetection? Screen non-flatness? Form a hypothesis
   before trying anything.

2. **Try the most promising untried untried ideas** (the four
   under "Re-think the warp model" above). Validate each against
   the blotch overlay, NOT against test pixel diff. Reject any
   change that introduces new blotches anywhere — even if it
   reduces blotches elsewhere — until you've confirmed the change
   is genuinely robust on other images too.

3. **When the warp's blotch count + visible distortion is
   eliminated**, move to pipeline tuning. Don't use test pixel
   diff until the warp visibly looks correct for every image.

4. **Finally** use test pixel diff for polish.

## Practical operational notes

- `pnpm test:pipeline` takes ~5-7 min. **Set timeouts of 15 min max** —
  if it goes longer, kill it and fix what made it slow.
- **NEVER use `cv.GaussianBlur` with σ > ~30.** Use the downsample →
  small blur → upsample pattern (Round 9 has the recipe). 55-minute
  hangs trace back to this exact mistake.
- Existing 4-tap dash detection has its dashes pre-blurred. If you
  refactor it, keep the pre-blur in place.
- The pipeline test compares against hand-corrected references that
  match the OLD warp. **Pixel diff going UP during warp work is
  expected and not a regression.** Only use it during the polish
  phase.
- The blotch detector lives at `scripts/blotch-detection.ts` (library)
  and `scripts/blotch-cli.ts` (CLI). Defaults are `erodeRadius=4`,
  `minArea=220`. Don't tune them per image.

## When you're stuck

- **Ask the user a focused question** — not "what should I try next?"
  but "I see X on image Y; does that match what you see?" The user
  is the source of ground truth for what looks right. Round 8 of the
  old plan has a great example of focused feedback they gave.
- **Don't tune your way out**. If a change helps some images and
  hurts others, the change is wrong. Find the algorithmic root
  cause that makes it ambiguous in the first place.
- **The blotch overlay is the truth.** A warp change that makes a
  blotch go away on one image AND doesn't introduce a new blotch
  anywhere else is a win. A change that just shuffles them is not.
