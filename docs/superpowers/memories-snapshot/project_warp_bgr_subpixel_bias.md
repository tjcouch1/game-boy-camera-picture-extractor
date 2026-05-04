---
name: GBA SP BGR sub-pixel ordering biases warp right-edge detection inward
description: The right edge of the warp tends to land too far left because adjacent DG/WH pixels create a visual gap from BGR sub-pixel asymmetry
type: project
originSessionId: 3a44a13e-6b3b-49b4-a12b-fc6228df0745
---
The GBA SP TN LCD displays sub-pixels left-to-right as B, G, R within
each LCD pixel. That means:

- A DG pixel (target #9494FF, blue-ish on screen) renders visually as
  `B__` — blue on the left third of the LCD pixel, dark on the rest.
- A WH pixel (target #FFFFA5, yellow-ish on screen) renders visually as
  `_GR` — dark on the left third, green+red on the right two-thirds.
- An adjacent DG-then-WH pair (`B___GR`) has a visible *dark gap*
  between them caused by the sub-pixel layout, not by an actual border.

**Why this matters for warp:** The current warp finds the white-frame
quadrilateral by brightness thresholding. On the right edge of the
camera region, where DG inner-border pixels meet WH frame pixels, the
sub-pixel gap makes the right edge of the bright frame appear ~2-3
image-pixels further left than it should. Result: the warp pulls the
right edge inward by 3-4 image-pixels at scale=8, and the right-side
dashes — which should be 8 SP-pixels from the edge — appear 10-12
SP-pixels in.

The same effect can occur at the bottom edge (top of frame is `B__`,
inner-border row is `_GR`) but is less pronounced because the LCD
sub-pixel structure is horizontal, not vertical.

**How to apply:**
- When evaluating warp accuracy, expect a systematic right-edge
  inward bias. Compensate by either:
  1. Pre-shifting the right-edge corners of the detected quad outward
     by ~3 SP-pixels (~3 image-pixels at scale=8) before perspective
     warp, OR
  2. Using a sub-pixel-aware right-edge detector that locates the
     centre of the brightest column rather than the threshold boundary.
- This is the user's diagnosis (2026-05-03), confirmed against
  `zelda-poster-3_warp.png` (right edge ~4px short, dashes ~10-12 SP-px
  from edge) and `20260328_165926_warp.png` (similar right-edge bias
  plus left edge too far right and bottom edge ~6 px short).
- The new-image user-quadrilateral `(43,81)→(84,81)→(75,111)→(51,111)`
  WH% metric is NOT a maximisation target — see
  `feedback_quad_metric_and_warp_first.md`.
