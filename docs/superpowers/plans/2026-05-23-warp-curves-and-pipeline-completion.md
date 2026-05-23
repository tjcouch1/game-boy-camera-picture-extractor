# Warp curves + pipeline completion — handoff for subagent

> **Read this whole file end-to-end before touching code.** Then
> also read `2026-05-22-warp-rethink-and-pipeline.md` and
> `2026-05-15-warp-knowledge-transfer.md` if you want the longer
> history — but the present file is the most current source of
> truth and supersedes both.

## Mission

This pipeline turns a phone photo of a Game Boy Camera image on a
GBA SP screen into the canonical 128×112 four-colour GB Camera
image. Currently the warp step has detection / curve-fitting issues
that prevent the TPS post-correction from doing its job, AND the
remainder of the pipeline (correct / crop / sample / quantize)
hasn't been re-tuned since the warp + sample changes of the last
two sessions made things meaningfully more accurate. The user has
explicitly asked an autonomous subagent to take over from this
point.

### Goals, in order

1. **Warp.** Make the warped output (`<stem>_warp.png`) visibly
   align with the canonical 160×144 GB Camera frame on every test
   AND sample image. The user-perception signal is the
   `_warp_curve_overlay.png` produced by
   `scripts/border-curve-overlay.ts`. Reduce both the systematic
   per-side bias (= the WHOLE border being shifted vs canonical)
   AND the residual curves (= bowing inward or outward across the
   side). Don't accept "outlier-reject everything past 2 px" as a
   fix — that just hides real curves. Track per-side meanBias and
   meanAbsDev numbers honestly.

2. **Rest of the pipeline.** Re-tune correct / crop / sample /
   quantize to take advantage of the improved warp. The sample
   step in particular was tuned (in the last commits) around the
   assumption of a not-perfectly-accurate warp; with a more
   accurate warp some of those compensations may no longer be
   needed AND may be hurting accuracy on simple cases. Don't be
   afraid to change multiple steps simultaneously when their
   tunings are coupled (e.g., a smear-aware sample step + a
   canonical-anchored quantize step might both need adjusting
   together).

3. **Polish.** Use `pnpm test:pipeline`'s aggregate pixel diff as
   the iteration signal for final accuracy work. Reference images
   were authored to match an older warp; pixel diff has been
   creeping up during warp work and CAN legitimately go up — but
   once warp and pipeline are correct, polish should be able to
   bring it well into the 99.5 %+ range across the board.

### Non-negotiable constraint

**No hard-coding to the seven sample / six test images.** The
pipeline must be robust across any phone photo of a GB Camera
screen. If you find yourself adding "if image is 213443, do X"
logic or tuning a magic number that happens to fit one image's
feedback, stop — algorithmic fixes derived from physics, optics,
or display geometry are the only good pattern. The sub-cell-aware
sample step and the BGR pre-blur for border detection are
canonical examples of "good".

## Current state — start of subagent work

Starting branch: `subagent-warp-pipeline-2026-05-23`, branched
from `sample-pipeline-tuning-2026-05-23` at commit `9eb4b29`.

**Test pixel diff total: 4667** (from the `8df9cb6` "smeared
blocks pick offset by canonical distance" commit, which is what
the test outputs in this branch reflect).

**Per-image diff:**
- thing-1: 75 (0.52 %)
- thing-2: 246 (1.72 %)
- thing-3: 346 (2.41 %)
- zelda-poster-1: 429 (2.99 %)
- zelda-poster-2: 1176 (8.20 %)
- zelda-poster-3: 2395 (16.71 %)

**Sample-pictures-out blotches:** ZERO incorrect blotches. Every
sample image is at 0 or 1 blotches, and the 1's are user-confirmed
legit camera content (213430 WH top+bot, 213457 WH mid-left,
165926 WH bot-right, ~2-EDIT WH bot-right). The user-reported
LG-as-WH-misclassified upper blotches on 165926 / ~2-EDIT are
gone.

**Test-output blotches:** zp-3 still has 1 warp-error blotch (the
extra WH not in the reference pattern); zp-1/2 only show their
legit content blotches; thing-* are at 0 blotches each.

## Recent history (what worked, what didn't — most recent first)

The user-driven session arc that got us here:

