# Plan: Fix Pipeline to 99.5%+ Accuracy on All Tests

## Current State

| Test | Match % | Errors | Dominant Error Types |
|------|---------|--------|---------------------|
| thing-1 | 96.04% | 567 | WH→LG (503), LG→DG (33), DG→LG (14) |
| thing-2 | 93.00% | 1004 | LG→DG (590), DG→LG (313), DG→BK (50), WH→LG (45) |
| thing-3 | 97.15% | 408 | DG→LG (277), WH→LG (103), LG→DG (21) |
| zelda-poster-1 | 98.98% | 146 | WH→LG (66), LG→DG (49), DG→LG (22) |
| zelda-poster-2 | 95.87% | 592 | WH→LG (368), LG→WH (171), DG→LG (29) |
| zelda-poster-3 | 92.66% | 1052 | LG→WH (759), WH→LG (219), DG→LG (32), BK→DG (15) |

Target: ≥99.5% on ALL tests (≤71 errors per test out of 14,336 pixels).

## Root Cause Analysis

### 1. Color Correction Leaves Large Residual Variation

The `analyze_correction.py` output shows corrected pixel values are far from target palette values and vary enormously across images:

| Color | Target RGB | Actual Range (across images) |
|-------|-----------|------------------------------|
| BK | (0,0,0) | R:46-85, G:5-46, B:99-124 |
| DG | (148,148,255) | R:129-149, G:126-144, B:147-168 |
| LG | (255,148,148) | R:194-227, G:123-154, B:121-145 |
| WH | (255,255,165) | R:229-252, G:214-248, B:109-149 |

Key issues:
- **B channel is barely corrected** — only white-surface normalization, no dark anchor. DG.B should be 255 but is 147-168.
- **R channel has large offset** — BK.R should be 0 but is 46-85. LG.R should be 255 but is 194-227.
- **Correction surfaces don't flatten the gradient well enough at edges/corners** — error maps show errors concentrated at the image periphery, especially top-right, right edge, and bottom-right.

### 2. K-Means Quantization on Under-Corrected Colors

The k-means clustering operates in RG space only (ignoring B). Because the color correction doesn't bring values to their target levels, the clusters are:
- **Too close together** in some images (DG and LG overlap in thing-2)
- **Position-dependent** — the same color appears with different RG values at different positions due to residual gradient

### 3. Error Patterns Are Spatially Concentrated

Error maps show errors clustered at edges and corners, NOT randomly distributed. This proves the issue is residual gradient from incomplete correction, not random noise. The front-light heatmaps show the GBA SP front light creates a massive gradient (dark red in bottom-left to blue in top-right), and the correction doesn't fully compensate at the extremities.

### 4. The Frame Contains All Four Colors at Known Positions

From `frame_ascii.txt`, the frame uses all four colors:
- Space (` `) = White #FFFFA5 — the main frame body
- Dot (`·`) = Light gray #FF9494 — dash edge gradients
- Dark block (`▓`) = Dark gray #9494FF — inner border + dash sub-gradients
- Full block (`█`) = Black #000000 — dashes

This means we have **all four palette colors at known positions around the entire border** — a complete calibration reference that is currently under-utilized. Currently only white (from frame strips) and dark gray (from inner border) are used for correction.

---

## Implementation Plan

### Phase 1: Improve Color Correction with All Four Frame Colors

**Goal:** Use all four color reference points from the frame to build a per-pixel affine correction that fully flattens the front-light gradient.

#### Step 1.1: Extract All Four Color References from the Frame

The frame geometry is known exactly from `frame_ascii.txt` and `Frame 02.png`. For each of the four frame strips (top, bottom, left, right):

1. **White samples** (already done): From the frame body areas (spaces in ASCII art). Continue using existing p85 approach.

2. **Black samples** (new): From the dash body areas (█ in ASCII art). The dashes are at known positions:
   - Top/bottom: 17 dashes, each ~5px wide and 2px tall, at row 6-7 (top) and row 137-138 (bottom)
   - Left/right: 14 dashes, each ~2px wide and 5px tall, at col 0-1 (left) and col 158-159 (right)

   Extract the black level from the solid centers of each dash (avoiding the light-gray/dark-gray transition edges).

3. **Dark gray samples** (already done for inner border): The inner border (▓ at row 16, row 129, col 15, col 144). Continue using existing approach but also collect from the dash sub-gradients.

