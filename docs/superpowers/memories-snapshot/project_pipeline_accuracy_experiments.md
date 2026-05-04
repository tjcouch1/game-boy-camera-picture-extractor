---
name: Pipeline accuracy experiments — failed approaches
description: Lessons from failed experiments in the 2026-04-28 pipeline-accuracy plan; informs B-channel and target-anchored redesign
type: project
originSessionId: 4544ebc0-8e36-4a50-bf9f-5a0ea7c16cc8
---
While executing `docs/superpowers/plans/2026-04-28-pipeline-accuracy.md` on the
`accuracy` branch (baseline aggregate test error: 111 different pixels),
two large experiments regressed badly and were reverted. The lessons below
are what to revisit before retrying them.

## B-channel bundle (Task 4 in the plan) — REVERTED

**What was tried:** real per-pixel affine B-channel correction (target frame
B=165, target DG B=255) plus B-axis tie-breaker in quantize for borderline
LG↔DG pixels (R∈[170,230], B≥201.5 → DG, B<201.5 → LG).

**Result:** aggregate jumped to 2281 (vs 111 baseline). On `zelda-poster-1`,
framePost B=255 instead of the expected 165; B-tie-breaker reclassified 1037
pixels (the entire confusion volume), all wrong.

**Root cause:** the plan and design doc assumed B values would land cleanly
near the design-time targets after the front-light is removed. In reality,
the front-light's *colour* shifts B systematically, and the direction varies
by image:

- On `zelda-poster-1` (blue front-light cast), raw frame-strip B is
  191–255 (median **254**) and raw inner-border B is 211–243. So the
  observed white-surface B is *higher* than the observed dark-surface B,
  while the *target* span is negative (165 − 255 = −90). My
  `applyCorrectionChannel` gated `safeObservedSpan` to the target sign,
  which forced `gain ≈ −5/−90 ≈ 0.056` — extreme over-correction that
  pushed every frame B to clip at 255.
- The new image `20260328_165926` (yellow cast) had framePost B=195 with
  passthrough — moderately off-target but not catastrophic.

**Other contributing factors:**
- `collectWhiteSamples` uses `gbBlockSample(..., 85)` (85th percentile per
  block) and filters to `>0.75 * median`. For B on these images that gives
  median 254, so the "white sample" of B is the *frame* + everything
  brighter — not what the design assumed.
- The B-axis tie-breaker is fed *uncorrected* sample-step B values (since
  passthrough is in effect at sample time too). Even if R were borderline,
  the raw B for an LG pixel could be anywhere from 130 to 220 across
  images, so a fixed 201.5 midpoint can't separate LG from DG without
  per-image normalisation.

**What to try next (design notes for redesign):**
1. **Don't model B as another affine surface with frame/border anchors.**
   The frame and inner border don't reliably differ in B after the
   front-light. Either:
   - (a) Model B as global per-image offset/scale so observed median →
     known target median, and let the polynomial absorb the gradient only
     after the global shift.
   - (b) Use an *image-specific* white-vs-dark B reference. E.g. fit a
     2-cluster model on B values in the frame strip (dashes vs frame) to
     anchor low-B (dashes ≈ 0) and high-B (frame ≈ 165), since dashes
     are present and unambiguous.
   - (c) Skip B correction entirely and instead derive a B-discriminator
     *per image*: compute the median B of pixels k-means classified as DG
     vs LG, and use the midpoint of those medians as the tie-breaker
     threshold. Fully drift-relative, no fixed 201.5.
2. **Validate before applying.** Before any B-correction commits, dump
   `whiteSurfaceB`, `darkSurfaceB`, and `framePostCorrectionP85.B` for
   *all* 6 reference images and the new sample. The bundle commit
   shipped despite framePost B=255 on zelda-poster-1, because the plan's
   pre-flight didn't check pre-revert.
3. **The B-axis tie-breaker is conceptually correct** (107-unit DG/LG
   gap, independent of R/G) but needs a per-image threshold, not the
   fixed 201.5.

## Target-anchored decision boundaries (Task 3 in the plan) — REVERTED