| Commit | What | Result |
|---|---|---|
| `9eb4b29` diag fixes | Restrict scan to camera-area extent; FIRST-edge from outer (not max-drop); tighter criteria; 5-point-median outlier reject | Diagnostic per-side meanAbsDev dropped from 6–8 to 0.5–4. User SAW lingering issues — see "User feedback" section. |
| `8df9cb6` sample canonical-distance | For SMEARED blocks, compute BOTH sub-cell-at-detected-offset AND sub-cell-at-offset-0; pick whichever lands closer to a canonical palette colour | Total diff 6797 → 4667 (-2130). thing-3 LG-shift-right fix preserved. zp-2/3 regressions from "smeared blocks force offset 0" recovered. |
| `be186e4` smear → offset 0 | For SMEARED blocks force offset=0 (= bypass color-biased G-centroid) | Fixed thing-3 LG shift; regressed zp because zp has real warp residual that needs offset compensation. |
| `77ec247` smear-aware (peak-spread) | Classify each block as SHARP (R/G/B peaks ≥2 cols apart) vs SMEARED via peakSpread; SHARP uses sub-cell with detected offset, SMEARED uses whole-LCD-pixel averaging | Fixed 165926/~2-EDIT user-blotch. Regressed thing-2/3 on LG/DG dither. |
| `d0de24e` hybrid sample | Compute BOTH sub-cell AND whole-block samples; pick by nearest-canonical-distance | Big win on test diff but regressed 165926 on a left-side blotch. |
| `6e84ea5` whole-LCD-pixel | Replace per-sub-cell windows with whole-LCD-pixel-area mean | Fixed 165926/~2-EDIT user-blotch. Big regression on thing-2/3 LG/DG dither. |
| `a3f0a27` baseline → 3·scale outward | Pipeline detector's baseline sample moved further outward | Small improvement. |
| `9408862` widen DG-peak ±scale → ±3·scale | Pipeline detector finds deviated borders that the narrow search was missing | TL of ~2-EDIT now aligned at canonical (was 8-10 px off); LG blotches gone; -403 px diff. |
| `954831e` border-curve-overlay script | New diagnostic that catches the curves the official detector hides | Numerical confirmation of user-reported curves. |
| `ac5140b` OFFSET_CLAMP 2 → 3 | sample.ts can compensate for warp residuals up to ±3 image-px | Eliminated 213443 LG blotch. |

## User feedback — current open issues (READ CAREFULLY)

The user reviewed the latest curve overlays and identified the
following CURRENT problems. The fix the subagent does should
address ALL of these, not just one:

### Issue A — Detection only on part of border (over-aggressive outlier reject)

> "The top, right, and bottom borders have magenta crosses on only
> part of the border again instead of tracking the whole border
> end-to-end; what's going on?"

The current outlier-rejection rule in
`scripts/border-curve-overlay.ts` (`OUTLIER_MAX_DEV = 6`) and the
parallel logic in `warp.ts`'s
`detectInnerBorderThresholdCrossings` is too aggressive — when
the actual border genuinely curves by more than 6 px in a region,
the local-5-point-median calls those legitimate points outliers
and drops them. The user's explicit instruction:

> "Don't just throw out outliers and pretend there aren't issues;
> do a real diagnosis and fix the problems. You may end up
> needing to throw out a few outliers in the end, but it shouldn't
> be a whole bunch."

Find a detection method that's reliable enough to NOT need
aggressive outlier rejection. (See Issue B below — the lingering
mis-detections suggest the underlying detector is still finding
wrong things sometimes; fix that, not the symptom.)

### Issue B — zp-3 LEFT border has many spurious "way too far left" detections

> "On `zelda-poster-3_warp_curve_overlay.png`: the left border
> has many magenta crosses way too far left; like two or three GB
> pixels too far left. Approximately the top fifth are all way
> too far left. Then they're right for a bit, then they're way
> too far left again, then they're right again."

Position: GB-pixel-scale = 8 image-px, so "2–3 GB pixels too far
left" = 16–24 image-px past canonical. The user reports REPEATED
bursts of these. The current detector finds these as legitimate
"first WH→DG transition" points — but they're actually picking
up bright-WH-frame-area → dim-area transitions that aren't the
real DG strip.