4. **Light gray samples** (new): From the dash edge gradients (· in ASCII art). These appear at the sides of each dash where the transition from white to black passes through light gray.

**Implementation approach:**
- Parse `Frame 02.png` (or hardcode from `frame_ascii.txt`) to build a pixel-by-pixel color class map of the frame region
- For each GB pixel position in the frame, know what color it should be
- Sample the observed value at that position from the warped image
- This gives us observations of all four colors at many positions around the border

#### Step 1.2: Build Per-Pixel 4-Point Calibration Model

With four reference measurements (observed BK, DG, LG, WH) at many positions around the border, build smooth surfaces for each reference level:

1. For each channel (R, G, B), fit four smooth surfaces:
   - `black_surface(x,y)` = observed black level at position (x,y)
   - `darkgray_surface(x,y)` = observed dark gray level at position (x,y)
   - `lightgray_surface(x,y)` = observed light gray level at position (x,y)
   - `white_surface(x,y)` = observed white level at position (x,y)

2. Use these to build a per-pixel mapping from observed values to corrected values:
   - At each pixel, we know what the four palette colors LOOK like at that position
   - We know what they SHOULD look like (the target palette)
   - Interpolate between the four reference points to map any observed value to its corrected value

3. Use piecewise linear interpolation between the four anchor points rather than a single affine (2-point) model:
   - For observed value `v` at position `(x,y)`:
     - If `v` is between `black_surface(x,y)` and `darkgray_surface(x,y)`, interpolate between target BK and DG
     - If `v` is between `darkgray_surface(x,y)` and `lightgray_surface(x,y)`, interpolate between target DG and LG
     - If `v` is between `lightgray_surface(x,y)` and `white_surface(x,y)`, interpolate between target LG and WH
   - This handles non-linear response curves that a 2-point affine model can't

**Surface fitting approach:**
- Use degree-2 bivariate polynomial (same as current white surface) for each of the four surfaces
- The four surfaces are independently fit, each from their own reference measurements
- Coons bilinear patch from border measurements (left/right/top/bottom) can be used as the initial estimate, with polynomial refinement from interior measurements where available

**Key advantage:** With 4 anchor points instead of 2, the correction is much more accurate. Even if the surfaces have some error, the piecewise-linear interpolation between 4 known points is more robust than extrapolating from 2 points.

#### Step 1.3: Apply Per-Channel Correction

For each channel (R, G, B) independently:
1. Evaluate the four surfaces at every pixel
2. Apply piecewise-linear mapping from observed to target values
3. Clip to [0, 255]

**Important: Fix the B channel correction.** Currently B is only white-normalized, not dark-anchored. With four reference points from the frame, we can properly correct B too. DG.B should be 255, not 148 — the current code intentionally skips this because "DG.B > WH.B would invert the gain." With piecewise-linear interpolation (not affine), this is no longer a problem because we're interpolating between known reference values, not extrapolating from a linear model.

### Phase 2: Improve Quantization

**Goal:** Make quantization more robust to residual correction errors.

#### Step 2.1: Use Target-Palette-Relative Classification

Instead of discovering clusters with k-means (which can converge to wrong positions), classify pixels by distance to the **known target palette** values:

After Phase 1's improved correction, the pixel values should be close to their target palette. For each pixel, compute the distance to each of the four target palette colors and assign to the nearest one.

**Target palette in the per-channel corrected space:**
- BK: (0, 0, 0) → grayscale 0
- DG: (148, 148, 255) → grayscale 82
- LG: (255, 148, 148) → grayscale 165
- WH: (255, 255, 165) → grayscale 255

If the correction is good, simple nearest-neighbor to target values should work well. But we should use all three channels for classification, not just RG.

