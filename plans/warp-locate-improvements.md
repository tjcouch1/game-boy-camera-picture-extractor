# Plan: warp + locate improvements

Branch: `warp-locate-improvements`
Starting from: `main` @ `2d987c2` (after `locate` step was added before `warp`)

## Big picture

The user has run lots of new images through the pipeline and identified four
concrete failure cases. The pipeline now starts with a `locate` step that
extracts the GB screen from a full phone photo before handing off to `warp`.
The hand-off between `locate` and `warp` is where most of the new problems
live — `warp` was originally written assuming an already-cropped input and
some of its assumptions (especially around edge curvature / inner-border
refinement) are tripping over `locate`'s outputs on harder photos.

The four failure cases (in priority order, addressed one at a time):

1. **`sample-pictures-out/20260328_165926~2-EDIT_warp.png`** — bottom-right
   corner is 2 px too far left and 2 px too far up. The other three corners
   are perfect; the right side curves leftward. May be detectable from the
   vertical frame lines.
2. **`20260313_213443`** — its `_warp.png` in `sample-pictures-out-full/` is
   much better than the one in `sample-pictures-out/`. Tier-2 self-consistency
   detects 246 differences between them. Looks like the normal version's
   top-left is pushed too far right and the embedded GB-cam picture appears
   stretched to the left. Suspect interaction between `locate` and `warp`.
3. **`20260602_184434.jpg`** — four phone photos of the same GBC image:
   `20260602_184434.jpg`, `20260602_184434~2.jpg`, `20260602_185435.jpg`,
   `20260602_185458.jpg`. Three look correct; `20260602_184434.jpg` goes
   wrong. Diff them to isolate what's different about that one input.
4. **`20260602_184946.jpg`** — top-left corner of `_warp.png` is way too far
   right. The user manually cropped/rotated this image into
   `20260602_184946~2.jpg` so that `locate` becomes a near-no-op; the `~2`
   variant warps correctly. So the problem is *not* in `warp` per se — it's
   in how `warp` consumes `locate`'s output for the un-pre-cropped version.

## Overall goals (in order)

This is the same shape as the prior `frame-dash-color-anchors` work: **fix
warp first regardless of downstream test results**, then propagate
adjustments through the rest of the pipeline (the goal of those isn't
necessarily to improve test results — it's to make each step accurate given
what the previous step now produces), then make precise final tweaks to
recover test accuracy.

Constraints:
- **No hard-coded solutions to the particular test images.** The pipeline
  needs to work on any GBC image. The user is fine with rules grounded in
  what's actually in the pixels (color bleed reasoning, frame-anchor
  measurements, etc.), but not with rules that say "if pixel X looks like Y,
  flip it" without an underlying mechanism.
- It's fine to use the test images as oracles to *verify* a principled
  approach is working; just don't tune *to* them.

## Tooling and orientation

- `cd packages/gbcam-extract` then:
  - `pnpm test:pipeline` — quick: sample-pictures smoke + `test-input-full`
    (locate:true) primary accuracy run.
  - `pnpm test:pipeline:all` — full: all six corpora, including
    `sample-pictures-out-full/` (where the 246-diff result lives) and
    `sample-pictures-private/` (where the 20260602 problem images live).
- Tier-1 corpora (hard accuracy gates, compare against hand-corrected refs):
  - `test-output/` — `locate:false`, already-cropped `test-input/` images.
  - `test-output-full/` — `locate:true`, full phone photos in
    `test-input-full/`. **Primary `locate` accuracy check.**
  - `test-output-locate/` — `locate:true` run on already-cropped
    `test-input/`. Tests that `locate` is a no-op on already-cropped inputs.
- Tier-2 corpora (soft self-consistency):
  - `sample-pictures-out/` — `locate:false`, the reference.
  - `sample-pictures-out-full/` — `locate:true` on full sample-pictures.
  - `sample-pictures-private/` — extra corpus, no reference comparison.
- Per-image debug folder layout (see `AGENTS.md` lines 175–245 for the full
  inventory). The ones you'll likely use most:
  - `_locate.png`, `_locate_d_output_region.png` — what `locate` chose.
  - `_warp.png`, `_warp_a_corners.png`, `_warp_b_borders.png` — what `warp`
    decided.
  - `_debug.json` — every metric the log prints, also keyed for `jq`.
- Existing scripts you may extend:
  - `packages/gbcam-extract/scripts/find-errors.ts` — list per-pixel errors
    from the quantize comparison.
  - `packages/gbcam-extract/scripts/inspect-pixel.ts` — deep diagnostic for
    a single pixel (its RGB, distances to each cluster, 5×5 neighbourhood).
  - `packages/gbcam-extract/scripts/build-frame-mask.ts` — parses
    `frame_ascii.txt` into a per-pixel palette mask.
  - You should add a `scripts/inspect-warp.ts` or similar that overlays the
    detected corners + edge polynomial fits on the warped image so you can
    *see* what `warp` thought the edges were. This is the most valuable
    diagnostic for task 1.

