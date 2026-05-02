# Color-Cast Separation — Design

**Date:** 2026-05-01
**Status:** Draft
**Supersedes (in part):** `2026-04-28-pipeline-accuracy-design.md` — that
design's experiment-menu approach hit a local maximum at aggregate test
error 76 (down from 111) and could not progress further without
structural change. See
`memory/project_pipeline_accuracy_experiments.md` for what was learned.

## Goal

Make the pipeline robust to **colored** front-light casts, not just
brightness gradients. Concretely:

1. The new bright/yellow-tinted sample `20260328_165926.jpg` produces a
   recognisable output: top-left mostly BK, bottom third mostly WH, no
   large LG (pink) blob in the lower middle, no large DG (purple) blob
   in the horizon region.
2. The sample-step debug image (`*_sample.png`) is roughly neutral
   grayscale-with-mild-tint on all 7 images, *including* the new image
   — not the heavy pinks/oranges/purples we currently see.
3. All 6 reference test images reach 0 different pixels. The path to
   that **must be permitted to regress aggregate by orders of
   magnitude during intermediate phases** — large structural changes
   often cannot reach a stable end state without going through a
   broken-looking middle. The prior plan's "every commit must improve
   aggregate" rule is replaced with: *measure and record the
   aggregate at every phase; do not revert on aggregate alone unless
   the qualitative direction is also wrong*.

## Why the current pipeline fails on coloured front-lights

`correct.ts` does two jobs at once: it removes the brightness gradient
and (implicitly, by clamping channel ranges) tries to remove colour
cast. The R and G channels each get a per-channel affine surface
correction; the B channel is passthrough. This works iff the
front-light is roughly white. It breaks when the front-light is
coloured:

- **Yellow front-light** (`20260328_165926`) suppresses raw B uniformly
  by ~50 units. Per-channel R/G correction doesn't see this. After
  R/G are stretched to whiteTarget=255, the resulting RGB is
  yellow-tinted everywhere because B is still depressed.
- **Blue front-light** (`zelda-poster-1`) does the opposite — frame B
  raw is 254, inner-border B raw is 230. Frame B > border B. Any
  per-channel B affine that maps observed→target inverts.
- The cast is **multiplicative**, not additive. A yellow cast scales
  R/G up and B down by per-channel factors. Per-channel affine
  correction on R/G can't recover the B factor.

Sample-step output reflects this: every image's `*_sample.png` shows
heavy magenta/orange/purple tint, even on test images that quantize
near-perfectly. The cluster centers in `quantize`'s RG-space are
shifted because the sample colours are shifted, and `quantize` is then
asked to separate clusters that the prior steps did not properly
neutralise.

The other lost signal is the **B channel itself**:

- Palette: BK=(0,0,0), DG=(148,148,**255**), LG=(255,148,148),
  WH=(255,255,165). DG is the only palette entry with high B.
  In RG plane, BK and DG share the same axis ratio (R≈G), differing
  only in brightness; in full RGB, DG is unambiguously high-B.
- Quantize works in RG only. The 107-unit B gap between DG and the
  rest is unused.

The previous plan's B-channel bundle tried to fix this with per-pixel
affine B correction. It failed because it inherited the per-channel
affine framework, which assumes white < dark relationships that the
B channel doesn't reliably hold. The fix here is structural, not a
patch on the old framework.

## Design

The new pipeline structure separates colour cast from brightness
gradient and uses all three channels through to quantize:

```
warp → correct(brightness only) → crop → sample → quantize(3D RGB)
              ↑
   white-balance step (NEW, runs before brightness correction)
```

The redesign is laid out in **phases**. Each phase is a coherent
bundle that lands as one or more commits but is measured against the
phase's success criteria, not the prior plan's "every commit must
improve aggregate" rule.

### Phase A — Decouple colour cast from brightness gradient

Add a global white-balance step before `correct`. The step:

1. Measures the raw median colour of frame strip pixels (already
   identified in `correct.ts`, drop the dashes / dropouts via the
   existing 75%-of-median filter).
