# Warp Step Border Distortion - Analysis & Plan Summary

**Created:** March 28, 2026  
**Purpose:** Comprehensive analysis of border alignment issues and detailed solution plan

## Deliverables

### 1. **PLAN-fix-warp-distortion.md** (15 KB)

Comprehensive solution architecture document including:

- **Executive Summary:** Problem overview and severity
- **Problem Analysis:**
  - Current behavior across 6 test files (RMS errors 0.7-8 px)
  - Detailed issue patterns (right edge massive misalignment, bottom edge consistently high, curvature, corner misalignment)
  - Impact on downstream steps (crop, quantize)
- **Root Causes:** 4 specific architectural issues identified
- **Proposed Solution:** Multi-stage refinement pipeline (4 stages)
- **Implementation Plan:** Detailed changes to `gbcam_warp.py`
- **Success Criteria:** Clear metrics (RMS < 0.1 px, max error < 0.3 px)
- **Validation Strategy:** Unit, regression, visual, and end-to-end testing

### 2. **analyze_border_distortion.py** (13 KB)

Diagnostic tool for analyzing border positioning in `_warp.png` files:

**Features:**

- Samples 13 points along each edge (top, bottom, left, right)
- Compares detected border positions to expected positions
- Computes:
  - Per-edge RMS and max errors
  - Edge curvature (max - min error)
  - Straightness validation
  - Corner alignment errors
  - Overall quality metrics

**Usage:**

```bash
# Analyze all test files
python analyze_border_distortion.py --dir test-output

# Analyze single file with verbose output
python analyze_border_distortion.py test-output/zelda-poster-3/zelda-poster-3_warp.png --verbose

# Analyze sample pictures
python analyze_border_distortion.py --dir sample-pictures-out --verbose
```

**Output:**

```
SUMMARY (6 files analyzed)
======================================================================
FAIL thing-1_warp.png                                    RMS=8.075  MAX=45.753
FAIL thing-2_warp.png                                    RMS=5.068  MAX=35.442
FAIL thing-3_warp.png                                    RMS=0.931  MAX=3.104
FAIL zelda-poster-1_warp.png                             RMS=0.724  MAX=1.937
FAIL zelda-poster-2_warp.png                             RMS=0.938  MAX=2.519
FAIL zelda-poster-3_warp.png                             RMS=0.781  MAX=2.375
```

## Analysis Findings

### Problem Severity Distribution

**Critical Issues (RMS > 5 px):**

- `thing-1_warp.png`: RMS=8.075 px, MAX=45.753 px
  - Right edge has extreme deviation with spike of 45.75 px at row fraction 0.33
  - Left edge has outlier of 17.06 px at row fraction 0.67
  - Visible right-edge clipping in downstream crop

- `thing-2_warp.png`: RMS=5.068 px, MAX=35.442 px
  - Similar pattern to thing-1
  - Right edge critical error

**Moderate Issues (1 px < RMS < 2 px):**

- `thing-3_warp.png`: RMS=0.931 px (edges have 1-2 px curvature)
- `zelda-poster-*.png` files: RMS=0.7-0.9 px

### Pattern Analysis

**All files share these characteristics:**

- **Bottom edge consistently too high** (1-3 px above expected position)
- **Top edge has curvature** (1.6-2.9 px bowing)
- **Right edge worse than left** (curvature 0.9-2.8 px vs 1.4-4.7 px)
- **Corners misaligned by 0.3-2 px**

### Root Cause Classification

1. **Insufficient Edge Detection Robustness** (affects all files)
   - 1D profile scanning misses local variations
   - Doesn't validate color (#9494FF) is actually present
2. **Edge Curvature Not Properly Modeled** (affects all files)
   - Lens distortion creates non-linear curvature
   - Simple homography can't fix all residual distortion
3. **Incomplete Validation and Correction** (affects all files)
   - Fixed `corr_scale=0.45` not adaptive
   - Multi-point data computed but then averaged away
   - No iterative refinement
4. **Bottom Edge Reverse Scanning Quirk** (affects all files)
   - Potential off-by-one errors in bottom edge arithmetic
   - `y_pos = int(r2 - 1) - idx - (scale - 1)` may have accuracy issues

## Key Insights

### Why Current Approach Fails

The current refinement algorithm:

1. Detects 4 corners using band-based sampling
2. Computes average edge position
3. Averages edge curvature across all points
4. Applies single correction factor to corners

**Problem:** This loses the spatial variation data. For example:

- Top edge curvature is +0.4 px at left, +1.2 px at right
- Averaging to +0.8 px, then applying to both corners, fixes neither perfectly
- Local curvature persists in the output

### Why thing-1 and thing-2 Have Massive Errors

The right edge detection appears to be sampling the wrong region entirely in some rows:

- Row fraction 0.33 shows -45.75 px error (off by nearly 3 pixels worth of warped space)
- Row fraction 0.67 shows -30.30 px error
- This suggests the search window `c1, c2 = max(0, int(exp_right - srch)), min(W, int(exp_right + srch))` is capturing non-border pixels

Possible causes:

- Perspective warp is so incorrect initially that the border window misses the actual border
- Subpixel detection finds a noise peak instead of border transition
- Color bleeding from adjacent pixels confuses detection

## Implementation Priority

Per the solution plan:

**Phase 1 (Immediate):** Fix obvious bugs

- Bottom edge arithmetic verification
- Right edge window validation
- Expected impact: -1-2 px

**Phase 2 (Core):** Improved edge detection

- Multi-point robust detection
- Color-space validation
- Expected impact: -2-3 px

**Phase 3 (Advanced):** Edge straightness correction

- Polynomial edge fitting
- Per-edge independent correction
- Expected impact: -3-5 px

**Phase 4 (Robustness):** Validation & iteration

- Multi-pass refinement
- Early exit on convergence
- Expected impact: -1-2 px

## Expected Outcomes After Implementation

**Metrics:**

- RMS error < 0.1 px (vs current 0.7-8 px)
- Max error < 0.3 px (vs current 1.9-45 px)
- All edges perfectly straight (curvature < 0.1 px)

**Visible Improvements:**

- `_crop.png` has zero blue border bleed
- Right-most pixel column fully captured
- Bottom pixel row fully captured
- Quantize step sees perfectly aligned pixels

**Test Suite:**

- Pass rate should improve by ≥20%
- All test files should pass quality checks

## How to Proceed

1. **Review the plan:** Read `PLAN-fix-warp-distortion.md` in detail
2. **Validate current state:** Run `python analyze_border_distortion.py --dir test-output --verbose` before implementation
3. **Implement Phase 1:** Start with arithmetic fixes and validation
4. **Test iteratively:** After each change, re-run `analyze_border_distortion.py` to track progress
5. **Full validation:** Once target metrics are reached, run `python run_tests.py` for end-to-end verification

## Files Reference

- **Plan document:** `PLAN-fix-warp-distortion.md`
- **Diagnostic tool:** `analyze_border_distortion.py`
- **Implementation target:** `gbcam_warp.py`
- **Frame reference:** `supporting-materials/Frame 02.png`
- **ASCII reference:** `supporting-materials/frame_ascii.txt`
- **Test outputs:** `test-output/*/zelda-poster-*_warp.png`

---

**Status:** Analysis complete, ready for implementation  
**Estimated effort:** 6-9 hours for full implementation