Hypothesis: in those rows the WH frame's brightness gradient (=
front-light) drops below the ABOVE_MIN=200 criterion deeper out
in the frame, then the detector wanders inward past where it
should and finds a transition further inside than the actual
border. OR: the actual WH frame ends but there's some other dim
region (e.g., a row of black dashes elsewhere in the frame) that
gets confused for the DG strip.

The right fix is to **understand what the detector is locking
onto** in those rows and use a better signal — not to widen the
outlier-reject filter.

### Issue C — thing-1 regressed badly (from the now-reverted pipeline detector port)

The subagent will NOT see this regression in the test outputs
(the broken pipeline-detector port was reverted before the
branch was made). But the user-reported visible issues on
thing-1 ARE real and the existing pipeline detector
(`detectInnerBorderThresholdCrossings` in warp.ts, NOT yet ported
to luma + first-edge) does NOT detect them:

> thing-1: "right side is a few pixels too far left, and it curves
> inward more left near the bottom corner. Its top border could
> go up a couple pixels. Its left border is bowed; the corners
> are pretty well-aligned, but then it curves too far in a pixel
> or two."

So the warp on thing-1 has real residual curves that TPS isn't
correcting because the pipeline detector isn't picking them up.
The diagnostic shows similar pattern (LEFT meanBias -0.91,
maxAbsDev 2.5 — under the outlier-reject threshold so the diag
also under-reports). **The diagnostic itself needs to better
expose these subtle curves**, not just the gross 10+ px ones.

### Issue D — Right border direction was REVERSED in user's previous message

The user said:

> "Note: in my previous message, I accidentally said the right
> border detection needs to move right 1-3 pixels; it actually
> needs to move left 1-3 pixels (the border is 1-3px too far left
> in many places, so it needs to be warped to move right a bit).
> Sorry, but you may have to undo some things and rethink based
> on moving the right border left."

So the right border's detected position is currently 1–3 px too
far RIGHT of where it should be. The WARP itself has the actual
border 1–3 px too far LEFT of canonical (the WH frame's leftmost
LCD pixel encroaches inward into where DG should be). The
detector is finding the right edge of DG correctly per the luma
profile, but the **detector position needs to land at the
canonical DG outer edge, not at the WH-luma-rises point**.

This relates to the B___GR sub-cell layout on the right:
- Going inside→outside on the right border: DG B-sub-cell
  (bright B), DG G-sub-cell (dim), DG R-sub-cell (dim),
  inter-pixel gap (dark), WH B-sub-cell (dim B=165),
  WH G-sub-cell (bright G=255), WH R-sub-cell (bright R=255).
