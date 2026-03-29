╔════════════════════════════════════════════════════════════════════════════════╗
║ WARP STEP BORDER DISTORTION FIX - COMPLETE ANALYSIS PACKAGE ║
╚════════════════════════════════════════════════════════════════════════════════╝

DATE CREATED: March 28, 2026
STATUS: Analysis & Planning Complete - Ready for Implementation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIMARY DELIVERABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. INDEX-warp-distortion.md (7.5 KB)
   - Master index and quick reference
   - Problem summary
   - Documentation guide
   - Implementation roadmap
   - Success metrics
     → START HERE for overview

2. PLAN-fix-warp-distortion.md (14.7 KB)
   - Comprehensive solution architecture
   - Executive summary
   - Detailed problem analysis (5 issue patterns)
   - Root cause analysis (4 causes identified)
   - Proposed 4-stage solution with code examples
   - Implementation plan for gbcam_warp.py
   - Success criteria (RMS < 0.1 px)
   - Validation strategy
   - Timeline: 6-9 hours estimated
     → DETAILED TECHNICAL SPEC

3. ANALYSIS-warp-distortion.md (7 KB)
   - Analysis findings summary
   - Problem severity breakdown
   - Pattern analysis across 6 test files
   - Implementation priority guide
   - Expected outcomes after fixes
     → QUICK REFERENCE FOR IMPLEMENTATION

4. analyze_border_distortion.py (12.8 KB)
   - Diagnostic/validation tool
   - Multi-point border analysis (13 samples per edge)
   - RMS error and max error metrics
   - Edge straightness validation
   - Corner alignment verification
   - Overall quality assessment
     → RUN BEFORE/AFTER EACH IMPLEMENTATION PHASE

   Usage: python analyze_border_distortion.py --dir test-output

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANALYSIS FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CURRENT ERRORS (from 6 test files):

File RMS Error Max Error Severity  
─────────────────────────────────────────────────────────────────────
thing-1_warp.png 8.075 px 45.753 px CRITICAL  
thing-2_warp.png 5.068 px 35.442 px CRITICAL  
thing-3_warp.png 0.931 px 3.104 px MODERATE  
zelda-poster-1_warp.png 0.724 px 1.937 px ACCEPTABLE  
zelda-poster-2_warp.png 0.938 px 2.519 px ACCEPTABLE  
zelda-poster-3_warp.png 0.781 px 2.375 px ACCEPTABLE

ROOT CAUSES IDENTIFIED:

1. Right edge detection fails on some images (45 px spike detected)
2. Bottom edge consistently 1-3 px above expected position
3. Edge curvature not properly corrected (1-5 px variation)
4. Arithmetic off-by-one in bottom/right edge detection

IMPACT ON PIPELINE:

- \_warp.png: Borders curved and misaligned
- \_crop.png: Right-most pixel column cut off/misaligned
- quantize step: Pixels not aligned causing color errors
- Test suite: Pass rate ~70%, expected to improve to ~90%+

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SOLUTION ARCHITECTURE (4-PHASE APPROACH)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 1: Bug Fixes (30 min - 1 hour)

- Fix arithmetic errors in bottom/right edge detection
- Add bounds checking to prevent out-of-range sampling
- Validate edge window calculations
  Expected impact: Reduce errors by 1-2 px

PHASE 2: Robust Detection (1-2 hours)