## Task 1 — Fix the bottom-right curvature on 20260328_165926~2-EDIT

**Symptom:** `sample-pictures-out/20260328_165926~2-EDIT_warp.png`'s
bottom-right corner is 2 px too far left and 2 px too far up. The right
edge curves *inward* (leftward) toward the bottom. Other three corners are
perfect.

**Investigation:**
- Open `sample-pictures-out/debug/20260328_165926~2-EDIT_warp.png` and
  `..._warp_a_corners.png`, `..._warp_b_borders.png`. The polyline drawn in
  the corners image is what `warp.ts` thought the frame was. If the
  polyline cuts the corner short of the actual frame, that confirms the
  detected corner is off — not just the warped image's appearance.
- Compare against `..._locate.png` to confirm `locate` handed a clean
  rectangle to `warp`. (Likely fine — the other three corners are
  perfect, and `locate` operates on the whole frame.)
- Read `_debug.json` `warp.pass1.cornerErrors` and `warp.pass2.cornerErrors`
  — what offsets did `warp`'s two-pass refinement apply at each corner?

**Why this is happening (hypothesis):**
- `warp.ts` fits an edge polynomial along each frame side using brightness
  thresholding (likely a 1D or quadratic curve fit through edge pixels).
  The fit is dominated by where dashes are clearly visible. If the right
  edge has weaker dash contrast toward the bottom (e.g. fading frontlight),
  the polynomial pulls inward.
- The user explicitly suggests: "use the vertical frame lines". The right
  frame has 14 vertical dashes; you should be able to fit a line through
  them and extrapolate to the corner. If the polynomial fit is the culprit,
  raising its degree (cubic) or weighting the fit by dash signal-strength
  per row may help.

**Fix approach (principled, image-agnostic):**
- Add a per-edge sub-pixel refinement that measures each dash position along
  the edge and fits a low-degree polynomial through them, then extrapolates
  to the corner. Compare against the existing brightness-threshold fit and
  prefer whichever has lower residual.
- Verify the fix on the test images (corners should not move on the
  already-correct-looking ones; the BR corner of 20260328 should move
  outward by ~2 px in each direction).

## Task 2 — 20260313_213443 normal vs full divergence

**Symptom:** 246 self-consistency differences between
`sample-pictures-out/20260313_213443_*` and
`sample-pictures-out-full/20260313_213443/20260313_213443_*` (locate:true
version is much better).

**Investigation:**
- Diff the two `_warp.png`s visually (overlay or side-by-side). The user
  describes the normal version's top-left being too far right while the
  embedded GB-cam picture appears stretched to the left. That "stretched"
  appearance is the warp's perspective inverse mapping pulling pixels from
  the wrong rectangle in the source.
- Compare `_warp_a_corners.png` for both — where did corner detection land
  in each? If `locate:true` finds corners at slightly different image
  coordinates than the already-cropped input, that's expected; what
  matters is whether each input version's *own* corner detection lined
  up with its *own* frame.
- Read `_debug.json` `warp.sourceCorners` and `warp.pass1.cornerErrors` for
  both runs. If pass-1 errors are large in the normal version and small in
  the full version, the brightness-threshold corner detection is failing
  on the normal input but the locate's pre-cleaning helps the full input.
- It looks like the normal version's corner detection finds corners *too
  close* to the screen interior (hence "GB cam picture stretched to left").

**Fix approach (principled, image-agnostic):**
- This is probably the same root cause as task 1 — a weak edge gives a
  bad polynomial fit. But validate that hypothesis with debug images first
  before assuming.
- The fix from task 1 (dash-position-based edge fit) should help this case
  too. If not, the corner-detection threshold or contour selection in
  `warp.ts` may need a fallback that uses the inner-border ring (which
  `locate` already detects) as a cross-check.

## Task 3 — 20260602_184434 vs the other three of the same image

**Symptom:** Of four phone photos of the same GBC image
(`20260602_184434.jpg`, `~2.jpg`, `20260602_185435.jpg`,
`20260602_185458.jpg`), three look correct but `20260602_184434.jpg` goes
wrong.

**Investigation:**
- Run all four through the pipeline and compare each step's outputs.
- Looking at `_locate.png`s side by side will probably tell the story
  immediately. If `20260602_184434.jpg` produces a locate crop that's
  obviously different shape/orientation from the other three, the problem
  is in `locate` — likely candidate selection (`locate_b_candidates.png`)
  picked the wrong quad. Check the score values in
  `_debug.json` `locate.chosenCandidate` and `locate.rejectedScores`.
- If `_locate.png` is fine, look at `_warp.png`. If warp differs, check
  whether `_warp_a_corners.png` shows different corner detections — and
  if so, what about that one image's framing tripped warp up.