**What was tried:** override k-means labels with fixed midpoints from the
palette targets (R=201.5 for DG/LG split, G=201.5 for LG/WH split). Two
variants:
- Unconditional override on non-BK labels: aggregate **1695**.
- Plan's gated version (override only when `bestDist/secondDist > 0.6`):
  aggregate **675**.

**Root cause:** legitimate cluster drift. On the 6 reference images,
k-means cluster centers shift due to image content (e.g., LG cluster lands
at R≈220 instead of 255). The cluster-midpoint between drifted DG (R≈140)
and LG (R≈220) is R=180. The target midpoint is R=201.5. Pixels with R
between 180 and 201.5 are correctly LG by the data but get reclassified
as DG by the override. This causes thousands of false flips on bright
content.

**Tension between plan's test and plan's implementation:** the plan
included a unit test that constructed clusters at LG=210/DG=130 and
expected a pixel at R=200 to be reclassified as DG. With the gated
implementation `bestDist/secondDist = 10/70 = 0.14 < 0.6`, the gate
*correctly* skips the pixel, so the test fails. The test only passes
under unconditional override. So the plan's test and gated implementation
contradict each other.

**What to try next:**
1. **Drift-conditional override.** Only apply target midpoints when the
   k-means cluster has drifted *toward* the boundary (e.g., LG.R < 235
   means LG cluster is pulled in). When clusters are well-anchored, keep
   k-means.
2. **Per-cluster soft anchor (Q3 in plan, Task 9).** Snap k-means centers
   that drift more than DRIFT_MAX from target back toward the target. This
   is the milder version and is still a pending experiment.
3. **The new image (20260328_165926) is the use case** the override was
   designed for — its WH cluster sits at G=197 (drifted ~58 from 255).
   The 6 test images don't have this kind of drift, so they regress
   under any aggressive target-anchored rule.

## What worked

Final aggregate: 111 → **76** (-35, ~32% reduction). Six commits landed:

1. **Q1 — G-valley safety clamp** (Δ0). Prevents a degenerate case
   where the valley search collapses on whCenterG when WH has few
   samples. New image valley threshold 196 → 188.
2. **X1 — drift diagnostics** (Δ0). Log-only; surfaces drift on the
   new image (BK/LG/WH all drifted >40 RG-units; B off-target by 90).
3. **S1 — 20% trimmed-mean per sub-pixel column** (Δ-2). Drops
   inter-pixel dark gaps and bright bleeds from the per-block mean.
4. **C-extra-2 — per-channel scale to land frame post-correction on
   target** (Δ0). R/G already on-target; B drops 195→166 on the new
   image. No test impact (quantize ignores B).
5. **C1 — skip iterative refinement on cameraMeanR > 160** (Δ-16).
   Biggest single win. The plan expected refinement to help on most
   images and only hurt on bright-heavy ones; in practice it was net
   harmful on every reference image. Threshold 160 disables refinement
   for all 6 references (cameraMeanR ∈ [160, 185]). Very dark content
   would still get refinement.
6. **S3 — vMargin default 2 instead of 1 at scale=8** (Δ-17). Skip
   2 rows top+bottom of each 8×8 block. Inter-row gaps were still
   bleeding into the previous 1-row margin. Tried vMargin=3, much
   worse (loses too much signal).

## What's still broken on the new image (20260328_165926)

Per-image final state on the new image:
- WH cluster: still at G=198 (target 255, drift -57). Few true-WH
  pixels on this image so k-means pulls WH cluster down toward the LG-
  ish bulk.
- G-valley refinement still demotes ~1569 pixels WH → LG (was 1591
  at baseline). The safety clamp only helps marginally because the
  problem is the cluster center itself, not the valley search.
- Final counts: LG=5782, WH=2790 — the "pink blob" the user observed
  is largely still present.
- framePost B post-correction is now 166 (target 165) — that part is
  fixed, but B is still uncorrected upstream of sample, so it doesn't
  affect quantize.

