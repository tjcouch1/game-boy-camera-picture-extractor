# Pipeline Accuracy — Design

**Date:** 2026-04-28
**Status:** Draft, pending user review

## Goal

Improve the TypeScript pipeline (`packages/gbcam-extract/`) so that:

1. All 6 test images in `pnpm test:pipeline` reach **0 different pixels** (currently 5–43 errors per image, all FAIL).
2. The new bright/yellow-tinted sample `sample-pictures/20260328_165926.jpg` produces a faithful output: mostly black in the top-left, mostly white in the bottom third, no large LG (light-gray, displayed pink) bands or DG (dark-gray, displayed blue) bands in regions that should be WH (white).
3. The pinkish/purplish saturation in the `_sample.png` debug images (e.g. `20260313_213510_sample.png`) is reduced to roughly grayscale-with-mild-tint — still per-channel sub-pixel data, but no oversaturation from over-amplified correction.

This is an **experiment-driven** plan — a menu of candidate changes, ordered by expected leverage, with the expectation that no single change is a silver bullet and that we will land several together.

## Acceptance Criteria & Measurement

### Quantitative (primary)

- **`pnpm test:pipeline` aggregate error count** across the 6 reference images.
  - Baseline (this branch, 2026-04-28): **111 different pixels total** (18 + 43 + 11 + 5 + 20 + 14).
  - Pass condition: **0 different pixels on all 6 tests.**
  - Per-experiment acceptance: aggregate error count must improve, OR be roughly flat while measurably improving the new bright image qualitatively. A small regression on one image is acceptable if the aggregate net is favorable. Adventurous batches are allowed to regress further if the user judges the direction is right; we keep the commit so it's revertible.

### Qualitative (secondary)

- **`20260328_165926.jpg`** — the new bright/yellow-tinted image. Inspected via `pnpm extract` against `sample-pictures/`. Looking for:
  - Bottom third predominantly WH (yellow in `*_gbcam_rgb.png`).
  - Top-left predominantly BK (black).
  - No spurious LG (pink) blob in the lower-middle.
  - Frame post-correction p85 close to `R255 G255 B165`.
- **`20260313_213510.jpg`** — representative of the over-saturated `_sample.png` issue. Inspected for whether the sample image looks closer to neutral grayscale-with-mild-tint vs. heavily-purple.
- One additional existing sample inspected each pass to make sure we haven't broken the "easy" cases.

### Workflow per experiment

For each item in the experiment menu:

1. Implement the change as a focused diff. No unrelated refactors in the same commit.
2. Run `pnpm test:pipeline` from `packages/gbcam-extract/`. Record the per-image error count and the aggregate.
3. Run `pnpm extract -- --dir ../../sample-pictures --output-dir ../../sample-pictures-out` and visually inspect the three named samples.
4. Decide: keep, drop, or iterate. If keep — commit with a message describing the experiment and its measured effect (commit subject: `experiment(<step>): <change> — <Δerrors>/<aggregate>`).
5. If drop — `git restore` and move to the next item.
6. Bundles (e.g. the B-channel bundle) land as a single commit.

Commit-per-experiment lets us bisect and revert cleanly if a later change interacts badly.

## Failure Analysis (current state)

Grounded in the diagnostic JSON and logs from this branch.

### Test images: LG↔DG confusion dominates

`thing-2` is the worst case (43 errors, 99.70%). Its confusion matrix:

```
LG  ->  DG : 40 px
DG  ->  LG :  2 px
DG  ->  BK :  1 px
```

`zelda-poster-1` (5 errors): all 5 are `LG -> DG`. Across all 6 tests, the dominant confusion is **LG↔DG**.

DG and LG share the *same* G target (148) — they differ only on R (148 vs 255). The current decision boundary is the cluster-center midpoint on the R axis, which drifts when content is unbalanced. **The B channel is not used in quantize at all**, even though DG has B≈255 and LG has B≈148 — a 107-unit separation in B equal in magnitude to the R separation, and *independent* of it. Using R and B jointly gives a roughly √2× larger decision margin than R alone, which is the structural reason adding B should cut the dominant LG↔DG error.

### `20260328_165926.jpg`: G-valley refinement is actively harmful

From `20260328_165926_debug.json`:

- LG cluster center: `(R223, G119)`
- WH cluster center: `(R244, G197)`
- G-valley threshold: **`196`** — *exactly* the WH cluster's G center.
- 1591 pixels demoted from WH→LG by valley refinement.

The G-valley function searches `[lgCenterG+1, whCenterG]` starting from the upper 2/3. When the WH cluster's G is unusually low (because the image has few "true white" pixels), the valley search collapses against the upper boundary and the threshold becomes the WH center itself — pushing roughly half of WH back into LG.