2. Computes per-channel scales `(255/raw_R, 255/raw_G, 165/raw_B)`,
   clamped to a safe range (e.g. `[0.4, 2.5]`).
3. Applies the scales globally to the warped image.

After this step, the frame should land near `(255, 255, 165)` in raw
pixel space, regardless of cast colour. `correct.ts` then runs as
before but on colour-neutral data — its R/G affine surfaces will fit
narrower observed ranges and its B passthrough is now meaningful (B is
already on the right scale).

**Expected effect:**
- Sample-step images become recognisably neutral grayscale-with-tint
  on all 7 images.
- Aggregate test error likely **rises** (test images already had
  near-neutral cast and any structural change perturbs them slightly).
  Expect the rise to be small (10–30 px) — the white balance is near a
  no-op on those images.
- New image: sample.png much less saturated; quantize output likely
  still wrong (RG-only quantize still sees drifted clusters under
  brightness-only correction), but the sample image is the
  precondition for everything downstream.

### Phase B — Quantize in 3D RGB

After Phase A, B is a meaningful channel. Update `quantize.ts`:

1. Cluster in 3D RGB space, not 2D RG. Init centers:
   `BK=(0,0,0), DG=(148,148,255), LG=(255,148,148), WH=(255,255,165)`.
2. The strip ensemble runs the same way but in 3D.
3. The G-valley refinement still works (it's a 1D-on-G search among
   pixels already classified as LG-or-WH); keep it.
4. The R-valley refinement (Q-extra-4 from prior plan) becomes
   well-behaved in 3D space because B-axis disambiguates DG/LG before
   R-valley needs to.

**Expected effect:**
- Recovers the Phase A regression on test images and goes below
  baseline.
- New image: DG ↔ LG/WH confusion drops sharply because B alone
  separates them.

### Phase C — Frame as ground truth (Lead 4 from the discussion)

Once B is meaningful and quantize uses it, the per-channel R/G affine
surfaces in `correct.ts` become a special case. Replace them with a
single per-region affine RGB transform fit to frame pixel pairs:

- `Frame 02.png` (160×144 grayscale-mapped reference) gives the
  expected colour at every frame pixel, ~3000+ anchor points per
  image.
- Fit a 3×3 affine RGB transform per region (or a low-degree
  polynomial of position-and-3×3) that maps raw frame pixels to
  reference frame pixels by least-squares.
- Apply that transform to the entire warped image.

The inner border (#9494FF) and the dashes (#000000) are additional
anchors; once Phase B classifies camera pixels into BK/DG/LG/WH, those
become anchors too and we move into Phase D.

**Expected effect:** large aggregate drop and qualitative win on the
new image.

### Phase D — Iterative correct ↔ quantize

After a first correct + quantize pass:

1. Pixels confidently classified as each palette colour become
   additional anchors at known target colours.
2. Refit the colour transform with all anchors (frame, border,
   dashes, classified BK/DG/LG/WH).
3. Re-correct, re-quantize.
4. Iterate to convergence (one or two passes is usually enough).

This is the natural next step after Phase C and may not be needed if
Phase C lands the test images at 0.

## Acceptance criteria

Phased, with **very loose** intermediate tolerance. The starting
aggregate is 76; the final goal is 0. Between those, the path may go
much higher and that is acceptable as long as the qualitative
direction is right.

| Phase | Aggregate budget (current 76) | Sample tint | New image |
|-------|------------------------------|-------------|-----------|
| A done | up to ~5000 OK if qualitatively right | mostly neutral on all 7 images | quantize may still be bad, but sample is recognisably clean |
| B done | up to ~3000 OK if qualitatively right | clean | DG/LG separation visibly improved; LG-blob shrunk |
| C done | down to ≤ ~200 | clean | bottom mostly WH, top-left mostly BK, no big blobs |
| D done | 0 | clean | as above, possibly cleaner |

The intermediate budgets above are deliberately loose — Phase A
introduces a per-channel global multiply that can shift many pixels
across decision boundaries while the downstream `correct` and
`quantize` steps haven't yet been adapted. A test image whose
quantize previously hovered just-on-target may flip many pixels at
once; aggregate-of-thousands is plausible and not a stop sign.

The **only** hard stop conditions during A and B are:
1. Sample tint is *worse* than baseline (more saturated/coloured).
   This means white-balance is going the wrong way.
2. The new image's qualitative state is worse (more pink-blob, more
   purple-blob, more darkness in regions that should be WH).
