# Warp Step Distortion Fix - Documentation Index

**Created:** March 28, 2026  
**Status:** Analysis & Planning Complete - Ready for Implementation

## Quick Summary

The warp step's border alignment has been analyzed and diagnosed. The inner `#9494FF` border should be exactly at the 16th pixel in from each edge, but current implementation produces borders that are:

- **Misaligned:** 0.7-8 px off target (RMS error)
- **Curved:** 1-5 px variation along each edge
- **Asymmetric:** Right edge worse than left edge
- **Affecting downstream:** Causes pixel clipping in `_crop.png` and color misalignment in quantize step

## Documentation Files Created

### 1. **PLAN-fix-warp-distortion.md** ← **START HERE**

**Comprehensive solution architecture (15 KB)**

Contains:

- Executive summary
- Detailed problem analysis (6 root causes identified)
- Proposed 4-stage solution pipeline
- Implementation plan for `gbcam_warp.py`
- Success criteria and validation strategy
- Risk mitigation
- Timeline estimate (6-9 hours)

**Key sections:**

- Problem Analysis (4 detailed issue patterns)
- Root Causes (insufficient detection, non-linear distortion, etc.)
- Proposed Solution (4-stage pipeline)
- Implementation Plan (specific code changes needed)
- Success Criteria (RMS < 0.1 px, max error < 0.3 px)

### 2. **ANALYSIS-warp-distortion.md**

**Analysis findings and implementation guide (7 KB)**

Contains:

- Problem severity distribution (critical vs moderate)
- Pattern analysis across 6 test files
- Root cause classification
- Key insights explaining why current approach fails
- Implementation priority and phases
- Expected outcomes after fixes

### 3. **analyze_border_distortion.py** ← **VALIDATION TOOL**

**Diagnostic script for border quality analysis (13 KB)**

**What it does:**

- Samples 13 points along each edge of a `_warp.png` file
- Detects actual vs expected border positions
- Computes RMS error, max error, edge curvature
- Validates straightness and corner alignment
- Reports overall quality metrics

**How to use:**

```bash
# Analyze all test files
python analyze_border_distortion.py --dir test-output

# Analyze single file
python analyze_border_distortion.py test-output/zelda-poster-3/zelda-poster-3_warp.png

# Verbose mode with per-point details
python analyze_border_distortion.py --dir test-output --verbose
```

**Sample output:**

```
SUMMARY (6 files analyzed)
FAIL thing-1_warp.png                                    RMS=8.075  MAX=45.753
FAIL thing-2_warp.png                                    RMS=5.068  MAX=35.442
FAIL thing-3_warp.png                                    RMS=0.931  MAX=3.104
FAIL zelda-poster-1_warp.png                             RMS=0.724  MAX=1.937
```

## How to Use This Documentation

### For Understanding the Problem

1. Read: **PLAN-fix-warp-distortion.md** → "Problem Analysis" section (30 min)
2. Run: `python analyze_border_distortion.py --dir test-output --verbose` (10 min)
3. Review: Detailed error patterns showing which images are worse

### For Implementation

1. Read: **PLAN-fix-warp-distortion.md** → "Proposed Solution" section (30 min)
2. Read: **PLAN-fix-warp-distortion.md** → "Implementation Plan" section (30 min)
3. Reference: Code examples in solution section
4. Implement: Changes to `gbcam_warp.py` following Phase 1-4 plan
5. Validate: Run `analyze_border_distortion.py` after each phase

### For Validation

1. Baseline: `python analyze_border_distortion.py --dir test-output > baseline.txt`
2. After Phase 1: `python analyze_border_distortion.py --dir test-output > phase1.txt` (compare)
3. After each phase: Track RMS error and max error trends
4. Final validation: `python run_tests.py` to verify overall improvement

## Key Findings

### Current Error Distribution

- **Unacceptable:** thing-1 (8.1 px RMS), thing-2 (5.1 px RMS)
- **Acceptable but suboptimal:** thing-3 through zelda-poster-3 (0.7-0.9 px RMS)

### Root Causes (from most to least critical)