**Alternative: Adaptive k-means with target initialization.** If nearest-neighbor doesn't work well (because there's still some global offset), run k-means but initialize at the target palette values and with only 1-2 iterations (so it doesn't drift far from targets).

#### Step 2.2: Add Spatial Smoothing Post-Processing

After initial classification, apply a smoothing pass:
1. For each pixel, look at its 8 neighbors
2. If the pixel disagrees with most neighbors AND the pixel's value is close to the classification boundary, flip it to match the majority
3. Only flip if the confidence is low (pixel value is within some margin of the threshold)

This handles isolated misclassifications caused by noise or pixel bleeding without changing correctly-classified boundary pixels.

#### Step 2.3: Per-Pixel Threshold Approach (Fallback)

If Phase 1's correction still leaves residual gradient, compute per-pixel thresholds:
1. At each pixel position, evaluate the four correction surfaces to get the local expected values for BK, DG, LG, WH
2. Set local thresholds at the midpoints between adjacent expected values
3. Classify each pixel by comparing its **uncorrected** (or lightly corrected) value against these local thresholds

This approach bypasses the need for perfect correction by directly using the calibration model for classification. It's equivalent to asking "what does this pixel position's value most likely represent?" given the known gradient.

### Phase 3: Iterate and Refine

#### Step 3.1: Run Tests After Phase 1 Correction Improvements
- Implement the 4-anchor correction model
- Run `python run_tests.py`
- Examine error maps and confusion matrices
- Look for patterns: are errors now random or still spatially concentrated?

#### Step 3.2: Run Tests After Phase 2 Quantization Improvements
- Implement the improved quantization
- Run tests again
- Compare error counts and spatial distribution

#### Step 3.3: Fine-Tune Parameters
- Adjust polynomial degree for the four surfaces (try degree 2 vs 3)
- Adjust the spatial smoothing parameters
- Consider whether the Coons patch or polynomial is better for sparse surfaces (BK and LG may have fewer reference points)

#### Step 3.4: Handle Edge Cases
- Check if any specific pixels are consistently wrong across all photos of the same image (suggesting a systematic issue vs. per-photo variability)
- Look at whether the warp step's border refinement is accurate (small alignment errors could cause systematic edge errors)
- Verify that the sample step's subpixel-aware sampling is correctly extracting per-channel values

#### Step 3.5: Additional Investigations if Needed
- Run `measure_spatial_bias.py` and `measure_variation.py` on corrected images to quantify residual gradient
- Run `visualize_frame_colors.py` and `visualize_white_samples.py` to verify reference extraction
- Check if increasing `--scale` (e.g., to 10 or 12) improves accuracy by giving more pixels to sample from
- Consider whether different `--sample-method` (median vs mean) reduces noise at boundaries

---

## Priority Order

1. **Phase 1.1-1.3 (Color Correction)** — This is the highest-impact change. The error maps clearly show errors are caused by residual gradient at edges/corners. Better correction with 4 anchor points should dramatically reduce errors.

2. **Phase 2.3 (Per-Pixel Thresholds)** — If correction alone doesn't reach 99.5%, per-pixel thresholds are the next most impactful approach because they directly address the remaining gradient.

3. **Phase 2.1-2.2 (Quantization Improvements)** — These are lower-impact but important for handling the remaining edge cases after correction is improved.

4. **Phase 3 (Iteration)** — Essential for reaching the final target. Each round of testing will reveal new patterns and guide the next improvement.

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| LG samples from frame dash edges may be too noisy (small/transitional areas) | Use median/p50 of surrounding pixels, exclude samples too close to BK or WH |
| BK samples from dashes may include sub-pixel bleed from adjacent white | Sample only the solid center of each dash, use p15 or min-of-center-region |
| 4-surface polynomial may overfit in corners where reference data is sparse | Use Coons bilinear patch as primary, polynomial only for refinement, constrain extrapolation |
| Piecewise-linear correction may introduce quantization artifacts at segment boundaries | Use smooth (cubic) interpolation between the 4 anchor points instead of linear |
| B channel has inverted response (DG.B=255 > WH.B=165) making it hard to correct | With piecewise-linear mapping using 4 anchors, this is handled naturally — no need for monotonic assumption |

## Success Criteria

- All 6 tests pass at ≥99.5% (≤71 errors each)
- Errors should be randomly distributed, not spatially concentrated
- The correction should visually produce uniform colors across the entire image
- The pipeline should work consistently across all 6 test images (different photos of the same scene with different front-light orientations)

## Notes on the Heatmap / White Surface

The current white surface heatmap (debug image `_correct_color_b_white_surf_heatmap.png`) shows a smooth gradient from the front-light. This is a correct representation of the problem. The issue is that:

1. The correction uses only 2 anchors (white + dark gray), which is insufficient for accurate interpolation across the full dynamic range
2. The B channel correction is incomplete (only white-normalized)
3. The dark surface is estimated from just the 1-pixel-wide inner border, which is noisy

The heatmap approach itself is sound — it correctly models the spatial brightness variation. The fix is to use MORE reference points (all 4 colors) to build a better model, not to abandon the heatmap approach.