**Fix approach:**
- If `locate` picked the wrong quad, the validation score (`innerBorderScore`
  + `darkRingScore` + aspect ratio) is mis-prioritizing. Look at the
  rejected candidates; if the *correct* quad is in the rejected list, that's
  evidence the scoring needs adjustment. Be careful not to over-fit to this
  one image — find a principled reason the correct quad was scored low
  (e.g. its inner-border-ring detection partially failed because of a
  visible reflection / specular highlight).
- If `warp` is the culprit, lift fixes from task 1/2.

## Task 4 — 20260602_184946 top-left badly off

**Symptom:** `20260602_184946_warp.png`'s top-left is way too far right.
The user manually cropped/rotated `20260602_184946~2.jpg` so that `locate`
is a near-no-op; the `~2` version warps correctly. So the issue is *not*
in `warp` per se — it's in how `warp` reacts to `locate`'s output on the
un-pre-cropped version.

**Investigation:**
- Compare `_locate.png` for both versions. The `~2` version's locate should
  be near-identity. The non-`~2` version's locate should produce a
  rectangle around the GB screen, possibly with the wrong orientation or
  too much / too little margin.
- Compare `_locate_d_output_region.png` — was the chosen region too tight
  on the top? If the top edge of locate's crop clips into the GB screen
  itself (rather than the dark LCD ring around the frame), `warp` will
  misdetect the top-left corner.
- Check `_debug.json` `locate.marginRatio` and `locate.outputSize`. The
  `MARGIN_RATIO=0.06` in `locate.ts` may be too tight when the screen is
  near an image edge.

**Fix approach:**
- If `locate`'s output is missing top dark-LCD-ring margin, the fix is in
  `locate.ts` — increase the margin, or ensure the output crop never clips
  the LCD ring even when it pushes the output off the original photo's
  edge (pad with black when needed).
- Verify the fix doesn't break the other images.

## Working method

Work tasks **in order**. After each task is fixed:
1. Run `pnpm test:pipeline:all`. Verify the target case improves and nothing
   else regresses meaningfully. If something else regressed, understand why
   and decide if the fix needs adjusting.
2. Commit with a short message describing the principle (not the image).
   E.g. "warp: fit edge polynomial through dash positions, not raw bright
   pixels" rather than "fix bottom-right of 20260328".
3. Push when each task is done so the user can see progress incrementally.

When a task touches the same code as a later task, do task 1 fully first
(including the verification + commit) before exploring later tasks — they
may resolve themselves.

## After the four tasks

Same loop as the prior `frame-dash-color-anchors` work:
1. **Warp first** — get the warp output right regardless of test numbers.
   The corner-detection step is the foundation; everything downstream
   inherits its mistakes.
2. **Then propagate** — adjust `correct` / `crop` / `sample` / `quantize`
   given what `warp` now produces. The goal here isn't to push test
   accuracy yet; it's to make sure each step is operating accurately on the
   improved input. Use diagnostics, not test accuracy, to verify each step.
3. **Then test-accuracy-driven refinement** — once the upstream steps are
   doing the right thing, look at remaining quantize-level errors and
   apply the same principled approach as before:
   - Confidence-based neighbour refinement (already in `quantize.ts`,
     section 3d).
   - Palette-target vote (section 3d).
   - DG-anomaly detection (section 3e).

The prior chat got every non-bathhouse test to ≤2 errors (thing-1 at 0).
That work shouldn't regress on `test-input/` even as `locate`/`warp`/etc.
are improved.

## Useful references

- `AGENTS.md` (project instructions) — pipeline overview, debug layout,
  per-step metrics inventory.
- `supporting-materials/frame_ascii.txt` — character-art of the Frame 02
  reference (160×144). Useful for thinking about where dashes / inner
  border / LCD ring sit in a properly-warped image.
- `packages/gbcam-extract/src/locate.ts` — locate constants
  (`WORKING_MAX_DIM`, `MARGIN_RATIO`, `EXPECTED_*_DASH_*`) are at the top.
- `packages/gbcam-extract/src/warp.ts` — the corner-detection and edge
  refinement logic.
- `packages/gbcam-extract/src/frame-mask.ts` (auto-generated) — per-pixel
  palette mask used by `quantize` and downstream refinement passes.

## What "done" looks like

For each task:
- The failing image's `_warp.png` (or `_locate.png` for task 4) visibly
  improves.
- The fix is grounded in something measurable about the image (edge
  position, dash detection, etc.) rather than a constant tuned for that
  one image.
- `pnpm test:pipeline:all` shows no significant regression on other
  corpora; ideally tier-1 hard gates either improve or stay flat.

After all four tasks, take stock of how the pipeline is doing across the
expanded corpus (a lot more images than the original 8 tests), pick the
next-most-impactful divergence, and iterate.