1. **Right edge detection fails on some images** (45 px error spike)
2. **Bottom edge consistently 1-3 px too high** (systematic error)
3. **Edge curvature not properly corrected** (1-5 px variation along edges)
4. **Corner arithmetic has potential off-by-one issues** (bottom/right edges)

### Critical Issues to Fix

- Right edge search window may be capturing wrong pixels
- Bottom edge arithmetic: `y_pos = int(r2 - 1) - idx - (scale - 1)` needs review
- Current averaging approach loses spatial variation data
- Need denser sampling (13 → 17+ points per edge)

## Implementation Roadmap

### Phase 1: Bug Fixes (30 min - 1 hour)

- [ ] Verify/fix bottom edge arithmetic
- [ ] Verify/fix right edge window calculation
- [ ] Add bounds checking to prevent out-of-range samples
- **Target:** Reduce critical errors to <10 px

### Phase 2: Robust Detection (1-2 hours)

- [ ] Implement `detect_border_points_robust()`
- [ ] Add color-space validation (#9494FF matching)
- [ ] Add outlier detection and filtering
- [ ] Increase samples per edge to 17
- **Target:** Reduce all errors to <3 px

### Phase 3: Edge Straightness (2-3 hours)

- [ ] Implement polynomial edge fitting
- [ ] Add per-edge curvature correction
- [ ] Build straightness correction map
- [ ] Apply corrective warp to straighten edges
- **Target:** Reduce curvature to <0.5 px

### Phase 4: Validation Loop (1 hour)

- [ ] Implement `validate_and_refine_iteratively()`
- [ ] Add multi-pass refinement with early exit
- [ ] Integrate with existing validation
- **Target:** Achieve RMS < 0.1 px on all files

### Phase 5: Testing (1-2 hours)

- [ ] Run diagnostic tool on all phases
- [ ] Visual inspection of output
- [ ] Full `run_tests.py` validation
- [ ] Check for regressions

## Success Metrics

**Before → After targets:**

| Metric               | Before               | After              |
| -------------------- | -------------------- | ------------------ |
| RMS error (all)      | 0.7-8 px             | < 0.1 px           |
| Max error (all)      | 1.9-45 px            | < 0.3 px           |
| Edge straightness    | 0.9-4.7 px curvature | < 0.1 px curvature |
| Corner alignment     | ±0.3-2 px            | ±0.1 px            |
| thing-1/thing-2 pass | ✗                    | ✓                  |
| Test suite pass rate | ~70%                 | ~90%+              |

## Files Modified/Created

### New Files (created during analysis)

- `PLAN-fix-warp-distortion.md` - Solution architecture
- `ANALYSIS-warp-distortion.md` - Analysis findings
- `analyze_border_distortion.py` - Diagnostic tool
- This index file

### Files to Modify (during implementation)

- `gbcam_warp.py` - Primary implementation (add 4 new functions, modify `refine_warp()`)

### Reference Files (do not modify)

- `gbcam_common.py` - Frame geometry constants
- `supporting-materials/Frame 02.png` - Visual reference
- `supporting-materials/frame_ascii.txt` - ASCII reference

## Quick Reference: Error Patterns

### thing-1_warp.png (CRITICAL)

- **Right edge:** Spike at row 0.33 (error -45.75 px), spike at row 0.67 (error -30.30 px)
- **Bottom edge:** Consistently 2.3-3.0 px too high
- **Issue:** Right edge detection completely fails in middle rows

### zelda-poster-3_warp.png (MODERATE)

- **Top edge:** Curvature 1.6 px (left lower than right)
- **Bottom edge:** 1.4 px too high
- **Right edge:** Curvature 2.8 px
- **Issue:** Subtle but consistent distortion pattern

## Next Steps

1. **Review** PLAN-fix-warp-distortion.md thoroughly (especially "Proposed Solution")
2. **Baseline** current state: `python analyze_border_distortion.py --dir test-output`
3. **Implement** Phase 1 (bug fixes)
4. **Validate** with diagnostic tool
5. **Continue** through Phases 2-4
6. **Final test** with `python run_tests.py`

---

**Total implementation effort:** 6-9 hours  
**Expected improvement:** RMS error reduction from 0.7-8 px to <0.1 px  
**Expected test pass rate improvement:** +20%+
