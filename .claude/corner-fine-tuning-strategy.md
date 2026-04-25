# Corner Fine-Tuning Strategy - Based on Diagnostic Results

## Current Situation (zelda-poster-3)

With the improved per-corner detection, we're now getting very close:
- Top-left: ~1/4 pixel off
- Top-right: ~1/4 pixel off horizontally, ~1/8 pixel off vertically  
- Bottom-left: ~1/6 pixel off horizontally, ~1/2 pixel off vertically
- Bottom-right: spot on (essentially perfect)

These sub-pixel errors are actually quite good! But if we want perfect pixel-level accuracy, there are several approaches:

## Strategy 1: Triple Refinement Pass (Simple)

**Current:** 2 refinement passes  
**Proposed:** 3 refinement passes

Currently the code does:
1. Initial warp (rough perspective correction)
2. Pass 1 refinement
3. Pass 2 refinement

Adding a Pass 3 might capture remaining sub-pixel errors.

**Pros:**
- Simplest implementation
- Might be enough for most images

**Cons:**
- Won't help if we're hitting a fundamental algorithm ceiling
- Diminishing returns each pass

## Strategy 2: Adaptive Refinement (Medium)

Modify the refinement algorithm to:
1. Check corner errors after each pass
2. If maximum corner error > threshold, do another pass
3. Stop when all corners are within 1 pixel OR after max passes

**Pros:**
- More efficient (stops when good enough)
- Handles both easy and hard images well

**Cons:**
- More complex logic

## Strategy 3: Per-Corner-Specific Refinement (Advanced)

Instead of a single correction homography for all four corners, use:
1. Fit independent corrections for each corner quadrant
2. Use bilinear interpolation between corners
3. Better capture residual perspective distortion patterns

Example: If bottom-left consistently stays 1/2 pixel too high, we know the bottom edge isn't quite at the right angle. Could measure the actual angle and correct it.

**Pros:**
- Could achieve pixel-perfect accuracy
- Handles difficult low-contrast cases better

**Cons:**
- Significant algorithm redesign needed
- May introduce other artifacts

## Strategy 4: Sub-Pixel Refinement (Advanced)

Once corners are within 1 pixel, use:
1. Fractional pixel positioning in the transformation matrix
2. Higher-quality interpolation (currently using LANCZOS4)
3. More careful back-projection mathematics

**Pros:**
- Could achieve sub-pixel accuracy

**Cons:**
- Gains may be marginal after proper perspective correction
- Computational cost increases

## Strategy 5: Camera Model Refinement (Expert)

Account for the actual physical properties:
1. Model the GBA SP screen as a slightly curved LCD
2. Account for the camera's lens distortion separately
3. Solve jointly for screen geometry + image distortion

**Pros:**
- Most physically accurate
- Could handle difficult viewing angles

**Cons:**
- Requires calibration data
- Very complex

## Recommended Next Step

**Try Strategy 1 first** (add a 3rd refinement pass):

1. In `process_file()`, add:
   ```python
   log("  c -- Refining (pass 3)")
   warped, M = refine_warp(img, M, warped, scale, debug, debug_dir, stem, pass_num=3)
   ```

2. Run tests again

3. If Pass 3 doesn't help or helps very little, then consider Strategy 2 (adaptive refinement)

## How to Implement Strategy 1 (Add 3rd Pass)

Edit `gbcam_warp.py`, in `process_file()` function, after the current Pass 2, add:

```python
    log("  c -- Refining (pass 3)")
    warped, M = refine_warp(img, M, warped, scale, debug, debug_dir, stem, pass_num=3)
```

The diagnostics will then show:
- Initial border positions
- Pass 1 improvements
- Pass 2 improvements  
- Pass 3 improvements (if any)

## Using the Diagnostics

The new `_validate_inner_border()` function will help you see:
1. If corner errors are decreasing with each pass
2. Which corners are hardest to correct
3. Whether we're hitting algorithm limits (errors plateau) or data limits (low contrast)

If you see errors getting worse on a later pass, that indicates overfitting and we should stick with an earlier pass.

## When to Stop Refining

You can probably consider the warp "good enough" when:
- All four corners are within ±1 pixel of expected position
- All edge variances are < 3.0
- The final crop has no visible frame border

The current results (all corners within ±0.5 pixels) are already quite good!
