# Color Correction Fix Plan

**Date:** 2026-03-18
**Problem:** Color correction step produces RGB values that deviate significantly from target palette colors, making accurate quantization impossible.

---

## Problem Analysis

### Actual vs Target RGB Values (from test images)

| Color | Target RGB | Actual RGB Range | Deviation |
|-------|-----------|------------------|-----------|
| **BK** #000000 | (0, 0, 0) | R: 60-132<br>G: 5-46<br>B: 91-120 | **SEVERE**: Black is way too bright!<br>Should be near 0, but R/B are 60-132 |
| **DG** #9494FF | (148, 148, 255) | R: 138-194<br>G: 126-144<br>B: 144-169 | **CRITICAL**: B should be 255 but only 144-169 (57-66%)<br>R/G are close to 148 |
| **LG** #FF9494 | (255, 148, 148) | R: 223-246<br>G: 123-154<br>B: 115-143 | **MODERATE**: R is 9-32 points low<br>G/B are reasonably close |
| **WH** #FFFFA5 | (255, 255, 165) | R: 229-254<br>G: 215-248<br>B: 103-147 | **SIGNIFICANT**: G should be 255 but 215-248 (7-40 points low)<br>B is 18-62 points low |

### Detailed Example (zelda-poster-3):
```
Color | Target        | Actual         | Error
------|---------------|----------------|------------------
BK    | (  0,  0,  0) | (105, 23, 103) | R+105, G+23, B+103
DG    | (148,148,255) | (173,131, 153) | R+25, G-17, B-102 ← B is critically wrong!
LG    | (255,148,148) | (237,131, 116) | R-18, G-17, B-32
WH    | (255,255,165) | (244,218, 126) | R-11, G-37, B-39
```

---

## Root Causes

### 1. **B Channel Normalized to Wrong Target** ⚠️ CRITICAL
**Current behavior** (line 554-564 in gbcam_correct.py):
```python
# B channel — white-surface normalisation -> 165
corr_B = img_rgb[:, :, 2] * (165.0 / white_surf_B)
```

**Problem:**
- B channel is normalized so the white frame (brightest region) becomes 165
- But **DG has B=255**, which is BRIGHTER than WH.B=165!
- This is backwards: DG.B (255) > WH.B (165) > LG.B (148) > BK.B (0)
- Normalizing to 165 crushes DG.B down to ~150 instead of letting it reach 255