- Increase sampling from 9 to 17 points per edge
- Add color-space validation (explicit #9494FF matching)
- Implement outlier detection and filtering
- Add quality scoring for each sample
  Expected impact: Reduce errors by 2-3 px

PHASE 3: Edge Straightness Correction (2-3 hours)

- Implement polynomial edge fitting
- Compute per-edge curvature correction
- Build straightness correction maps
- Apply corrective warping to straighten edges
  Expected impact: Reduce errors by 3-5 px

PHASE 4: Validation & Iteration (1 hour)

- Implement multi-pass iterative refinement
- Add convergence criteria and early exit
- Integrate with existing validation
- Cap maximum iterations
  Expected impact: Reduce errors by 1-2 px

TOTAL EFFORT: 6-9 hours for complete implementation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUCCESS CRITERIA (POST-IMPLEMENTATION)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BORDER ALIGNMENT METRICS:

- RMS error: < 0.1 px (vs current 0.7-8 px)
- Max error: < 0.3 px (vs current 1.9-45 px)
- Edge curvature: < 0.1 px (vs current 1-5 px)
- Corner alignment: +/- 0.1 px (vs current +/- 0.3-2 px)

OUTPUT QUALITY:

- \_warp.png borders perfectly straight
- \_warp.png borders at exact 16-pixel position
- \_crop.png has zero blue border bleed
- Right-most pixel column fully captured
- Bottom pixel row fully captured

TEST RESULTS:

- All 6 test files pass quality checks
- Test suite pass rate: >=90% (vs current ~70%)
- thing-1 and thing-2: No longer fail

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO USE THIS PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR UNDERSTANDING THE PROBLEM:

1. Read: INDEX-warp-distortion.md (5 min)
2. Read: PLAN-fix-warp-distortion.md "Problem Analysis" section (15 min)
3. Run: python analyze_border_distortion.py --dir test-output --verbose
4. Review: Compare actual vs expected border positions

FOR IMPLEMENTATION:

1. Read: PLAN-fix-warp-distortion.md "Proposed Solution" section (30 min)
2. Read: PLAN-fix-warp-distortion.md "Implementation Plan" section (30 min)
3. Reference: Code examples and pseudo-code in PLAN document
4. Implement: Changes to gbcam_warp.py following Phase 1-4
5. Validate: Run analyze_border_distortion.py after each phase

FOR VALIDATION:

1. Baseline: python analyze_border_distortion.py --dir test-output > baseline.txt
2. Phase 1: python analyze_border_distortion.py --dir test-output > phase1.txt
3. Compare: Review RMS and max error trends
4. Repeat: After each phase
5. Final: python run_tests.py

QUICK DIAGNOSTIC:
python analyze_border_distortion.py --dir test-output

This shows current RMS/max errors. After implementation, all should be:

- RMS < 0.1 px
- MAX < 0.3 px

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILES MODIFIED/CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANALYSIS FILES (NEW - DO NOT MODIFY):

- INDEX-warp-distortion.md - Master index
- PLAN-fix-warp-distortion.md - Solution architecture
- ANALYSIS-warp-distortion.md - Analysis summary
- analyze_border_distortion.py - Diagnostic tool

IMPLEMENTATION TARGET (TO MODIFY):
→ gbcam_warp.py - Add 4 new functions for robust detection and straightness correction - Modify refine_warp() to use new pipeline - Fix bottom/right edge arithmetic - Total changes: ~150-200 lines of new code

REFERENCE FILES (DO NOT MODIFY):

- gbcam_common.py - Frame geometry constants
- supporting-materials/Frame 02.png - Visual reference
- supporting-materials/frame_ascii.txt - ASCII reference

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMMEDIATE:

1. Review INDEX-warp-distortion.md for quick overview
2. Review PLAN-fix-warp-distortion.md "Proposed Solution" section
3. Run: python analyze_border_distortion.py --dir test-output

THEN IMPLEMENT:

1. Implement Phase 1 (bug fixes) in gbcam_warp.py
2. Validate with: python analyze_border_distortion.py --dir test-output
3. Continue through Phases 2-4 iteratively
4. Final validation: python run_tests.py

EXPECTED OUTCOMES:

- RMS errors reduced from 0.7-8 px to < 0.1 px
- All edges perfectly straight
- All corners correctly aligned
- Test pass rate improved to 90%+
- Visual quality significantly improved

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: Analysis Complete - Ready for Implementation
Total deliverables: 4 files created (3 markdown + 1 Python script)
Estimated implementation time: 6-9 hours