3. A unit test that doesn't depend on the pipeline-integration
   accuracy gate is failing (something structurally broken).

Anything else — even a 10× aggregate jump — is acceptable mid-phase.
Record it, write down which images moved and how, keep going.

Phase C and D have tighter budgets because by then the architecture
is stable; further regression in those phases means the new layer is
wrong.

## Workflow

This is a structural redesign, not an experiment menu. The cadence:

1. Each phase is its own branch off `accuracy` (or off the previous
   phase's branch).
2. Phase A and Phase B are NOT measured separately for ship-decisions
   — they're a bundle. Land Phase A, take measurements, then land
   Phase B before deciding whether the bundle is keeping. If the
   Phase A+B bundle still regresses test aggregate, debug or revert
   the bundle as a unit.
3. Phase C is its own ship decision *after* A+B. Phase D is gated on C.
4. Diagnostics (X1 from prior plan, plus new ones added in Phase A)
   are committed as their own change separately so they can be used
   during the larger phases.

## Out of scope

- Python pipeline (`packages/gbcam-extract-py/`). Reference only.
- Web app (`packages/gbcam-extract-web/`). No UI changes; the new
  `correct` step is API-compatible.
- The `warp` and `crop` steps. Diagnostics show they're already
  accurate enough on all 7 images.
- New dependencies. Stay within OpenCV.js / vitest stack.
- The escape-hatch tasks from the prior plan (sub-pixel auto-detect,
  vertical bleed deconvolution, luminance-first quantize, synthetic
  stress images). Reconsider only if Phase D leaves residual
  structured errors.

## Open questions

- **Where the white-balance step lives.** Is it a new file
  (`white-balance.ts`) called from `index.ts`, or a sub-step inside
  `correct.ts`? Leaning toward a new file so Phase C can replace the
  brightness-correction half cleanly without touching white-balance.
- **Frame `Frame 02.png` alignment.** Phase C requires the per-image
  frame to be aligned to the reference. The existing warp output is
  already (160×144) × scale; just need to map each output pixel to a
  reference pixel. Verify warp accuracy is sufficient before relying
  on it for Phase C.
- **Hand-corrected reference for `20260328_165926`.** Still deferred.
  After Phase C, re-evaluate whether the user can produce one. If the
  output is recognisable enough by then, a hand-corrected reference
  becomes worth producing because it lets the test runner give us a
  signal on the new image instead of just qualitative judgment.
- **Order: Phase A then B, or A and B together?** Currently leaning
  toward A landing first (committed) followed by B as a separate
  commit, but evaluated as a bundle. If Phase A causes >50 px
  aggregate regression, debug A on its own before adding B. If <30,
  proceed straight to B.

## Notes from the previous plan

The previous experiment menu (`2026-04-28-pipeline-accuracy.md`)
landed 5 net wins (Q1, X1, S1, C-extra-2, C1, S3) and saved -35 in
aggregate. Those changes are kept as the **starting point** for this
plan. Specifically:

- The G-valley safety clamp (Q1) survives unchanged.
- The drift diagnostics (X1) are reused and extended in Phase A.
- The trimmed-mean sample (S1) and vMargin=2 (S3) are kept.
- The post-correction frame scale (C-extra-2) likely becomes
  redundant after Phase A or C — remove it then.
- The bright-heavy refinement skip (C1) likely also becomes redundant
  after Phase C reframes correction. Re-evaluate.
