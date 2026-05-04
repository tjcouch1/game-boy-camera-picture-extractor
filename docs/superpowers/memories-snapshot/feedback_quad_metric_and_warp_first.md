---
name: New-image quad isn't pure WH; warp accuracy comes before colour tuning
description: Don't treat the new-image user quadrilateral as a "drive WH% to 100%" metric, and prefer fixing warp accuracy before tuning colour-area issues
type: feedback
originSessionId: 3a44a13e-6b3b-49b4-a12b-fc6228df0745
---
When working on `20260328_165926` (the new image lacking a hand-corrected
reference), the user-quadrilateral
`(43,81)→(84,81)→(75,111)→(51,111)` is **not** all WH. It contains
speckled LG, especially near the bottom of the image. Don't optimise
"quad WH%" as a maximisation target — high WH% can mean over-shifting LG
into WH, which breaks the rest of the image.

**Why:** The user observed the new-image output looks "really bad"
despite quad reaching 97% WH — the right side is too light, the upper
middle is mistakenly WH, and bottom areas have wrong DG/LG/WH balance.
Quad WH% is a *sanity floor*, not a gradient.

**How to apply:**
- Use quad WH% as one signal among many; cross-check against the
  whole-image visual (look at `*_quantize_b_rgb_8x.png` for the new
  image) before claiming a phase improved things.
- Specific area-level expectations the user has stated for
  `20260328_165926_gbcam.png` (128×112 GB-pixel coords, top-left
  origin):
  - Rect (97,71) w=31 h=9: mostly LG and DG, a bit of BK and WH.
  - Rect (52,28) w=63 h=7: should be LG (currently mostly WH).
  - Rect (1,97) w=9 h=15: mostly LG with a couple DG and WH.
  - Rect (7,67) w=24 h=9: NO DG; mostly WH with speckled LG.
  - Rect (16,77) w=32 h=34: mostly WH with a lot of speckled LG; NO DG.
- **Improve warp accuracy before fine-tuning colour-area decisions.**
  Bad warp shifts the LCD pixel grid against the GB pixel grid and
  cascades into sample/quantize errors that look like colour bugs but
  are really sampling-position bugs.