- The luma drop / rise sequence is non-monotonic in the
  transition zone. The detector finds where luma rises back to
  WH levels (= around WH's G or R sub-cell) but the actual
  canonical DG outer edge is earlier (= at WH's B sub-cell
  start).

The LEFT border has the OPPOSITE sub-cell sequence — the WH→DG
transition has WH's R-sub-cell (bright R), gap, DG's B-sub-cell
(bright B). Both bright. The transition appears sharp visually
(luma rises through dim middle to bright DG B sub-cell). Likely
not the same correction needed on the left.

### Issue E — Border detection needs to be sharper / more sensitive to subtle curves

The user-visible curves on thing-1 are 1–2 px and the diagnostic's
mean error reports them as ~0.5–1 px. The user is right that there
are real curves there, but the diagnostic doesn't make them
obvious. **Improve the curve diagnostic** so subtle deviations are
visible — e.g., a different overlay style for sub-pixel
deviations, a histogram of per-side deviations, a fitted polynomial
overlay so curve patterns stand out from noise.

## Diagnostics available

| File | Purpose |
|---|---|
| `packages/gbcam-extract/scripts/border-curve-overlay.ts` | Standalone luma WH→DG-edge detector + per-side stats. Run `node --experimental-strip-types scripts/border-curve-overlay.ts <dir>` to generate `*_warp_curve_overlay.png` for each `*_warp.png` in dir. Just had FIRST-EDGE + scan-range-restriction + 5-point-median outlier-reject improvements (commit `9eb4b29`); the outlier-reject is probably too aggressive — see Issue A. |
| `<stem>_warp_curve_overlay.png` | The diagnostic output: green dashed canonical rectangle + magenta crosses per detection + yellow polyline tracing the curve. |
| `<stem>_warp_e_border_detection.png` | The OFFICIAL pipeline detector's output (drawn by `addBorderDetectionImage` in `warp.ts`). This is what TPS actually uses. Often differs from the curve-overlay one. |
| `<stem>_warp.png` | The final warp output (1280×1152). The thing both detectors are detecting on. |
| `<stem>_warp_a_corners.png` | Source-photo with detected screen-corner polygon — useful when source-corner detection looks suspect. |
| `<stem>_warp_c_detection_debug.png` | Comprehensive overlay (dash detections + inner-border-corners + canonical positions). |
| `<stem>_gbcam_blotches.png` | Final-output overlay with green outlines around suspected misclassified blotches. **Primary self-feedback signal during warp work.** |
| `<stem>_sample_b_offset_heatmap.png` | sample.ts's per-block LCD-pixel-centre offset map (jet colormap, ±3 image-px range). Red = +offset, blue = -offset. User noticed this maps to LG-content areas — that's because the G-centroid offset detector is color-biased toward bright R sub-cells of LG. NOT a warp diagnostic; useful as "where is LG content". |
| `<stem>_debug.json` | All structured metrics: `metrics.warp.*`, `metrics.correct.*`, `metrics.sample.lcdOffset`, `metrics.quantize.clusterCenters`, etc. Use `node -e "..."` to extract specific keys. |
| `pnpm blotch -- --dir <dir>` | Standalone blotch detector (`scripts/blotch-cli.ts`); reports per-image blotch counts. |

## Strategic notes — things to think about

The user's framing for what good warp work looks like:

> "the right side is special because the border goes DG to WH
> (B___GR), so the detection is probably a bit different on the
> right side."

> "I imagine it is really hard to get accurate colors from it."

> "The four different colors are significantly distinct from one
> another, so you should be able to get quite high accuracy
> without fine-tuning to the tests."

> "You may find it helpful not to ignore nearly as much of the
> pixel (I think it currently samples 2 pixels in from each edge
> or something). You may find it helpful to adjust what you
> sample dynamically based on the sub-pixel colors you're seeing
> and how much bleed you notice."

These hints point toward sub-pixel-aware, physics-grounded
algorithms — not numerical tuning.

### LCD physics that the algorithm must respect

The SP TN-LCD has **B-G-R** sub-pixel layout (Blue left, Green
middle, Red right) at every LCD pixel. Each sub-cell emits in
exactly one channel. At scale=8 each sub-cell is ~2.67 image-px
wide:
- B sub-cell at cols [0, 2.67) of each LCD pixel
- G sub-cell at cols [2.67, 5.33)
- R sub-cell at cols [5.33, 8)

For the four canonical palette colours:
- **BK** (0, 0, 0): every sub-cell dark.
- **DG** (148, 148, 255): bright B sub-cell, dim G+R.
- **LG** (255, 148, 148): dim B+G, **bright R sub-cell**.
- **WH** (255, 255, 165): dim-ish B, bright G+R sub-cells.

So at the BORDER positions:
- Top, bottom, left inner DG strip → WH frame: the WH frame's
  brightness is dominated by its G and R sub-cells; the DG
  strip's brightness is dominated by its B sub-cell. The
  transition between them has a relatively clean luma drop with
  the LCD's natural pixel boundary at the canonical edge.
- Right inner DG → WH frame: the LAST DG pixel ends with its
  R sub-cell (dim), then inter-pixel gap (dark), then WH starts
  with B sub-cell (dim). The luma stays low through this whole
  transition zone, then rises sharply at WH's G/R sub-cells.
  The "B___GR" pattern the user described.

A luma-rise detector on the right border lands at the WH G/R
peak, which is several image-px to the right of the canonical
DG outer edge. The fix needs to detect the WH B-sub-cell start
(= the actual canonical edge) — possibly by looking for the
END of the dim transition region rather than the rise to bright.

### Sample-step changes still pending

The latest sample-step (smear-aware → pick by canonical-distance,
commit `8df9cb6`) helps for the 165926-class smeared cases but
might not be the right design for a perfectly-warped image. The
user explicitly noted:

> "Now that warp is significantly more accurate than it used to
> be when the pipeline was originally tuned, you will likely
> have more success using more detailed and more complex
> information like that the pixels are made of BGR sub-pixels,
> there is some bleed between pixels especially when you have
> dark parts between the two lighted subpixels (e.g. DG and WH go
> together as B___GR), the edge between pixels when there are
> not dark areas between the sub-pixels is sharp (e.g. WH and DG
> go together as _GRB__ so it is easier to see the transition
> between the coors)."

So a more nuanced per-block sampling that:
- Considers the COLOUR pattern (bleed model differs by adjacent
  pixel colours)
- Uses MORE of the pixel (currently vMargin=1 trims 1 row top/bot)
- Adapts per detected sub-pixel intensity pattern
…may be the right answer once warp is solid.

### Quantize-step open question

The `project-sample-color-smear.md` memory notes the LG-cluster-
snap quantize idea (snap LG cluster center back to canonical when
k-means drifts G below DG.G). It was implemented and reverted
during the warp-rethink session. With a better warp it may now
be unnecessary OR may now be the right complement to better
sampling — worth re-evaluating.

## Operational notes — things that will save you time

- `pnpm test:pipeline` takes ~5–7 min. **NEVER let it run longer
  than 15 min — kill it if so.**
- **NEVER use `cv.GaussianBlur` with σ > ~30.** opencv.js isn't
  FFT-based; large kernels are O(σ²). Use downsample → blur with
  small σ → upsample. 55+ minute hangs trace back to this exact
  mistake.
- Test pixel diff going UP during warp work is EXPECTED — the
  reference images match the OLD warp. Only use test diff as
  the iteration signal in the final polish phase. During warp
  work, use the curve overlay; during pipeline-tuning, also use
  the blotch detector.
- Sample-pictures don't have ground truth — judge them by the
  blotch detector (= no unexpected uniform-colour patches) and
  by visual inspection of `_gbcam_rgb.png`. Test-output images
  DO have references.
- Two ~2-EDIT and ~165926 share the same scene (the EDIT was
  added later as a recropped version of 165926; both should
  produce visually identical outputs apart from the recrop
  affecting source-corner detection).
- The pipeline test compares against hand-corrected references
  in `test-input/`. The references match the OLD warp's pixel
  positions; pixel diff going up after a warp improvement is
  not necessarily a regression.

## Sequence of attack (suggested)

1. **Look at the diagnostics for the user-flagged images first.**
   `node --experimental-strip-types scripts/border-curve-overlay.ts
   ../../test-output/zelda-poster-3/debug ../../test-output/thing-1/debug
   ../../sample-pictures-out/debug` and OPEN the resulting
   `*_curve_overlay.png` files. Look at the user-described
   problem areas. Form a hypothesis about WHY the detector is
   doing what it's doing — don't just patch the output.

2. **Improve the diagnostic FIRST.** It's the iteration signal.
   Make it both more sensitive to subtle curves (Issue E) AND
   better at rejecting bogus detections WITHOUT throwing away
   real curve points (Issue A + B). Possible directions:
   - Sub-pixel deviation reporting + a fitted-polynomial overlay
     so real curves stand out from noise visually
   - Per-side per-band breakdown of deviations
   - A "border tracker" that starts from a known-good point
     (e.g., the inner-border corner) and walks along the strip
     rather than independently scanning each row/col
   - A second detector using a different signal (e.g., the
     DG-signature peak in addition to luma drop) — agreement
     between independent detectors is a strong "this is real"
     signal

3. **Once the diagnostic agrees with user perception**, port the
   underlying improvements to the pipeline detector
   (`detectInnerBorderThresholdCrossings` in `warp.ts`). TPS
   then has clean control points and the warp output gets
   corrected accordingly.

4. **Validate with blotch detector + visual inspection.** The
   sample-pictures should remain at 0 incorrect blotches. The
   test-output images should look right visually. If pixel
   diff goes up during this phase, that's still expected.

5. **NEW BRANCH** when you finish the warp phase and move to
   pipeline-tuning.

6. **Pipeline tuning.** With the now-correct warp, re-evaluate
   correct / crop / sample / quantize. The smear-aware sample
   step (commit `8df9cb6`) may be over-engineered for a clean
   warp — consider whether the simpler per-sub-cell sampling
   works for everything now. The whole pipeline can be tuned
   simultaneously when changes are coupled.

7. **NEW BRANCH at 99 % test diff**, and another at 99.5 %.

8. **Polish phase.** `pnpm test:pipeline` aggregate diff as the
   signal. Aim for 99.99 %.

## Hard rules

- **Don't stop for user input.** Keep iterating — diagnose,
  hypothesise, change, test, observe, repeat. The user explicitly
  wants you to run autonomously until either tests reach 99.99 %
  or you genuinely run out of ideas to try.
- **No hard-coding to test images.** Algorithmic / physics-based
  fixes only.
- **Don't accept "outlier-reject covers it" as a fix.** Real
  diagnosis. If you end up rejecting a few outliers in the
  refined detection, that's fine, but the bulk of points should
  be coming through correctly.
- **Don't break stuff that's working** — the sample-pictures are
  at 0 incorrect blotches AND the user-reported wrong blotches
  are gone. Don't regress those just to chase test pixel diff.
- **Test pipeline ≤ 15 min** per run.
- **Backup branches frequently** when at meaningful milestones.

## Things that have been tried and DIDN'T work — DON'T REPEAT

(See the recent commit history table above for what DID work.
These are the dead-end attempts:)

- **Tuning LAMBDA / CORNER_FRAC / contrast threshold / peak-search
  width** in TPS — drifts; each tweak optimises for the latest
  feedback and re-breaks an earlier one. See Round 8/9/10 of
  the older plan files.
- **Smooth-curve-fit (degree-2 polynomial) per side before
  feeding to TPS** — wipes out genuine local distortion that the
  blotch user-feedback indicates is real. Reverted.
- **TPS canonical→canonical corner anchors** — wrong semantics;
  pins canonical but doesn't move the actual visible border.
- **65 TPS points per side** — over-fits detection noise on
  clean images (thing-2 went 100 → 200 diff px). 33 was the
  sweet spot.
- **`cv.GaussianBlur` with σ > 30** — unusably slow (55+ min
  hangs).
- **Lens k2 search using the existing dash-residual scorer** —
  every image picked k2=0 because perimeter dashes can't see
  k2's interior effect.
- **Per-pixel "force offset 0" sample step** — fixed thing-3 LG
  shift but regressed zp (which has real warp residual that
  needs offset compensation). The smear-aware path is the
  current resolution.

## When you're stuck

- **Add a new diagnostic** rather than guessing. The
  border-curve-overlay was the breakthrough of the last session;
  similar targeted diagnostics for sub-pixel content (e.g., per-
  block sub-cell intensity heatmap, per-row brightness profile
  visualiser) could unblock the next.
- **Branch off and try a major redesign** if you've hit
  diminishing returns on incremental fixes. The user explicitly
  said "Make bigger changes if you need to. If it comes down to
  it, you could start completely over with a total
  reimplementation of the warp."

## Files of interest

| Path | Why |
|---|---|
| `packages/gbcam-extract/src/warp.ts` | 3700+ lines, the warp logic. Key functions: `detectInnerBorderThresholdCrossings`, `applyTPSDashCorrection`, `findEdge` inside the threshold detector. |
| `packages/gbcam-extract/src/sample.ts` | Sample step with smear-aware logic (commit `8df9cb6`). |
| `packages/gbcam-extract/src/correct.ts` | Brightness correction (post-warp). Hasn't been touched in a while. |
| `packages/gbcam-extract/src/quantize.ts` | Classification step (k-means + strip-ensemble + G-valley). |
| `packages/gbcam-extract/scripts/border-curve-overlay.ts` | The diagnostic the user iterates on. |
| `packages/gbcam-extract/scripts/blotch-detection.ts` + `blotch-cli.ts` | Blotch detector. |
| `supporting-materials/Frame 02.png` | 160×144 reference frame image, exact canonical structure. |
| `supporting-materials/frame_ascii.txt` | ASCII version of the frame. |
| `AGENTS.md` | Project conventions and pipeline description. |
| `docs/superpowers/plans/2026-05-22-warp-rethink-and-pipeline.md` | Previous session's handoff doc. |
| `docs/superpowers/plans/2026-05-15-warp-knowledge-transfer.md` | The longer prior history. |