Tier 4-5 escape hatches (S2 sub-pixel auto-detect, S4 vertical bleed
deconvolution, S5 luminance-first quantize, X2 synthetic stress) were
left unattempted because the work has natural follow-ups in the failed
experiments above. To hit aggregate=0, the redesign should focus on
either: (a) fixing the WH cluster drift on bright/sparse-WH images,
(b) a B-aware quantize that doesn't depend on the broken assumption
that frame B < border B in raw values, or (c) target-anchored
boundaries that activate only when k-means has measurably drifted.

## 2026-05-01 update: Phase B (3D RGB quantize) — REVERTED again

Per `docs/superpowers/plans/2026-05-01-color-cast-separation.md`, Phase A
(global per-channel white-balance pre-step) landed cleanly: frame median
hits exact target (255,255,165) on all 7 images, aggregate 76 → 157
(+81, within phase budget).

Phase B (3D RGB k-means) regressed catastrophically: aggregate 157 → 5955
(+5798), thing-1 alone went 49 → 5867. Reverted.

**Why B-channel approaches keep failing — root cause now understood:**

The GBA SP front-light's blue cast doesn't just shift B values
multiplicatively — it pushes raw B *to the sensor's clip ceiling* on
both frame pixels (true B=165 → observed 234) AND DG pixels (true
B=255 → observed 255 clipped). On post-Phase-A balanced output, both
end up near B=165 because the rescale can't unsaturate.

Concrete data on thing-1:
- Pre-balance frame B median: 234. DG B (clipped) raw: 255.
- After balance scaleB=0.66: frame B → 165 ✓, DG B → 168 (cannot
  reach target 255).
- Sample-step B range on thing-1: 59–168 (full range, max 168).

