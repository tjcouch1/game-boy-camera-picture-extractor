# PLAN: Fix Warp Step Border Distortion

**Date:** March 28, 2026  
**Status:** Proposed Solution Architecture

## Executive Summary

The warp step's perspective correction is producing borders that are not straight and not positioned at the correct pixel locations. The inner `#9494FF` border should be exactly 1 pixel wide at the 16th pixel in from each edge (INNER_TOP=15, INNER_LEFT=15, etc. in Game Boy pixel coords, which maps to pixels 120, 120 in image pixels at scale 8). Current output shows RMS errors of 0.7-8 pixels with borders that bow outward/inward and misaligned corners.

The root cause is that the current refinement algorithm detects edge curvature by comparing the average border position to expected positions, but does not properly account for:

1. **Non-uniform lens distortion** in the original photo causing uneven edge warping
2. **Edge curvature that varies non-linearly** - simple averaging misses local bowing
3. **Insufficient sampling density** for sub-pixel edge detection on highly curved edges
4. **Asymmetric corner errors** - each corner may have different residual distortion

## Problem Analysis

### Current Behavior (from `analyze_border_distortion.py`)

**Test Results Summary:**

- `thing-1_warp.png`: RMS=8.075 px, MAX=45.753 px - **CRITICAL** (right edge has massive deviation, left edge has outlier)
- `thing-2_warp.png`: RMS=5.068 px, MAX=35.442 px - **CRITICAL** (similar pattern)
- `thing-3_warp.png`: RMS=0.931 px, MAX=3.104 px - **MODERATE** (edges bowed, corners off by 2-3 px)
- `zelda-poster-1_warp.png`: RMS=0.724 px, MAX=1.937 px - **ACCEPTABLE but not ideal** (bottom edge 2px too high, subtle curvature)
- `zelda-poster-2_warp.png`: RMS=0.938 px, MAX=2.519 px - **ACCEPTABLE but not ideal**
- `zelda-poster-3_warp.png`: RMS=0.781 px, MAX=2.375 px - **ACCEPTABLE but not ideal**

### Detailed Issue Patterns

#### Issue 1: Right Edge Massive Misalignment (thing-1, thing-2)

- **Right edge error distribution:** Some points off by -45.75 px, others by +0.8 px
- **Root cause:** The current edge detection is sampling at the wrong rows in some areas, possibly hitting non-blue pixels (camera image or frame border)
- **Visible symptom:** Right side of `_crop.png` is cut off; rightmost pixel column is misaligned

#### Issue 2: Bottom Edge Consistently Too High

- **Pattern:** Bottom edge typically 1.3-2.3 px above expected position
- **Direction:** Consistently negative error (border is north of target)
- **Root cause:** The bottom edge detection logic uses reversed scanning (`prof[::-1]`), and the sub-pixel refinement may not be accounting for the frame border transition correctly

#### Issue 3: Top Edge Has Curvature

- **Pattern:** Curvature of 1.6-2.9 px; left side different from right side
- **Issue:** Indicates the initial perspective transformation didn't fully remove camera lens distortion
- **Visible symptom:** Top of `_crop.png` shows some rows slightly misaligned

#### Issue 4: Left and Right Edges Not Equally Straight

- **Left edge curvature:** 1.4-4.7 px
- **Right edge curvature:** 0.9-2.8 px (slightly better but not consistent)
- **Pattern:** Suggests asymmetric lens distortion not fully corrected by perspective transform

#### Issue 5: Corner Misalignment

- **All corners off by 0.3-2 px** (ideally should be <0.5 px)
- **Top-left corner:** Often 1-2 px to the left and slightly high
- **Top-right corner:** Often slightly high (0.4-1.9 px)
- **Bottom edges:** Consistently 1-3 px too high
- **Root cause:** Corners are derived from edge samples, so edge detection errors propagate to corners

### Impact on Downstream Steps

**Crop step consequences:**

- With bottom edge 2px too high, the crop boundary is 2px off, causing camera image pixels to be cut off on the bottom
- With right edge offset left by 1-4px, right-most pixel columns are partially cut off
- Results in visible misalignment in the `_crop.png` output

**Quantize/Sample steps:**

- Pixel alignment errors propagate through color quantization
- Misaligned pixels get assigned wrong colors
- Results in degraded image quality and test failures

## Root Causes

### 1. Insufficient Edge Detection Robustness

The `_first_dark_from_frame()` function uses only a 1D profile scan with Gaussian smoothing and parabolic interpolation. This works well for perfectly sharp transitions but fails when:

- The frame border is not perfectly aligned with rows/columns (perspective residuals)
- Sub-pixel color bleeding causes gradual transitions rather than sharp drops
- Multiple pixels in the search region match the "dark" threshold

**Current implementation issue:** It finds the sharpest gradient but doesn't verify it's actually finding the blue border vs other image content.

### 2. Edge Curvature Not Properly Modeled