This is the single biggest cause of the LG-blob the user observed in the bottom of the new image.

### `20260328_165926.jpg`: cluster centers far from targets

Targets: BK=(0,0), DG=(148,148), LG=(255,148), WH=(255,255).
Actual cluster centers: BK=(65,23), DG=(150,140), **LG=(223,119)**, **WH=(244,197)**.

WH is 70+ G-units below target. K-means is doing what k-means does — minimizing within-cluster variance — but on this image, the WH cluster has few samples and gets pulled down toward the LG-ish bulk. The decision boundary is then drawn through a region that should be WH, mis-labeling everything.

### Correct step: narrow gain → over-amplification on bright images

For the new image, white surface R=178–242, dark surface R=106–194. Locally `gain = (white - dark) / (255 - 148) = (242 - 194) / 107 ≈ 0.45`. Small denominator amplifies any noise in the gradient model. The "before/after" debug image shows the correction visibly *increases* color saturation rather than just normalizing brightness — consistent with over-amplified affine correction in a low-gain regime. The `min gain = 5` clamp is too permissive.

The B channel is currently passthrough (no correction). On the new image with the front-light yellow tint, this means raw B values flow into the sample step unmodified. If we want to use B in quantize, we have to fix this.

### Sample step: flat mean over gaps and bleeds

Sample uses a flat mean over the sub-pixel column rectangle within each (8×8) block. Inter-pixel dark gaps and inter-pixel bright bleeds both pull the mean. Robust aggregation (trimmed mean / median) would soak some of this. Sub-pixel column boundaries are also hardcoded — they may be off by ±1 image-pixel relative to the actual sub-pixel grid after warp, leaking R into G and creating chromatic skew in the sample image.

## Experiment Menu

Ordered by expected leverage on existing failures. Each entry has:

- **What:** the change, scoped tightly.
- **Why it might help:** hypothesis grounded in the failure analysis.
- **How to A/B:** what to look at to judge it.
- **Risk:** what could go wrong, and which other items it might interact with.

Several items relate to the **B channel** and depend on each other; they can be tried as a bundle (see "B-Channel Bundle Option" below).

### Tier 1 — High leverage, low risk

**Q1 — G-valley threshold safety clamp** (in `quantize.ts`).
- *What:* Clamp the G-valley threshold so it cannot land within 8 G-units of either cluster center; if the search is constrained against the upper boundary, fall back to `(lgCenterG + whCenterG) / 2`.
- *Why:* Direct fix for the broken behavior on `20260328_165926`. Currently the threshold can equal `whCenterG`, which demotes pixels at the WH cluster center itself.
- *A/B:* `20260328_165926` LG-blob in lower regions should shrink. Test images mostly unaffected (most have a healthy gap between LG and WH centers).
- *Risk:* very low. Bug fix.

**Q2 — Target-anchored decision boundaries.**
- *What:* After k-means runs, do not use cluster-midpoint thresholds for the LG/WH and DG/LG splits. Use the **target** midpoints: G-axis split between LG (G=148) and WH (G=255) is `G=201.5`; R-axis split between DG (R=148) and LG (R=255) is `R=201.5`. Apply these as a final pass over k-means labels (or as the primary classifier with k-means used only to seed sanity checks).
- *Why:* Eliminates cluster drift as a source of decision-boundary errors. Makes thresholds image-invariant.
- *A/B:* Should reduce LG↔DG confusion broadly. Worth checking it doesn't *introduce* errors on tests that currently happen to have well-centered clusters.
- *Risk:* Could over-shift decisions when correction has shifted RG ranges. Compose well with Q-extra-1 (B-channel) and X1 (drift diagnostics).

**X1 — Pipeline drift diagnostic.**
- *What:* Log a warning in `quantize` when any cluster center is more than 40 RG units from its target, and in `correct` when `framePostCorrectionP85` deviates from `(255, 255, 165)` by more than ~30 in any channel.
- *Why:* Doesn't fix anything but lets us spot which images are stressed and tells us when an experiment regresses something silently.
- *A/B:* Just diagnostic — should be added early.
- *Risk:* none.

### Tier 2 — Likely high leverage; needs the B-channel bundle to work

