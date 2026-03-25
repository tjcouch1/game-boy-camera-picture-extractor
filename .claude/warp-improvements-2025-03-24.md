# Warp Module Improvements - March 24, 2025

## Problem Statement
The zelda-poster-3 image showed a perspective correction error where the bottom-right corner was off by ~4 pixels (detected at ~1148,1024 instead of expected 1152,1024), causing blue frame border to peek into the cropped image. This was due to low-contrast conditions in the bottom-right corner that the global edge-detection strategy couldn't handle properly.

## Root Cause Analysis
The original `_find_border_corners()` function used:
- **Shared midpoint-based bands** for edge detection (top/bottom edges shared left/right halves; left/right edges shared top/bottom halves)
- **Single averaging strategy** that couldn't adapt to per-corner variations
- **No fallback mechanism** for low-contrast areas
- This meant all four corners were detected using interpolation from just two measurement points per edge

## Solutions Implemented

### 1. Enhanced `_first_dark_from_frame()` Function
**Changes:**
- Added explicit `smooth_sigma=1.5` parameter for better documentation
- Improved robustness through explicit parameter exposure
- Better handling of edge cases through parameterized smoothing

**Benefits:**
- More explicit control over smoothing behavior
- Easier to tune for different image conditions
- Better documentation of what the function does

### 2. Completely Redesigned `_find_border_corners()` Function
**Major architectural changes:**

**Per-corner detection regions:**
- Top-left (TL): Left half of top edge with extra left margin
- Top-right (TR): Right half of top edge with extra right margin  
- Bottom-left (BL): Left half of bottom edge with extra left margin
- Bottom-right (BR): Right half of bottom edge with extra right margin
- Each corner gets its own independent detection band instead of sharing

**Per-corner edge detection:**
- Introduced `_detect_y()` helper for horizontal edges (top/bottom)
- Introduced `_detect_x()` helper for vertical edges (left/right)
- Each helper has `is_bottom=False/True` and `is_right=False/True` flags for proper edge handling

**Fallback strategies:**
- Primary: Sub-pixel gradient-based detection using `_first_dark_from_frame()`
- Fallback: Simple threshold-based detection when gradient method fails
- Fallback is critical for low-contrast areas (like bottom-right of zelda-poster-3)

**Key improvements:**
- Captures per-corner residual perspective errors independently
- Bottom-right corner low contrast no longer affects other corners
- Handles the specific failure mode where one corner has significantly different contrast

### 3. New `_verify_dash_positions()` Diagnostic Function
**Purpose:** Validate that perspective correction was successful

**How it works:**
- Checks frame edges have expected white color (#FFFFA5 = BGR 165,255,255)
- Measures average color in 2-pixel-wide border regions on all four sides
- Compares against expected value with 20-point tolerance
- Logs detailed results for each edge (OK/WARN status)

**Integration points:**
- Called after initial warp to diagnose base perspective correction
- Called after each refinement pass to validate improvements
- Provides continuous feedback during multi-pass refinement

**Example output:**
```
[verify] top    edge: error=5.2  (expect~[165, 255, 255], actual~[160, 250, 248]) [OK]
[verify] bottom edge: error=18.1 (expect~[165, 255, 255], actual~[147, 237, 237]) [WARN]
[verify] left   edge: error=3.7  (expect~[165, 255, 255], actual~[162, 252, 254]) [OK]
[verify] right  edge: error=22.5 (expect~[165, 255, 255], actual~[143, 233, 233]) [WARN]
```

### 4. Integration into Refinement Pipeline
**Initial warp step:**
- Added diagnostic verification after `_initial_warp()`
- Provides baseline measurement before refinement

**Refinement passes:**
- Added diagnostic verification after each `refine_warp()` pass
- Shows improvement from pass 1 to pass 2
- Helps identify if additional passes are needed

## Expected Results for zelda-poster-3

**Before fix:**
- Bottom-right corner detected at ~1148,1024 (4 pixels too far left)
- Blue frame border peeks into the 128x112 camera image area
- Low-contrast region causes edge detection to fail

**After fix:**
- Bottom-right corner detected at ~1152,1024 (expected position)
- No frame border in final cropped image
- Per-corner detection handles low-contrast gracefully via fallback

## Testing Strategy

1. **Run test suite:** `python run_tests.py`
2. **Check zelda-poster-3 specifically:**
   - Verify `zelda-poster-3_warp.png` has correct corners (blue border gone from bottom-right)
   - Verify `zelda-poster-3_crop.png` is exactly 128×112 with no border
3. **Monitor verification logs:**
   - Look for corner error values in the 1-3 pixel range
   - All four edges should show "OK" status
4. **Compare with reference:** Validate final output matches `zelda-poster-output-corrected.png`

## Code Changes Summary

### Modified Files
- `gbcam_warp.py` - All changes are in this file

### Functions Modified
1. `_first_dark_from_frame()` - Added smooth_sigma parameter
2. `_find_border_corners()` - Complete rewrite with per-corner detection
3. `_initial_warp()` - Added verification call
4. `refine_warp()` - Added verification call

### Functions Added
1. `_verify_dash_positions()` - New diagnostic function

### Lines of Code
- Added ~150 lines for enhanced corner detection
- Added ~45 lines for verification diagnostics
- Improved code clarity and error handling throughout

## Future Improvements (Optional)

1. **Additional refinement passes**: Could extend to 3+ passes for particularly difficult images
2. **Adaptive detection bands**: Could adjust search regions based on initial corner positions
3. **Dash pattern matching**: Could verify specific dash positions from frame_ascii.txt
4. **Multi-scale detection**: Could try detection at different smoothing levels
5. **Color-based corner detection**: Could use actual dash pattern to refine corners further