The current refinement only computes average edge position and assumes a simple linear translation is sufficient. But:

- Lens distortion causes **non-linear** edge curvature
- A single homography correction cannot fix arbitrary non-linear distortion
- Multi-point edge sampling detects this but the correction doesn't apply it properly

### 3. Incomplete Validation and Correction

The current two-pass refinement:

1. Detects edge curvature via multi-point sampling
2. Computes average curvature per edge
3. Adjusts corner positions proportionally with fixed `corr_scale=0.45`

**Problems:**

- The `corr_scale` is fixed rather than adaptive per-edge
- Multi-point data is computed but then averaged away - the local curvature information is lost
- No iterative refinement based on validation results
- No per-corner independent correction for asymmetric errors

### 4. Bottom Edge Reverse Scanning Quirk

The bottom edge uses:

```python
prof = channel[int(r1):int(r2), col].astype(float)
idx = _first_dark_from_frame(prof[::-1])
y_pos = int(r2 - 1) - idx - (scale - 1)
```

This reverses the profile, so `_first_dark_from_frame` searches from bottom-up. The arithmetic `r2 - 1 - idx - (scale - 1)` may have off-by-one errors or frame-to-border offset miscalculations.

## Proposed Solution

### Architecture Overview

Implement a **multi-stage edge refinement pipeline** that:

1. **Stage 1: Dense Edge Sampling**
   - Sample border position at many more points (17-21 per edge instead of 9)
   - Use improved color-space based detection (explicitly look for blue #9494FF)
   - Reject outliers and validate each sample

2. **Stage 2: Edge Straightness Correction**
   - Fit a polynomial or spline to detected edge points
   - If curvature detected, compute per-row/column correction offsets
   - Build a local warp map to straighten each edge independently

3. **Stage 3: Corner Refinement**
   - Detect corners from straightened edge data
   - Apply per-corner correction if residual errors remain
   - Validate corner alignment

4. **Stage 4: Validation & Iteration**
   - Run border validation after each refinement
   - If errors exceed threshold, apply additional correction pass
   - Cap iterations to prevent infinite loops

### Stage 1: Improved Edge Detection

**Key changes:**

```python
def detect_border_points_robust(channel, scale, samples_per_edge=17):
    """
    Robust multi-point border detection using color-space matching.

    - Samples 17-21 points per edge
    - Uses explicit #9494FF color matching in addition to brightness
    - Returns both detected positions and quality scores
    - Flags outliers for later filtering
    """
    # For each sample point, compute both:
    # 1. Brightness-based edge (current _first_dark_from_frame)
    # 2. Color-distance edge: find where RGB distance to #9494FF is minimal

    # Return results with quality scores and outlier flags
    # Outlier detection: compare each point to neighbors;
    # if deviates >2px from local trend, flag as unreliable
```

**Benefits:**

- Multiple detection methods can cross-validate each other
- Outliers can be filtered or given lower weight
- Quality scores enable adaptive refinement

### Stage 2: Edge Straightness Correction

**Key changes:**

```python
def compute_edge_straightness_map(detected_points, expected_line, scale):
    """
    Given multi-point edge samples, compute a correction map.

    - Fit a 2D polynomial to the detected points
    - Compute deviation from a perfectly straight line at each point
    - Build per-pixel offset map for straightening
    - Return polynomial coefficients and residual curvature
    """
    # If max curvature > threshold (e.g., 1.0 px):
    #   Apply high-order polynomial warp to straighten edge
    # Else:
    #   Use simple translation
```

**Benefits:**

- Handles non-linear distortion that perspective transform cannot fix
- Asymmetric edge curvature is corrected per-edge independently
- Local pixel-accurate straightening

### Stage 3: Corner Refinement

**Key changes:**

```python
def refine_corners_from_straightened_edges(edge_data):
    """
    After edges are straightened, corners are at intersections.

    - Corner TL = intersection of straightened top and left edges
    - Handle floating-point intersections with sub-pixel precision
    - Validate corners are at correct locations (16 px in from edge)
    """
```

**Benefits:**

- Corners are automatically aligned once edges are straight
- Eliminates corner-specific compensation logic

### Stage 4: Validation & Iteration

**Key changes:**

```python
def validate_and_refine_iteratively(img, current_M, warped, scale, max_iterations=3):
    """
    Multi-pass refinement with validation feedback.

    for iteration in range(max_iterations):
        detected_edges = detect_border_points_robust(warped, scale)
        validation = measure_border_quality(detected_edges)

        if validation.max_error < 0.2 px:
            break  # Good enough

        # Apply Stage 1-3 corrections
        warped, M = apply_refinements(...)

    return warped, M, validation_results
```

**Benefits:**

- Continues refining until acceptable quality is reached
- Prevents under-correction
- Early exit if quality achieved quickly

### Implementation Plan

#### File: `gbcam_warp.py`

1. **Add new helper functions:**
   - `detect_border_points_robust()` - enhanced multi-point detection
   - `compute_edge_straightness_map()` - polynomial edge fitting
   - `apply_edge_straightness_correction()` - pixel-level edge straightening
   - `validate_and_refine_iteratively()` - multi-pass refinement wrapper

2. **Enhance existing functions:**
   - `_validate_inner_border()` - already validates; add detailed curvature reporting
   - `refine_warp()` - replace simple averaging with Stage 1-4 pipeline

3. **Key algorithm improvements:**

   **Bottom edge fix:**

   ```python
   # Fix the off-by-one in bottom edge detection
   # Change from: y_pos = int(r2 - 1) - idx - (scale - 1)
   # To: y_pos = r2 - 1 - idx - scale + 1 = r2 - idx - scale
   # Or better: explicitly define frame-to-border offset
   ```

   **Multi-point sampling:**

   ```python
   # Increase from 9 to 17 sample points per edge
   for point_frac in np.linspace(0.0, 1.0, 17):
       # Take multiple measurements at each point
       # Use median or mode if duplicates differ
   ```

   **Color-space validation:**

   ```python
   # In addition to brightness, verify detected pixels are near #9494FF
   # Reject samples if color is outside expected range
   ```

#### File: `analyze_border_distortion.py`

This diagnostic script is already created and working well. It will be used to:

- Validate improvements after each code change
- Generate before/after comparisons
- Quantify overall quality metrics

### Expected Outcomes

After implementation:

**Immediate metrics:**

- `_warp.png` RMS error: < 0.1 px (vs current 0.7-8 px)
- `_warp.png` max error: < 0.3 px (vs current 1.9-45 px)
- All edges perfectly straight (curvature < 0.1 px)
- All corners aligned to 16-pixel expected positions (±0.1 px)

**Downstream improvements:**

- `_crop.png` has zero blue border bleed on any edge
- Right-most pixel column is fully captured without clipping
- Bottom pixel row is fully captured without clipping
- Quantize step sees perfectly aligned pixels → higher color accuracy
- Test suite pass rate increases (currently fails due to pixel misalignment)

### Validation Strategy

1. **Unit testing:** For each improved function, verify on known-good test cases

2. **Regression testing:** Run `analyze_border_distortion.py` on all 6 test files
   - Track RMS and max errors before/after
   - Verify no edges regress in quality

3. **Visual inspection:** Manually check `_warp.png` files
   - Draw vertical/horizontal lines at expected border positions
   - Overlay on actual warp output to visually verify alignment

4. **End-to-end testing:** Run full `python run_tests.py`
   - Verify test pass rates improve
   - Check that `_crop.png` outputs look correct

### Implementation Timeline

1. **Phase 1 (Immediate):** Fix obvious bugs (bottom edge arithmetic, etc.)
   - Estimated impact: -1-2 px error reduction
   - Time: 30 minutes

2. **Phase 2:** Implement Stage 1 (improved edge detection)
   - Estimated impact: -2-3 px error reduction
   - Time: 1-2 hours

3. **Phase 3:** Implement Stage 2 (edge straightness correction)
   - Estimated impact: -3-5 px error reduction
   - Time: 2-3 hours

4. **Phase 4:** Implement Stage 4 (validation & iteration)
   - Estimated impact: -1-2 px error reduction
   - Time: 1 hour

5. **Phase 5:** Testing & refinement
   - Time: 1-2 hours

**Total estimated time:** 6-9 hours for complete implementation

### Risk Mitigation

**Risk 1:** Increased computation complexity / slower execution

- Mitigation: Profile performance; multi-point sampling should still be <100ms per image

**Risk 2:** Over-correction breaking good cases

- Mitigation: Use adaptive thresholds; iterate until good-enough rather than perfect

**Risk 3:** Edge straightness correction introduces artifacts

- Mitigation: Apply only when curvature detected; start with small corrections

## Success Criteria

✓ All 6 test files have RMS error < 0.1 px  
✓ No file has max error > 0.3 px  
✓ All edges are straight (curvature < 0.1 px)  
✓ All corners are aligned (±0.1 px from expected)  
✓ `_crop.png` outputs show no blue border bleed  
✓ Test suite pass rate improves by ≥20%  
✓ `python run_tests.py` shows clear improvement in quality metrics

## Files Affected

- `gbcam_warp.py` - Primary implementation file
- `analyze_border_distortion.py` - Already created, used for validation
- All `_warp.png`, `_crop.png` outputs will improve

## References

- Frame geometry: `gbcam_common.py` (INNER_TOP=15, INNER_LEFT=15, etc.)
- Reference frame: `supporting-materials/Frame 02.png`
- ASCII reference: `supporting-materials/frame_ascii.txt`
- Current diagnostic output: `test-output/*/debug/*_correction_offsets_*.png`

---

**Next Steps:**

1. Implement Phase 1: Fix obvious arithmetic bugs in bottom/right edge detection
2. Run `analyze_border_distortion.py` to validate improvements
3. Proceed with Phase 2 implementation