**Q-extra-1 — Add B channel to quantize discrimination.**
- *What:* Either: (a) cluster in 3D RGB space instead of 2D RG, with `INIT_CENTERS_RGB = [(80,20,40), (148,148,255), (240,148,148), (250,250,165)]`; or (b) keep 2D RG clustering but use B as a tie-breaker for pixels within a configurable margin of the LG/DG decision boundary (B>200 → DG, B<200 → LG).
- *Why:* The DG↔LG separation in B is 107 units, equal to R (107 also) but *independent* — using R and B jointly enlarges the LG↔DG decision margin by ~√2 and gives a second axis to disambiguate borderline pixels. Should significantly cut the LG↔DG confusion that dominates test errors.
- *A/B:* Should significantly reduce `LG -> DG` count on `thing-2`.
- *Risk:* B channel currently uncorrected; raw B has tint and gradient. **This experiment is paired with C-extra-1.**

**C-extra-1 — Real B-channel correction.**
- *What:* Apply the same per-channel affine correction to B that R and G receive. Targets: WH B=165, DG B=255, LG B=148, BK B=0. Frame target B=165 (so frame-strip samples in B can drive the white surface). Iterative refinement uses DG inner border with B target=255.
- *Why:* Without this, raw B is a tint+gradient mess and Q-extra-1 amplifies noise. Together they form a coherent change.
- *A/B:* `framePostCorrectionP85.B` should converge near 165 on all images. Sample debug image should look less purple/saturated.
- *Risk:* B targets in the palette are unusual (WH B=165, lowest of the WH targets) — the correction math must use these correctly. May need degree-3 polynomial since B has only frame samples to anchor.

**B-Channel Bundle Option (recommended):** Land Q-extra-1 + C-extra-1 as one commit, plus a small follow-up commit for any tuning. Independently, neither is expected to help much — in fact each alone could regress slightly. Together they should be a step-change.

### Tier 3 — Targeted at specific failure modes

**S1 — Robust per-block aggregation in sample.**
- *What:* Replace the flat mean per sub-pixel rectangle with a 20%-trimmed mean (or median).
- *Why:* Mitigates inter-pixel dark gaps and inter-pixel bright bleeds pulling the mean. Should also reduce sample-image saturation slightly.
- *A/B:* Inspect `_sample.png` saturation visually. Test error counts should hold or improve.
- *Risk:* Trim parameter is tunable; too aggressive trimming reduces sensitivity to genuine signal.

**Q-extra-4 — R-valley refinement.**
- *What:* Mirror the G-valley logic for the LG/DG R-axis split: among low-G pixels (G < 200), look for a histogram valley on R between DG-center-R and LG-center-R, with the same safety clamp from Q1.
- *Why:* Direct attack on the LG↔DG confusion dominating tests. If Q2 (target-anchored) doesn't fully solve it, this gives a per-image data-driven adjustment.
- *A/B:* Test error counts on LG↔DG cells of confusion matrices.
- *Risk:* Histograms with insufficient samples produce noisy valleys; rely on Q1's safety clamp.

**C-extra-2 — Frame post-correction calibration check.**
- *What:* After the existing correct step, check `framePostCorrectionP85` against `(255, 255, 165)`. If any channel deviates by more than a small threshold, apply a global per-channel scale to land it on target. (One scalar per channel; no spatial info.)
- *Why:* Belt-and-suspenders. Cheap. Catches systematic miscalibrations that the surface fits don't.
- *A/B:* `framePostCorrectionP85` should be tighter on all images afterward.
- *Risk:* Could mask underlying surface-fit problems. Keep the diagnostic (X1) loud.

**C1 — White surface estimation for bright-heavy content.**
- *What:* When the image has a high mean brightness in the camera region (a heuristic flag), refit the white surface using only the filmstrip frame strips with no interior-DG refinement, OR weight the interior-DG calibration points down heavily.
- *Why:* On `20260328_165926`, the white surface R range is 178–242 — a 64-unit gradient — which suggests the fit is being pulled around. The interior-DG refinement uses pixels classified as DG in a quick-sample, which on a misbehaving correction can be wrong pixels.
- *A/B:* Inspect `correct_b_white_surface.png` heatmap on the new image; should be smoother.
- *Risk:* Could regress images that *do* benefit from interior calibration. Worth gating behind the brightness heuristic.

### Tier 4 — Structural; try if Tier 1–3 doesn't close the gap

**Q3 — Constrained k-means.**
- *What:* Run k-means but reject any iteration that moves a center more than R-units from its target (e.g., 60 RG units). Effectively a "soft anchor" alternative to Q2.
- *Why:* If Q2's hard target-anchored boundaries over-correct, this is a softer middle ground.
- *A/B:* Test counts; `clusterCenters` in debug JSON.
- *Risk:* If the limit is too tight on dark images, k-means won't find the right clusters.