**Why this is wrong:**
- The code assumes white frame has the brightest B value
- But in the actual palette, DG (#9494FF - blue) has B=255, not WH (#FFFFA5 - yellow)
- Yellow (WH) has LESS blue than pure blue (DG)!

### 2. **No True Black Anchor**
**Current behavior:**
- Correction uses DG border (target 148,148,255) as "dark" anchor
- But BK (0,0,0) is MUCH darker than DG
- Affine model (gain + offset) assumes linear interpolation between two levels
- Can't properly map 4 distinct color levels with only 2 anchors

**Result:**
- Black pixels (BK) don't get pushed to true (0,0,0)
- They stay at elevated values like (105,23,103)
- No reference point for "true black" in the correction model

### 3. **G Channel Under-Correcting for WH**
**Current behavior:**
- WH should have G=255 but achieves only G=215-248
- The two-anchor model (WH.G=255, DG.G=148) should work but doesn't quite reach target

**Possible causes:**
- Polynomial refinement over-correcting interior regions
- Edge blending reducing correction strength near frame
- Not enough calibration samples for WH regions

### 4. **Fundamental Model Limitation**
**Current approach:**
- Per-channel affine correction: `corrected = (observed - offset) / gain`
- Uses TWO anchors per channel (white surface and dark surface)
- But we have FOUR distinct colors with complex RGB relationships:
  - BK: (0, 0, 0)
  - DG: (148, 148, 255) ← High B
  - LG: (255, 148, 148) ← High R
  - WH: (255, 255, 165) ← High R and G

**Problem:**
- Two-anchor affine model can't properly separate 4 colors
- Each channel needs different treatment based on the color
- E.g., B channel needs to distinguish DG.B=255 from WH.B=165 from LG.B=148 from BK.B=0

---

## Proposed Solutions

### **Solution A: Fix B Channel Target** ✅ HIGH PRIORITY

**Change B channel normalization from 165 to 255:**

```python
# B channel — white-surface normalisation -> 255 (not 165!)
log("  B: white-surface normalisation -> 255")
wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 2)
white_surf_B = fit_surface(wy, wx, wv, H, W, poly_degree)
corr_B = np.clip(img_rgb[:, :, 2] * (255.0 / np.maximum(white_surf_B, 5.0)),
                 0.0, 255.0).astype(np.float32)
```

**Expected effect:**
- DG pixels will now reach B~255 (correct!)
- WH pixels will have B~165 after scaling (correct ratio)
- LG pixels will have B~148 (correct ratio)
- BK pixels will have B~0-50 (better, though still not perfect)

**Rationale:**
- The white frame is NOT the brightest B region - it's yellow, not blue
- We need to normalize to the maximum possible B value (255)
- Then the relative B values will naturally fall into place
- This is the single most important fix

### **Solution B: Add Black Anchor from Dark Border** ⚠️ MEDIUM PRIORITY

**Use dark area outside the frame as BK reference:**

Current correction uses:
- White: frame (#FFFFA5)
- Dark: inner border (#9494FF with G=148)

Add third anchor:
- Black: dark area outside the GB screen (true black background)

**Implementation approach:**
```python
# Sample dark pixels from the area outside the GB screen (y < FRAME_THICK*scale)
# Use bottom 5th percentile as black reference
black_samples = gray[0:FRAME_THICK*scale, :]
black_ref = float(np.percentile(black_samples, 5))

# Three-anchor piecewise linear correction:
# [0, black_ref] -> [0, 0]           (true black region)
# [black_ref, dark_ref] -> [0, 148]  (black to DG)
# [dark_ref, white_ref] -> [148, 255] (DG to WH)
```

**Challenges:**
- Dark border area may not be truly black (front-light illumination)
- May have artifacts from phone camera exposure
- Piecewise linear is more complex than single affine transform

**Alternative:** Don't add black anchor; let quantization handle it
- After fixing B channel, RG-based classification may be sufficient
- Black pixels will cluster in low-RG region
- Can use lightness threshold in HSL space to separate BK from DG

### **Solution C: Two-Anchor B Channel Correction** ⚠️ ALTERNATIVE TO A

**Use both DG border (B=255) and WH frame (B=165) as anchors for B:**

```python
# B channel — two-anchor correction like G channel
# Dark anchor: DG inner border (target B=255)
# Bright anchor: WH frame (target B=165)
# Wait... this is backwards! DG.B > WH.B

# Actually, we need:
# Bright anchor: DG regions (target B=255)
# Mid anchor: WH frame (target B=165)
```

**Problem with this approach:**
- DG border has the HIGHEST B (255), not the lowest
- Can't use it as "dark" anchor
- Would need to identify DG pixels first (chicken-and-egg problem)

**Verdict:** Solution A (normalize to 255) is simpler and better

### **Solution D: Improve G Channel Correction** 🔷 LOW PRIORITY (fine-tuning)

**Current G correction is close but not perfect (WH.G = 215-248 instead of 255)**

**Potential fixes:**
1. **Reduce edge blending margin** (currently 4 GB pixels):
   - Edge blending may be pulling WH.G down near frame edges
   - Try reducing `blend_margin` from `4 * scale` to `2 * scale`

2. **Use higher percentile for white samples** (currently 85th):
   - WH frame samples at p85 may be pulling down the target
   - Try p90 or p95 for white samples

3. **Post-correction global scaling**:
   - Already implemented (Stage 2, lines 566-593)
   - Should ensure frame = exactly (255, 255, 165)
   - But interior pixels may still be slightly off

4. **Verify white surface polynomial degree**:
   - Currently degree=2 (default)
   - May need degree=3 for more complex gradients
   - But higher degree risks overfitting

**Recommendation:** Fix B channel first, then reassess if G needs tuning

---

## Implementation Plan

### Phase 1: Critical Fix - B Channel Target ✅ MUST DO

**File:** `gbcam_correct.py`, lines 554-564

**Change:**
```python
# OLD:
log("  B: white-surface normalisation -> 165")
wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 2)
white_surf_B = fit_surface(wy, wx, wv, H, W, poly_degree)
corr_B = np.clip(img_rgb[:, :, 2] * (165.0 / np.maximum(white_surf_B, 5.0)),
                 0.0, 255.0).astype(np.float32)

# NEW:
log("  B: white-surface normalisation -> 255")
wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 2)
white_surf_B = fit_surface(wy, wx, wv, H, W, poly_degree)
corr_B = np.clip(img_rgb[:, :, 2] * (255.0 / np.maximum(white_surf_B, 5.0)),
                 0.0, 255.0).astype(np.float32)
```

**Also update Stage 2 global normalization target:**

Line 572:
```python
# OLD:
_TARGET_FRAME = np.array([255.0, 255.0, 165.0])  # #FFFFA5

# NEW:
# NOTE: After spatial correction, frame B will be ~255 (normalized to max).
# Global scaling will bring it down to exactly 165 for #FFFFA5.
# We need to find the B value that corresponds to WH after spatial correction.
# Since DG.B=255 and WH.B=165, and frame is WH, the frame should have B~165
# But we normalized to 255, so frame B will be 255 * (frame_actual / max_B_in_image)
# This is complex... let's keep the global normalization as-is.
_TARGET_FRAME = np.array([255.0, 255.0, 165.0])  # #FFFFA5 - frame should be this after global norm
```

**Actually, wait - this won't work correctly!**

The global normalization (Stage 2) measures the frame and scales to (255, 255, 165). But if we normalize B to 255 in Stage 1, the frame will have B~255, and then Stage 2 will scale it down to 165.

But then DG pixels (which should be B=255) will ALSO get scaled down!

**We need a different approach for B channel.**

### Revised Solution for B Channel: Two-Point Correction

**Problem:** We need:
- DG regions: B=255 (highest)
- WH frame: B=165 (mid)
- LG pixels: B=148 (mid-low)
- BK pixels: B=0 (lowest)

**Current approach:**
- Normalize frame (WH) to B=165
- But this leaves DG at B~150 instead of 255

**Better approach:**
1. **Spatial correction (Stage 1):** Normalize B so that DG border → 255
   - Use DG inner border as the "bright" anchor for B (target 255)
   - This is the opposite of R/G which use WH frame as bright anchor!

2. **Global normalization (Stage 2):** Leave B as-is
   - Don't apply global B scaling
   - Or adjust target based on expected DG value

**Implementation:**

```python
# B channel — inner border normalisation -> 255
# Unlike R and G, the inner border (#9494FF blue, B=255) is the BRIGHTEST
# B region, not the frame (which is yellow, B=165).
log("  B: inner-border normalisation -> 255")

# Collect DG inner border B values (same as we do for G channel)
left_b  = np.array([_gb_block_sample_ch_color(img_rgb, gy, INNER_LEFT,  scale, 2)
                     for gy in range(INNER_TOP, INNER_BOT + 1)])
right_b = np.array([_gb_block_sample_ch_color(img_rgb, gy, INNER_RIGHT, scale, 2)
                     for gy in range(INNER_TOP, INNER_BOT + 1)])
top_b   = np.array([_gb_block_sample_ch_color(img_rgb, INNER_TOP, gx, scale, 2)
                     for gx in range(INNER_LEFT, INNER_RIGHT + 1)])
bot_b   = np.array([_gb_block_sample_ch_color(img_rgb, INNER_BOT, gx, scale, 2)
                     for gx in range(INNER_LEFT, INNER_RIGHT + 1)])

# Build Coons patch for B (represents spatial variation of DG border B)
dark_surf_B = build_dark_surface(left_b, right_b, top_b, bot_b, H, W, scale, dark_smooth)

# Normalize so DG border → 255
corr_B = np.clip(img_rgb[:, :, 2] * (255.0 / np.maximum(dark_surf_B, 5.0)),
                 0.0, 255.0).astype(np.float32)

# Now:
# - DG pixels will have B ≈ 255 ✓
# - WH pixels will have B ≈ 255 * (165/255) ≈ 165 ✓
# - LG pixels will have B ≈ 255 * (148/255) ≈ 148 ✓
# - BK pixels will have B ≈ 255 * (0/255) ≈ 0 ✓
```

**Stage 2 adjustment:**
```python
# For B channel, we normalized to DG.B=255, so frame (WH) will be around 165-180
# We need to check if frame B is close to expected WH.B=165
# If it's higher (e.g., 180), scale down. If lower (e.g., 150), scale up.

# Actually, after normalizing to DG border, the frame should naturally be at 165
# because WH.B=165 and DG.B=255, and we normalized to DG=255.
# So we may not need global B scaling, or only minor adjustment.

# Let's measure frame B and see if it's close to 165.
# Only apply global scaling if it's off by more than 10%.
if abs(frame_p85[2] - 165.0) > 16.5:  # >10% error
    global_scales[2] = 165.0 / frame_p85[2]
    corrected_rgb[:, :, 2] = np.clip(
        corrected_rgb[:, :, 2] * global_scales[2], 0, 255)
else:
    global_scales[2] = 1.0  # No adjustment needed
```

---

### Phase 2: Test and Validate

**Run tests after Phase 1 fix:**
```bash
.venv/Scripts/python.exe run_tests.py
```

**Check corrected values:**
```bash
.venv/Scripts/python.exe analyze_correction.py
```

**Expected improvements:**
- DG.B: 144-169 → ~240-255 (near 255)
- WH.B: 103-147 → ~155-175 (near 165)
- LG.B: 115-143 → ~135-155 (near 148)
- BK.B: 91-120 → ~10-50 (closer to 0)

**If DG.B is still not reaching 255:**
- Check if DG border samples are being collected correctly
- Verify Coons patch is not under-estimating border brightness
- May need to use higher percentile (75th instead of 50th) for border samples

**If BK is still too bright:**
- Proceed to Phase 3 (black anchor)
- Or rely on HSL quantization to separate BK by lightness

---

### Phase 3: Optional Refinements

**3A. Add Black Anchor** (if BK still too bright after Phase 1):
- Sample dark pixels outside GB screen
- Apply piecewise correction: [true_black, DG_level] → [0, 148/255 depending on channel]

**3B. Fine-tune G Channel** (if WH.G still < 250):
- Reduce edge blending margin
- Increase white sample percentile
- Adjust refinement pass parameters

**3C. Add Better Debug Logging:**
```python
# After correction, log actual RGB values for each color class
# This helps verify correction is working
if debug:
    # Sample interior pixels and cluster them
    # Report mean RGB for each cluster
    # Compare to target values
```

---

## Success Criteria

### Quantitative Targets

After correction, the mean RGB values for each color class should be:

| Color | Target | Acceptable Range |
|-------|--------|------------------|
| **BK** | (0, 0, 0) | R: 0-30, G: 0-20, B: 0-40 |
| **DG** | (148, 148, 255) | R: 130-165, G: 130-165, B: 235-255 |
| **LG** | (255, 148, 148) | R: 235-255, G: 130-165, B: 130-165 |
| **WH** | (255, 255, 165) | R: 240-255, G: 240-255, B: 150-180 |

**Key improvements needed:**
1. ✅ DG.B: 144-169 → 235-255 (**+91-86 points**)
2. ✅ BK: (60-132, 5-46, 91-120) → (0-30, 0-20, 0-40) (**much darker**)
3. 🔷 WH.G: 215-248 → 240-255 (**+10-25 points**)

### Qualitative Checks

1. **Visual inspection:**
   - Before/after correction images should show normalized colors
   - Frame should look uniformly yellow (#FFFFA5)
   - DG border should look uniformly blue (#9494FF)

2. **Quantization accuracy:**
   - After fixing correction, quantization should achieve >99% accuracy
   - LG/WH confusion should drop dramatically (1403 errors → <50)
   - BK under-detection should improve significantly (363 errors → <20)

3. **HSL properties:**
   - DG hue: ~240° (blue)
   - LG hue: ~0° (red)
   - WH hue: ~60° (yellow)
   - BK lightness: <30%

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| B normalization to DG breaks frame | Medium | High | Verify frame B = ~165 after correction; add safety check in global norm |
| DG border B is not uniform | Low | Medium | Use Coons patch to model spatial variation |
| Black still too bright | High | Medium | Phase 3: add black anchor from dark border |
| G channel gets worse | Low | Low | Only tune G if needed after fixing B |
| Over-correction artifacts | Medium | Medium | Monitor edge regions; adjust blending if needed |

---

## Notes

1. **Why B channel is special:**
   - For R and G: WH (255, 255, ...) is brightest → normalize to 255
   - For B: DG (..., ..., 255) is brightest, not WH (..., ..., 165)
   - This is because DG is blue (#9494FF) and WH is yellow (#FFFFA5)
   - Yellow has less blue component than pure blue!

2. **Why current code uses B=165:**
   - Line 555: "Target WH.B = 165 (#FFFFA5 is warm yellow, not pure white)"
   - The intention was correct (WH should be 165)
   - But the method was wrong (normalizing white frame to 165)
   - Should normalize to DG=255, which makes WH naturally fall to 165

3. **Affine vs multi-point correction:**
   - Current: affine (gain + offset) with 2 anchors per channel
   - Challenge: 4 color levels don't fit perfectly into 2-anchor model
   - B channel is special case: DG.B=max, not WH.B=max
   - May need piecewise linear for perfect correction, but simple fixes should get us close enough

4. **Interaction with quantization:**
   - After fixing correction, HSL-based quantization should work well
   - Hue will separate LG/WH/DG cleanly
   - Lightness will separate BK from others
   - B channel will correctly distinguish DG (high B) from WH/LG (mid B)

---

**End of Plan**