So on blue-cast images **B is structurally uninformative for DG/non-DG
discrimination**, no matter what downstream step uses it. The 3D
k-means then split the heavy DG cloud (60% of thing-1's pixels) across
two cluster centers because it had nothing meaningful to separate
DG from LG along, and labelled ~3500 reference-DG pixels as LG.

On yellow-cast images (e.g. 20260328_165926: scaleB=0.82), B IS
recoverable because raw B never saturated. So 3D RGB *might* work for
those — but at a 5800-px cost on test images.

**Future approaches that DON'T inherit this failure mode:**

1. **Per-image B-informativeness gate.** Before clustering, check
   raw B distribution. If raw frame B median > ~240 (cast-saturated),
   use 2D RG. If < 240 (yellow-cast or similar), use 3D RGB.
2. **Weighted 3D where the B weight is data-driven.** Set the B
   distance weight proportional to (1 - raw_B_clipping_ratio) so
   blue-cast images approach 2D-RG behaviour and yellow-cast benefit
   from B information.
3. **Phase C-style per-image affine RGB transform** — but the same
   B-saturation issue applies: the affine fit to frame anchors will
   collapse all clipped B values to the frame target, destroying any
   DG-from-frame B distinction. Phase C as designed in the plan does
   not solve this on blue-cast images either.
4. **Use a different signal for DG/LG separation on blue-cast images
   specifically.** E.g., examine the spatial structure (DG and LG
   typically have different texture statistics in real photos).

**Plan status:** Phase A committed (white-balance pre-step). Phase B
reverted. Phase C not entered (its plan precondition is Phase A+B
aggregate ≤ 50, not met). Phase D not entered. Aggregate stays at
157 (was 76 before Phase A, but Phase A's structural correctness is
worth the +81 cost — sample-step now lands at exact frame target,
which any future Phase B-replacement can build on).

## Bigger-picture observations

- Plan tasks that affect *quantize* are highly sensitive to existing
  cluster drift: any change that "fixes" the new image easily regresses
  the test images. A per-image drift-detection gate is probably needed
  before any quantize change can land.
- The 6 reference test images are remarkably *consistent* with each
  other (clusters near targets) and the new image is an outlier. Tuning
  on the test images may not transfer; tuning on the new image likely
  regresses tests. A two-population evaluation (well-behaved set + new
  image set) would help.

## 2026-05-02 update: warp-precision track is unviable

Per `docs/superpowers/plans/2026-05-02-warp-precision-and-conditional-b.md`,
both warp-improvement phases failed under the existing pipeline:

### Phase 2.1 — dash-detection helper (committed)

`detectDashesOnWarp()` uses a **dark-weighted centroid** (not argmin)
of grayscale values, threshold 130, over a y-band of ±0.75 GB pixels
around the expected dash row. Argmin within a 5-GB-pixel-wide flat
dash interior is unreliable; centroid is robust. 100% detection on
54 interior dashes per image; 5/6 images ≥ 90% within 1 SP pixel.
Reliable enough for use as anchors.

Dash centre positions must come from `supporting-materials/Frame 02.png`
(the ground truth) directly — `frame_ascii.txt` rounds to integer
char positions and is off by ~0.5 GB pixel for some dashes. Note
that LEFT and RIGHT vertical dash y-positions are *asymmetric* in
the reference (left at {19.5, 29.5, …}, right at {15, 24.5, …}).

### Phase 2.2 — dash-anchored homography refinement (REJECTED)

Replacing pass-2 back-projection with a least-squares findHomography
over 4 corners + 54 dashes (RANSAC, threshold 4 image-pixels)
regressed aggregate 157 → 323. 3 of 6 images regressed by > 30 px
(thing-2 +75, zelda-poster-1 +73, zelda-poster-2 +49). maxCornerErr
got worse on 5/6 images.

**Why:** the existing pipeline depends on inner-border alignment
(correct.ts samples the frame strip and inner-border band; sample.ts
crops at fixed GB-pixel positions). Dashes are far from the inner
border, so anchoring on them pulls the homography away from
inner-border-tight alignment. Even though dashes are detected
correctly, their slight per-position biases (anti-aliasing,
sub-pixel rendering) average into a small global twist that the
inner-border-only fit avoided.

### Phase 3.1 — per-image lens-distortion correction (REJECTED)

Search k1 ∈ [-0.20, +0.05] (coarse step 0.025, fine step 0.005),
score by sum of |inner-border curvature|, apply best. Chosen
k1 ranged from -0.01 to -0.02 (mild barrel) on all 6 reference
images. Geometric metrics improved on every image:

  Image           old maxCorn  new   old meanCurv  new
  thing-1         1.99 → 0.83        1.53 → 0.29
  thing-2         0.85 → 1.09        0.60 → 0.33
  thing-3         1.10 → 1.20        0.65 → 0.41
  zelda-poster-1  1.82 → 1.02        0.75 → 0.63
  zelda-poster-2  1.91 → 1.20        0.89 → 0.60
  zelda-poster-3  1.92 → 1.65        0.87 → 0.49

But aggregate regressed 157 → 216 (thing-2 +43, thing-3 +17,
zelda-poster-3 +25). Mean curvature met < 0.5 on 4/6 images
(zelda-poster-1 and -2 stayed at 0.6+).

**Why:** undistortion shifts every pixel by a small amount, and
correct/sample/quantize are tuned to the existing geometry. The
lens fix straightens visibly bowed borders but moves sample
windows slightly off the LCD sub-pixel grid — per-pixel
misclassifications outweigh the geometric gain.

### Implication for future work

Phase 6 (frame-anchored colour correction) is gated on
maxCornerErr ≤ 1.0 image-px AND meanEdgeCurv ≤ 0.5 on every image,
which neither Phase 2 nor Phase 3 can deliver without regressing
aggregate. Phase 6 is **out** for this design.

The warp-track lesson is: **geometric warp accuracy is not a
free lever**. Pipeline downstream is tuned to specific pixel
offsets in the warped output. To ship a warp improvement, you'd
need to re-tune correct/sample/quantize *simultaneously*, which
is beyond a single-phase change.

If revisiting later: bundle warp + correct + sample changes into
one phase, accept a transient aggregate regression, and iterate
to recover.

## 2026-05-02 update: Phase 4 (conditional 3D quantize) landed; Phase 5 (B correction) infrastructure-only

### Phase 4.1 — conditional 3D RGB quantize (committed, Δ-4)

Gate: `useB = rawFrameMedianB(post-warp pre-WB) < 240`. When useB,
re-run global k-means in 3D RGB with init centres derived from data
(B percentiles per 2D-pass label: BK=p10, DG=p70, LG=p30, WH=p50)
and a data-derived target B for DG (median raw B of DG-labelled
pixels). Cluster-to-palette assignment uses 3D Euclidean distance.
Strip ensemble + valley refinement still 2D RG.

Surprise: gate triggers useB=true on **4 of 6** reference test
images, not just the new yellow-cast image. Their raw B medians
sit at 211–225 (between the design's "blue clipped at 240" and
"yellow recoverable at 187"). Phase 4 gives Δ−1 to −2 on each of
these without regressing the truly blue-cast images
(thing-1 rawB=250, zelda-poster-1 rawB=254 — useB=false,
byte-identical to pre-Phase-4).

The earlier failure of universal 3D RGB quantize (`accuracy-big`
Phase B, Δ+5798) was driven specifically by sensor B saturation on
the rawB ≥ 240 images. The conditional gate avoids this. Aggregate
158→153.

### Phase 5.1 — B-channel correction (committed, Δ0)

Adds `correctB?: boolean` to correct(), wired to the same `useB`
gate. When enabled, runs the existing per-pixel affine machinery
on B with role-swapped surfaces ("white" = inner-border B with
target 255, "dark" = frame B with target 165, since post-WB
DG.B = 255 and frame B = 165). Per-pixel pathology check:
`min(borderSurface[i] − frameSurface[i]) < 5` aborts and falls
back to passthrough.

Result: pathology fires on **every** useB=true image, including
the new yellow-cast 20260328_165926. min(border−frame) ranges
from −17 to −31 across these. The smoothed surfaces (degree-2
poly for frame, Coons patch for border) overlap somewhere on
every image — even when median border B is clearly above median
frame B, the *surfaces* are not.

**Design implication:** the existing per-pixel-affine machinery
is unsuited for B even on yellow-cast images. Future B correction
should use a global scale-only model
(`scale = 255 / median_border_B`, applied uniformly), not a
per-pixel surface fit. Or constrain the surface fits so
borderSurface > frameSurface analytically.

### Final state of plan 2026-05-02

  Phase  Status         Aggregate
  ----   ----           ---------
  1      committed      157  (baseline)
  2.1    committed      157  (helper only — dash detection)
  2.2    REJECTED       —    (Δ+166 if kept; reverted)
  3.1    REJECTED       —    (Δ+59 if kept; reverted)
  3.2    skipped        —    (would deepen 3.1's trade-off)
  4.1    committed      153  (Δ−4)
  5.1    committed      153  (Δ0; pathology fires; infrastructure only)
  6      OUT            —    (gated on warp; 2.2/3.1 rejected)
  7      skipped        —    (depended on 6)
  8      pending        153  (needs user reference)

**Net delivered:** Δ−4 from plan-baseline 157 → 153, plus
robust dash-detection helper, warp-residual diagnostic metric,
B-saturation gate + 3D quantize path infrastructure.

### Reusable insights for future plans

- Dash detection: dark-weighted centroid, threshold 130, never argmin.
- Dash positions: extract from `Frame 02.png` directly. Left and
  right Y positions are *asymmetric* in the reference.
- Warp-changes that improve geometric metrics often regress
  aggregate because correct/sample/quantize are tuned to the
  existing geometry. Bundle changes if attempting again.
- For B correction on yellow-cast images: the per-pixel surface
  approach used for R/G doesn't generalize. Use global scale.

## 2026-05-02 update: architectural restructure (plan 2026-05-02-architectural-restructure)

After the user reported the new image's bottom-middle quadrilateral
was misclassified as LG when it should be WH, diagnostic per-block
column inspection revealed that R1's bug was a *warp/sample
alignment* issue, not a quantize cluster drift:

**The sub-pixel windows in `sample.ts` (B=[1,3) G=[3,5) R=[5,7))
assumed perfect LCD-pixel-to-GB-pixel grid alignment.** On the new
yellow-cast image with strong lens distortion, the LCD pixel grid is
shifted half a GB pixel from where the warp expects, so the G window
samples the *LCD inter-pixel gap* (cols 2-3 dark) instead of the G
sub-pixel (cols 4-5 bright with G=255). Result: G ≈ 140 for what
should be G = 255 white pixels, classified as LG instead of WH.

### Bundled fix: warp + sample co-design

Plan rejects the prior plan's "individual-phase rejection" pattern.
Bundles changes that depend on each other so the implicit contract
between steps stays consistent.

**R1.1 (committed):** per-block sub-pixel offset detection in
sample.ts. Find LCD pixel centre via intensity-weighted centroid
(weight = max(0, gray − mid_threshold)) over column-mean profile.
Smooth per-block offsets with a 5×5 median filter (rejects detection
outliers on dark blocks). Clamp to ±2. Cross-block sampling allowed
when shifted windows extend past block bounds.

**R2.2 (committed):** lens distortion (k1) correction + multi-anchor
homography. Pre-warp lens correction with k1 search ([-0.20, 0.05],
coarse 0.025, fine 0.005). Pass-2 replaced with weighted homography:
4 corners (×5 weight) + 36 inner-border points (×2) + 54 dashes
(×1), RANSAC threshold 3 image-pixels.

**R3.1 (committed, infrastructure-only):** global B-scale model
replaces per-pixel surface fits for B. Pathology check fires on
every image because post-WB border B is *below* frame B (sensor
clipping inverted the relationship even on the yellow-cast image).
The infrastructure is correct but doesn't activate.

**R4.1 (committed):** drift-conditional cluster anchoring in
quantize. Snap centre to palette target when distance > 30 RG-units
AND cluster fraction < 10%. Reassigns labels by nearest snapped
centre. Helps when a cluster's representation is too sparse to
anchor its own centre in k-means.

**R5 (skipped):** iterative correct↔quantize doesn't address the
remaining residual (sample-step over-shift, not correct.ts).

**R6.1 (committed):** sub-pixel offset deadband. Apply offset only
when |smoothed_offset| > 0.75. Suppresses small detection drift on
well-aligned test images while preserving decisive shifts on the
distorted new image.

### Outcome

Primary metric (new image user-quadrilateral WH%):

  Pre-plan      0.3% WH (essentially 100% LG, the bug)
  Post-R1.1    95% WH
  Post-R2.2    99% WH
  Post-R6.1    97% WH (slight regression for test-aggregate gain)

Test aggregate:

  Pre-plan         153 px
  Post-R6.1       2414 px

The ~2261 px test-aggregate regression is dominated by zelda-
poster-3 (1850 px, 1898 of which are output-WH/reference-LG). On
that image, the LCD grid mean offset is +0.54: many blocks fall
just outside the deadband and shift by +1, pushing borderline LG
pixels into WH cluster space.

### What this proves

1. The new image's "bottom is LG instead of WH" was an *upstream
   sampling* bug, not a quantize cluster bug. Cluster anchoring
   (Phase 4 from prior plan, R4 here) doesn't help when the input
   to k-means is already wrong.
2. LCD pixel grid alignment with the warp's GB pixel grid is the
   binding constraint for any "wider-image" pipeline. Test images
   happen to have well-aligned grids; the new image doesn't.
3. Per-block sub-pixel detection trades test-image precision for
   harder-image robustness. The trade-off cannot be fully
   recovered with a global threshold tweak — needs a per-image
   confidence model (e.g., use single global offset when
   per-block variance is low, per-block when variance is high).

### Remaining work / ideas for future plans

- **Per-image LCD offset confidence model.** Compute per-block
  offset variance; if low, use a single per-image offset (avoid
  perturbing well-aligned images). If high (new image), use
  per-block.
- **Lens correction stronger for test images.** Test image
  k1 = -0.01 to -0.02 (mild). New image needed only -0.01.
  Maybe k1 search isn't fitting the test images well.
- **Hand-corrected reference for new image.** User decision-
  point; currently no test feedback for the new image.
- **Re-tune correct.ts surface fits** post-R2 warp changes —
  observed inner-border position is now slightly different.