**Q-extra-2 — Spatial regularization.**
- *What:* For pixels whose distance to the assigned cluster ≈ distance to the next-nearest cluster (within ε), do a 3×3 majority vote among neighbors; flip the label if ≥6 of 8 neighbors disagree.
- *Why:* Reduces salt-and-pepper noise at cluster boundaries — exactly the look of LG↔DG errors in the test confusion matrices.
- *A/B:* Test error counts; visual smoothness of output.
- *Risk:* Over-smoothing fine details; need to tune ε small.

**Q-extra-3 — 2D tile k-means.**
- *What:* Replace the 1D vertical-strip ensemble with a 2D tile grid (e.g., 4×4 tiles). Each tile runs its own k-means; final label is the consensus of overlapping tiles.
- *Why:* Captures top-bottom gradient shifts that 1D strips miss.
- *A/B:* Test counts; especially `thing-1` and `zelda-poster-2` which had moderate errors.
- *Risk:* More compute; more tunable parameters.

**S2 — Sub-pixel column auto-detection.**
- *What:* Per warped image, scan a representative row to find vertical brightness valleys (the inter-pixel dark gaps), use those to set sub-pixel column boundaries instead of the hardcoded `[1,3) [3,5) [5,7)`.
- *Why:* Warp is not sub-pixel exact; misalignment of even 1 pixel leaks chroma between sub-pixel columns.
- *A/B:* `_sample.png` saturation; small but possibly meaningful on test images near boundaries.
- *Risk:* Fragile if warp is poor; needs a fallback to the hardcoded values.

**S3 — Vertical margin tuning.**
- *What:* Try `vMargin=2` (skip top+bottom 2 rows of each block instead of 1). Also experiment with row-weighted average (down-weight outer rows).
- *Why:* Inter-row gaps still bleed into sample at `vMargin=1`.
- *A/B:* Test counts; visual sample image cleanliness.
- *Risk:* Small. Reversible.

### Tier 5 — Escape hatches

**S4 — Vertical bleed deconvolution.**
- *What:* Model vertical bleed as a 1D kernel (e.g., bright pixel adds 5% to pixel below); deconvolve before sampling.
- *Why:* Only worth trying if S1+S3 leave structured pattern.
- *Risk:* Significant complexity; risk of amplifying noise.

**S5 — Luminance-first quantize.**
- *What:* Sample one luminance value per block (collapse sub-pixel to scalar). Quantize on luminance with a small color discriminator for LG↔DG (e.g., R-G sign).
- *Why:* Eliminates sub-pixel chromatic skew entirely. Major reformulation but very clean.
- *Risk:* Highest. Reformulates how quantize and sample interact.

**X2 — Synthetic stress images.**
- *What:* Programmatically generate test inputs (constant patches, smooth gradients, single-cluster-dominant, extreme-tint) where ground truth is known. Add as a separate test target.
- *Why:* Isolates which step is misbehaving for each failure mode.
- *Risk:* none beyond time spent.

## B-Channel Bundle Option

If the user/owner agrees, the simplest high-impact step is to bundle:

- **C-extra-1** (real B correction) +
- **Q-extra-1** (use B in quantize, 3D RGB k-means is the cleaner variant) +
- **X1** (drift diagnostics, to spot-check the bundle).

Land as a single commit. Expected effects:

- Tests: `LG -> DG` cells should drop substantially on `thing-2` (40 errors), `zelda-poster-1` (5 errors), and any other test with that dominant confusion.
- New image: WH region in lower portion should mostly stop being misclassified as LG, because B values for true-WH pixels are distinctly lower than B for DG pixels (165 vs 255).
- Sample image saturation: should reduce noticeably as B is no longer a wild uncorrected channel.

After the bundle lands, re-evaluate which Tier 3+ items are still needed.

## Out of Scope

- **Python pipeline (`packages/gbcam-extract-py/`).** Reference only.
- **Web app (`packages/gbcam-extract-web/`).** No frontend changes.
- **Refactors not driven by an experiment.** If a structural change makes an experiment cleaner (e.g., extracting a helper for "apply per-channel affine correction" so we can call it for B too), include it in that experiment's commit. No standalone cleanup commits.
- **New dependencies.** Stay within the current OpenCV / vitest stack.
- **Algorithm rewrites in `warp` and `crop`.** Diagnostics show these steps are already accurate enough on all 7 images. Do not touch unless an experiment in another step traces back to a warp/crop input issue.

## Deferred / Open Questions

- **Add `20260328_165926.jpg` as a hand-corrected reference.** Deferred per user — the image is too hard for the user to hand-correct. Re-evaluate after the B-channel bundle if the new image is still hard to assess by eye.
- **Threshold for "adventurous batch" acceptance.** Not formalized; user-judged per experiment.
- **Whether to keep the strip ensemble at all if 2D tile k-means (Q-extra-3) lands.** Decide after Q-extra-3.
