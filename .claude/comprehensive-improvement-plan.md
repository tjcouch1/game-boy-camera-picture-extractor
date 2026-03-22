# Comprehensive Color Detection Improvement Plan - Iterative Approach

**Date:** 2026-03-18
**Goal:** Achieve >99% accuracy on all 6 test images through systematic investigation and iterative improvement

---

## Summary of What Has Been Tried

### Attempt 1: HSL-Based Quantization (color-detection-improvement-plan.md)

**Approach:** Replace RGB-distance classification with HSL hue-distance classification
**Rationale:** The four colors have distinct hues (Red 0°, Yellow 60°, Blue 240°, Black low-L)
**Implementation:**

- Added RGB→HSL conversion
- Used hue distance to classify DG/LG/WH
- Used lightness threshold for BK
- Removed WH→LG spatial smoothing

**Results:** ❌ FAILED - 51-82% accuracy (avg 70%, worse than 89% baseline)
**Root Cause:** Corrected RGB values are too inaccurate for HSL to work

- LG pixels compute hue ~159° (cyan) instead of 0° (red)
- DG pixels compute hue ~281° (purple) instead of 240° (blue)
- Garbage RGB in → garbage HSL out

### Attempt 2: B Channel Correction Fix (color-correction-fix-plan.md)

**Approach:** Fix B channel normalization to target DG.B=255 instead of WH.B=165
**Rationale:** DG (#9494FF blue) has B=255, brighter than WH (#FFFFA5 yellow) B=165
**Implementation:**

- Changed B channel to normalize to DG inner border (B=255)
- Disabled global B scaling

**Results:** ❌ FAILED - B values still severely wrong
**Actual corrected values:**

- DG.B: Still 153 instead of 255 (102 points low!)
- WH.B: Still 126 instead of 165
- Problem persists despite targeting correct anchor

**Root Cause:** Warmth preprocessing saturates B channel

- After warmth correction, both DG border and WH frame have B~240-250 (too close)
- Insufficient dynamic range for spatial correction to separate them
- Two-anchor affine model can't recover correct relative B values

---

## Critical New Observation: Color Correction Creating Artifacts

### The Heatmap Problem ⚠️ CRITICAL DISCOVERY

**User observation:** _"thing-2 and zelda-poster-2 corrected images have severely warped colors matching the heatmap patterns"_

**Visual evidence:**

- Heatmap shows red (hot) center, blue (cool) edges
- Corrected images show yellow/bright center, purple/dark edges
- The pattern matches EXACTLY - the polynomial surface fit is creating **ARTIFICIAL gradients**

**Analysis of corrected images:**

- **thing-2_correct\_\_crop_a_region.png:**
  - Center: Overly yellow/bright (over-corrected)
  - Edges: Overly purple/dark (under-corrected)
  - Severe color warping visible across the image

- **zelda-poster-2_correct\_\_crop_a_region.png:**
  - Same pattern: yellow center, purple edges
  - Matches white surface heatmap gradient
  - Image looks "wrong" - colors are clearly distorted

**Implication:**
The polynomial surface fitting is **NOT modeling the actual illumination gradient correctly**. It's creating smooth polynomial curves that don't match the real (possibly non-smooth, non-polynomial) lighting pattern. The correction is introducing artifacts worse than the original illumination problem!

### Test Accuracy Correlation with Correction Quality

| Test           | Accuracy | Observation                        |
| -------------- | -------- | ---------------------------------- |
| thing-1        | 96.04%   | ✅ Best - correction looks good    |
| thing-3        | 95.24%   | ✅ Good - correction looks good    |
| zelda-poster-1 | 95.42%   | ✅ Good - correction looks good    |
| zelda-poster-3 | 86.75%   | ⚠️ Moderate - some warping visible |
| thing-2        | 84.04%   | ❌ Poor - SEVERE color warping     |
| zelda-poster-2 | 76.33%   | ❌ Worst - SEVERE color warping    |

**Clear pattern:** Images with severe correction artifacts have worst quantization accuracy!

---

## Key Learnings

### 1. Color Correction is the Bottleneck ⭐ PRIMARY ISSUE

- Quantization (nearest-RG) already achieves 89% average with current correction
- The remaining 10% gap to 99% is due to **poor color correction**
- Fixing correction quality → quantization will naturally improve

### 2. Polynomial Surface Fitting Has Fundamental Issues

- Degree-2 polynomials create smooth gradients that may not match reality
- Real illumination may have non-smooth variations, sharp transitions, local anomalies
- **Over-fitting in center, under-fitting at edges** - exactly what we see!
- Different images need different approaches - one size does NOT fit all

### 3. Per-Image Variation is Significant

- thing-2 and zelda-poster-2 have **severe** issues
- thing-1 and thing-3 are **nearly perfect**
- Different images need different correction approaches
- A single polynomial degree/method doesn't work for all images

### 4. B Channel Cannot Be Fixed with Current Approach

- Warmth preprocessing destroys B channel dynamic range
- Affine correction with 2 anchors insufficient for 4 color levels
- Need fundamentally different approach for B
- **May need to abandon B correction and rely on RG-only quantization**

### 5. The Four Colors ARE Distinguishable in Raw Images ⭐ KEY INSIGHT

- User observation: _"each image has all four colors easily distinguishable"_
- The raw phone pictures have **good color separation**
- **We're DESTROYING the color information with bad correction!**
- May not even need aggressive spatial correction if quantization is smart enough

### 6. The Heatmap May Be Misleading

- Current heatmap shows the **FITTED polynomial surface**, not actual data
- This is circular: it shows the model we're questioning
- Need to visualize **actual sample points** and their variation
- Need to see where polynomial deviates from reality

---

## Suggestions for Potential Next Steps

### Priority 1: Investigate Why Polynomial Creates Artifacts 🔴 CRITICAL

**The polynomial fitting is clearly wrong for thing-2 and zelda-poster-2. Why?**

**Investigations needed:**

1. **Visualize actual white sample data:**
   - Scatter plot of (Y, X, brightness) for all collected white samples
   - Do samples actually show a smooth gradient, or are they more uniform?
   - Are there outliers pulling the polynomial fit?
   - Compare thing-1 (good) vs thing-2 (bad) sample distributions

2. **Measure polynomial fitting error:**
   - Compute residuals at each sample point: actual - fitted
   - Create residual heatmap (separate from fitted surface heatmap)
   - Where is polynomial most wrong? Center? Edges? Corners?

3. **Test alternative polynomial degrees:**
   - Try degree 0 (no spatial correction, just global mean)
   - Try degree 1 (flat plane - linear gradient only)
   - Try degree 3, 4 (more complex curves)
   - Measure quantization accuracy for each degree on each image
   - **Hypothesis:** degree-1 or even degree-0 might work better for some images

4. **Check for systematic bias:**
   - Is polynomial consistently over-correcting center?
   - Is it consistently under-correcting edges?
   - This suggests model mismatch, not just fitting error

**Expected outcome:**

- Understand whether polynomial model is appropriate
- Identify if some images need different degrees
- May discover simpler correction (degree-1 or global-only) works better

### Priority 2: Analyze Per-Image Characteristics 🔴 CRITICAL

**Why do thing-2 and zelda-poster-2 fail while others succeed?**

**Investigations needed:**

1. **Measure input image properties:**

   ```python
   - Frame uniformity (std dev of frame regions)
   - Border uniformity (std dev of border regions)
   - Overall brightness and contrast
   - Color temperature indicators
   - Histogram shapes per channel
   ```

2. **Compare problem vs good images:**
   - What's different about thing-2's raw pixels?
   - Does it have unusual lighting pattern?
   - Different exposure? More noise? Different camera settings?

3. **Classify image types:**
   - Easy: uniform illumination, needs minimal correction
   - Medium: mild gradient, needs linear correction
   - Hard: complex/non-smooth gradient, needs special handling

4. **Design adaptive strategy:**
   - Measure metrics on input image
   - Select correction approach based on metrics
   - Different images → different methods

**Expected outcome:**

- Understanding of what makes images different
- Ability to automatically detect problem cases
- Design adaptive correction pipeline

### Priority 3: Test Warmth Correction Impact 🟡 HIGH

**Is warmth correction helping or hurting?**

**Investigations needed:**

1. **Disable warmth completely:**
   - Run full pipeline without warmth correction
   - Measure accuracy on all 6 tests
   - Compare corrected RGB values to targets

2. **Test partial warmth strengths:**
   - Try 25%, 50%, 75% of current warmth correction
   - Find optimal strength per image or globally

3. **Measure B channel impact:**
   - Before warmth: what's B value span from frame to border?
   - After warmth: what's B value span?
   - Quantify dynamic range loss

4. **Visual inspection:**
   - Do images look more color-accurate without warmth?
   - Is warmth introducing color casts that hurt quantization?

**Expected outcome:**

- Determine if warmth should be disabled, reduced, or kept as-is
- May discover warmth is hurting more than helping
- May explain B channel issues

### Priority 4: Use All Four Frame Colors as Correction Anchors 🔴 CRITICAL NEW APPROACH

**The frame contains ALL FOUR palette colors - use them all!**

**Current problem:**

- Only using WH (frame background) and DG (inner border) as anchors
- Ignoring BK (black dashes) and LG (appears in frame) samples
- Missing valuable reference points distributed across the image

**New approach - Four-Color Frame-Based Correction:**

```python
# Sample all four colors from the frame at their known locations
# (See supporting-materials/frame_ascii.txt for exact positions)

def collect_frame_color_samples(img_rgb, scale):
    """
    Sample all four colors from frame based on Frame 02.png layout.
    Returns: dict with keys 'BK', 'DG', 'LG', 'WH', each containing
             (y_positions, x_positions, rgb_values) arrays
    """
    samples = {'BK': [], 'DG': [], 'LG': [], 'WH': []}

    # Parse frame_ascii.txt to find exact positions of each color
    # Or hardcode known positions based on frame structure:
    # - Black dashes at specific positions in frame
    # - DG inner border at GB rows/cols 15 and 128/144
    # - LG at specific frame positions (see Frame 02.png)
    # - WH in frame background areas

    # For each color, collect samples at their known positions
    # This gives us spatial distribution of all four target colors!

    return samples

# Use all four colors for correction
# Instead of fitting polynomial to just WH samples,
# fit to all four color types with their target values
# This gives us 4 anchors across the image instead of just 2!
```

**Advantages:**

- 4 anchors instead of 2 → better constrained correction
- True black reference (BK dashes) → can correct black properly
- Spatial distribution → polynomial has samples from all areas
- Built-in validation → corrected frame should match target colors exactly

**Implementation priority:** Try this BEFORE alternative correction methods!

### Priority 5: Alternative Correction Methods 🟡 HIGH

**If four-color frame correction still doesn't work, try alternatives:**

**Potential alternatives:**

1. **No spatial correction, just global color balance:**

   ```python
   # Measure mean RGB of frame, scale to (255, 255, 165)
   # Apply same scaling globally
   # Hypothesis: spatial variation is small, not worth modeling
   ```

2. **Frame-based normalization (non-parametric):**

   ```python
   # For each pixel, find distance to nearest frame pixel
   # Interpolate correction based on distance
   # Use actual frame values, not fitted polynomial
   ```

3. **Piecewise correction (divide and conquer):**

   ```python
   # Divide image into 3x3 or 4x4 grid
   # Correct each region independently with local statistics
   # Avoids global polynomial over-fitting
   ```

4. **Thin-plate spline or RBF interpolation:**

   ```python
   from scipy.interpolate import RBFInterpolator
   # Non-parametric interpolation of scattered white samples
   # Doesn't assume polynomial form
   # More flexible to actual data shape
   ```

5. **Histogram matching:**
   ```python
   # Match histogram of each image to a reference image (thing-1?)
   # Preserves relative color relationships
   # May work better than parametric correction
   ```

**Expected outcome:**

- Find correction method that doesn't create artifacts
- May be simpler (global-only) or more sophisticated (splines)
- Tailored to actual data, not assumed polynomial form

### Priority 5: Improve Quantization Robustness 🟡 HIGH

**Can quantization compensate for imperfect correction?**

**Potential improvements:**

1. **Per-image adaptive clustering:**

   ```python
   # Don't use fixed target colors (0,0,0), (148,148,255), etc.
   # Instead: cluster each image's RGB into 4 groups
   # Map clusters to BK/DG/LG/WH based on cluster means
   # Adapts to whatever correction produced
   ```

2. **Residual gradient removal before quantization:**

   ```python
   # Fit degree-1 polynomial to corrected image
   # Subtract it to remove residual linear gradient
   # Then quantize to nearest color
   # Compensates for mild over/under correction
   ```

3. **Spatial consistency (MRF/graph-cut):**

   ```python
   # Initial quantization may have isolated errors
   # Use neighboring pixel context to smooth result
   # Preserves edges but removes noise
   ```

4. **Multi-pass correction-quantization:**
   ```python
   # 1. Initial correction + quantization
   # 2. For each color class, measure actual mean RGB
   # 3. Refine correction to push means toward targets
   # 4. Re-quantize
   # Iterate until convergence
   ```

**Expected outcome:**

- Quantization becomes more robust to correction errors
- Can achieve high accuracy even with imperfect correction
- May be easier than fixing correction perfectly

### Priority 6: Revisit B Channel with New Approach 🟢 MEDIUM

**After fixing other issues, try B channel again:**

1. **If warmth is disabled/reduced:**
   - B dynamic range may improve
   - Try DG-border normalization again

2. **Alternative: Ignore B in correction, fix in quantization:**
   - Correct R and G only
   - In quantization, use RG to classify, then assign correct B based on class
   - Bypass the B correction problem entirely

3. **Histogram-based B correction:**
   - Target B histogram with peaks at 0, 148, 165, 255
   - Use histogram specification to transform observed B → target B
   - Non-parametric, adapts to actual distribution

---

## Comprehensive Iterative Plan

### Phase 1: Deep Investigation (Iteration 1-3)

#### Iteration 1: Diagnose Polynomial Surface Fitting + Visualize Frame Colors

**Goal:** Understand why polynomial creates center-hot, edge-cool artifacts AND verify frame color locations

**Implement diagnostic tools:**

1. **visualize_frame_colors.py:** ⭐ NEW - CRITICAL TOOL
   - Load Frame 02.png to get exact pixel positions of each color
   - Parse frame_ascii.txt for verification
   - For each test image warp output:
     - Sample RGB at known BK, DG, LG, WH positions in frame
     - Visualize corrected frame with colors labeled
     - Check if frame colors match targets after correction
     - Report mean RGB for each color type in the frame
   - **This tells us if correction is working correctly!**
   - Save annotated visualization showing where each color should be

2. **visualize_white_samples.py:**
   - Load warp image
   - Collect white samples (same as gbcam_correct.py)
   - Create scatter plot: X-axis=x position, Y-axis=y position, color=brightness
   - Overlay fitted polynomial surface as contour lines
   - Save visualization for each test image
   - Compare thing-1 (good) vs thing-2 (bad)

3. **measure_polynomial_error.py:**
   - For each test image:
     - Collect white samples
     - Fit degree-2 polynomial
     - Compute residual at each sample: actual - fitted
     - Report: mean residual, std dev residual, max abs residual
     - Create residual heatmap (actual data, not fitted surface!)

4. **test_polynomial_degrees.py:**
   - Run correction pipeline with degrees 0, 1, 2, 3, 4
   - For each degree, run quantization and measure accuracy
   - Create table: degree vs accuracy for each image
   - Identify optimal degree per image

**Test procedure:**

```bash
.venv/Scripts/python.exe visualize_white_samples.py
.venv/Scripts/python.exe measure_polynomial_error.py
.venv/Scripts/python.exe test_polynomial_degrees.py
```

**Analyze results:**

- Do white samples actually show smooth gradient?
- Are residuals large (bad fit) or small (good fit)?
- Does lower degree (1 or 0) work better for problem images?
- Can we identify image characteristics that predict optimal degree?

**Decision point:**

- If degree-1 works better for all images: switch to degree-1 globally
- If degree-0 works better: disable spatial correction entirely, use global-only
- If optimal degree varies by image: implement adaptive degree selection
- If all degrees are bad: polynomial model is wrong, try alternative method

#### Iteration 2: Analyze Input Image Characteristics

**Goal:** Understand what makes thing-2 and zelda-poster-2 different from thing-1

**Implement:**

```python
# analyze_input_characteristics.py

import cv2
import numpy as np

def measure_frame_uniformity(image, scale=8):
    """Measure std dev of frame regions (should be uniform yellow)."""
    # Sample top frame: rows 0:INNER_TOP, cols 10:SCREEN_W-10
    # Return std dev of R, G, B separately
    pass

def measure_border_uniformity(image, scale=8):
    """Measure std dev of inner border (should be uniform blue)."""
    # Sample border pixels
    # Return std dev of R, G, B
    pass

def classify_image_difficulty(frame_std, border_std):
    """Classify as easy/medium/hard based on uniformity."""
    if frame_std < 10:
        return "easy"
    elif frame_std < 20:
        return "medium"
    else:
        return "hard"

# For each test image:
# - Measure frame uniformity
# - Measure border uniformity
# - Classify difficulty
# - Correlate with quantization accuracy
```

**Test procedure:**

```bash
.venv/Scripts/python.exe analyze_input_characteristics.py
```

**Analyze results:**

- Do thing-2 and zelda-poster-2 have higher frame std dev?
- Do they have unusual histogram shapes?
- Can we predict accuracy from input metrics?

**Decision point:**

- If problem images are identifiable: implement adaptive correction
- If all images look similar in input: problem is in correction method, not input variation

#### Iteration 3: Test Warmth Correction Impact

**Goal:** Determine if warmth correction helps or hurts

**Implement:**

1. Add `--warmth-strength` parameter to gbcam_warp.py:

   ```python
   # Apply warmth with configurable strength:
   warmth_gain = strength * _WARM_GAIN + (1 - strength) * np.ones(3)
   warmth_bias = strength * _WARM_BIAS
   ```

2. Test script:

   ```bash
   for strength in 0.0 0.25 0.5 0.75 1.0; do
       .venv/Scripts/python.exe gbcam_extract.py --warmth-strength $strength ...
       .venv/Scripts/python.exe run_tests.py
   done
   # Compare results
   ```

3. Measure B channel span:
   ```python
   # For each warmth strength:
   # - Measure B value of frame (should be ~165 after ideal correction)
   # - Measure B value of border (should be ~255 after ideal correction)
   # - Report span: border_B - frame_B (should be 90, higher is better)
   ```

**Analyze results:**

- Which warmth strength gives best accuracy?
- Does zero warmth improve B channel dynamic range?
- Visual inspection: do colors look better with or without warmth?

**Decision point:**

- If 0% warmth is best: disable warmth correction
- If 50% warmth is best: reduce warmth strength
- If 100% warmth is best: keep current approach

---

### Phase 2: Implement Top Solutions (Iteration 4-6)

Based on Phase 1 findings, implement the most promising fixes.

#### Iteration 4: Four-Color Frame-Based Correction ⭐ NEW APPROACH

**Use all four frame colors as correction anchors!**

**Implementation:**

```python
# In gbcam_correct.py, add new correction method:

def collect_all_frame_colors(img_rgb, scale):
    """
    Sample all four colors from frame based on known positions.
    Returns dict: {'BK': (ys, xs, rgbs), 'DG': (ys, xs, rgbs), ...}
    """
    # Load or hardcode frame layout from Frame 02.png
    # For each pixel in frame, determine its color:
    # - If it's a black dash → BK
    # - If it's inner border → DG
    # - If it's light frame element → LG
    # - If it's frame background → WH

    # Sample observed RGB at each position
    # Return organized by color type

def correct_with_four_anchors(img_rgb, frame_samples, H, W, scale):
    """
    Correct using all four frame colors as anchors.

    Approach 1: Multi-target polynomial fitting
    - Fit polynomial where target varies by sample type
    - BK samples → target (0, 0, 0)
    - DG samples → target (148, 148, 255)
    - LG samples → target (255, 148, 148)
    - WH samples → target (255, 255, 165)

    Approach 2: Per-color-pair correction
    - Correct BK→WH using BK and WH samples
    - Correct DG→LG using DG and LG samples
    - Blend corrections spatially

    Approach 3: RBF with multiple targets
    - Use RBF interpolation with four target levels
    - Each sample has its own target based on color
    """
    pass
```

**Test procedure:**

```bash
# Add four-color correction mode to gbcam_correct.py
# Run tests and compare to current two-anchor approach
.venv/Scripts/python.exe run_tests.py --four-color-mode
# Check accuracy improvement
# Verify frame colors are correct in output
```

**Success metric:**

- Frame colors should be exactly correct after correction
- BK dashes should be (0, 0, 0) ± 10
- DG border should be (148, 148, 255) ± 10
- LG elements should be (255, 148, 148) ± 10
- WH background should be (255, 255, 165) ± 10
- Quantization accuracy should improve, especially on thing-2 and zelda-poster-2

#### Iteration 5: Fix Polynomial Fitting (if four-color approach doesn't fully solve it)

**Based on Iteration 1 results, choose one:**

**Option A: Adaptive polynomial degree**

```python
# In gbcam_correct.py _process_file_color():
# Measure frame uniformity from input
frame_std = measure_frame_uniformity(img_rgb, scale)
if frame_std < 15:
    poly_degree = 1  # Nearly uniform, simple plane
elif frame_std < 25:
    poly_degree = 2  # Moderate gradient
else:
    poly_degree = 3  # Complex gradient

# Use poly_degree for white surface fitting
```

**Option B: Switch to degree-1 globally**

```python
# If testing shows degree-1 works better for all images:
# Simply change default poly_degree from 2 to 1
```

**Option C: No spatial correction (degree-0)**

```python
# If testing shows spatial correction hurts:
# Skip polynomial fitting, use global mean of frame as target
white_mean = np.mean([v for _, _, v in white_samples])
corrected = img * (255.0 / white_mean)  # Simple global scaling
```

**Option D: Robust polynomial fitting**

```python
# Use iterative outlier rejection:
# 1. Fit polynomial to all samples
# 2. Compute residuals
# 3. Remove samples with |residual| > 2*std
# 4. Re-fit polynomial
# 5. Repeat until convergence
```

**Test procedure:**

```bash
# Implement chosen option
.venv/Scripts/python.exe run_tests.py
# Check if thing-2 and zelda-poster-2 improve
# Verify thing-1 doesn't get worse
```

**Success metric:** thing-2 and zelda-poster-2 visual quality improves (less color warping)

#### Iteration 6: Implement Alternative Correction Method (if polynomial still fails)

**Try non-parametric correction:**

```python
# Option: Frame-based interpolation
def correct_with_frame_interpolation(image, frame_samples, scale):
    """
    For each pixel, compute correction based on nearest frame samples.
    Uses inverse distance weighting of nearby frame sample values.
    """
    H, W = image.shape[:2]
    corrected = np.zeros_like(image, dtype=np.float32)

    # Build KD-tree of frame sample positions
    from scipy.spatial import cKDTree
    sample_positions = np.array([(y, x) for y, x, _ in frame_samples])
    sample_values = np.array([v for _, _, v in frame_samples])
    tree = cKDTree(sample_positions)

    # For each pixel, find K nearest frame samples
    for y in range(H):
        for x in range(W):
            distances, indices = tree.query([y, x], k=5)
            weights = 1.0 / (distances + 1e-6)
            weights /= weights.sum()
            target_brightness = (weights * sample_values[indices]).sum()
            corrected[y, x] = image[y, x] * (255.0 / target_brightness)

    return corrected
```

**Or try thin-plate spline:**

```python
from scipy.interpolate import RBFInterpolator

# Fit RBF to white samples
ys, xs, vals = collect_white_samples(...)
points = np.column_stack([ys, xs])
rbf = RBFInterpolator(points, vals, kernel='thin_plate')

# Evaluate on full image grid
Y, X = np.meshgrid(range(H), range(W), indexing='ij')
grid_points = np.column_stack([Y.ravel(), X.ravel()])
white_surface = rbf(grid_points).reshape(H, W)
```

**Test and compare:**

- Does alternative method reduce color warping?
- Does accuracy improve on problem images?

#### Iteration 7: Improve Quantization to Handle Residual Errors

**Even with better correction, add quantization robustness:**

```python
# Per-image adaptive clustering quantization
def quantize_adaptive(samples_rgb):
    """
    Use k-means to find actual 4 color clusters in this image.
    Map clusters to BK/DG/LG/WH based on cluster means.
    """
    from sklearn.cluster import KMeans

    flat = samples_rgb.reshape(-1, 3)
    km = KMeans(n_clusters=4, random_state=0, n_init=10)
    km.fit(flat)

    # Map each cluster to a target color
    # Cluster with lowest mean RGB → BK
    # Cluster with highest B → DG
    # Cluster with highest R (excluding WH) → LG
    # Cluster with highest R+G → WH
    centers = km.cluster_centers_
    cluster_to_color = map_clusters_to_colors(centers)

    labels = km.labels_.reshape(112, 128)
    # Remap cluster indices to color indices (0=BK, 1=DG, 2=LG, 3=WH)
    final_labels = np.array([cluster_to_color[c] for c in labels.ravel()])
    return final_labels.reshape(112, 128)
```

**Or residual gradient removal:**

```python
# Before quantization, remove residual linear gradient
def remove_residual_gradient(samples_rgb):
    H, W, _ = samples_rgb.shape
    # Fit degree-1 polynomial to each channel
    for ch in range(3):
        surface = fit_degree_1_poly(samples_rgb[:, :, ch], H, W)
        mean_val = samples_rgb[:, :, ch].mean()
        # Subtract fitted surface, add back mean
        samples_rgb[:, :, ch] = samples_rgb[:, :, ch] - surface + mean_val
    return samples_rgb
```

**Test:**

```bash
.venv/Scripts/python.exe run_tests.py
# Check if accuracy improves, especially on borderline cases
```

---

### Phase 3: Refinement and Optimization (Iteration 7-10)

#### Iteration 8: Revisit B Channel (if needed)

**If accuracy still <99% and B channel is identified as remaining issue:**

1. Try ignoring B in correction, fixing in quantization:

```python
# In correction: only correct R and G
# In quantization:
labels = classify_by_RG_only(samples_rgb[:, :, :2])
# Then assign correct B based on label:
output_rgb = COLOR_PALETTE_RGB[labels]  # Gives perfect B values
```

2. Or try histogram-based B correction:

```python
from scipy.ndimage import histogram_matching
# Target histogram: 4 peaks at 0, 148, 165, 255
corrected_B = histogram_matching(observed_B, target_histogram)
```

#### Iteration 9: HSL Quantization Revisit

**After correction improvements, retest HSL:**

```bash
# In gbcam_quantize.py, re-enable HSL classifier
.venv/Scripts/python.exe run_tests.py
.venv/Scripts/python.exe analyze_correction.py
# Check if hues are now correct:
# LG should be hue ~0°
# WH should be hue ~60°
# DG should be hue ~240°
```

**If yes:** HSL should achieve >99% accuracy now

#### Iteration 10: Handle Edge Cases

1. **Black (BK) pixels still too bright:**
   - Add black anchor from dark border outside GB screen
   - Use piecewise correction: [black, DG, WH] anchors

2. **Boundary pixels between colors:**
   - Add spatial smoothing (but careful not to blur edges)
   - Or use median filter only on isolated single-pixel errors

3. **Sample margin optimization:**
   - Test h_margin = 1, 2, 3
   - Test v_margin = 0, 1, 2
   - Find optimal balance of noise vs information

#### Iteration 11: Final Validation

1. Run tests on all 6 images, verify >99% accuracy
2. Test on additional non-test images
3. Verify visual quality (no color warping)
4. Document final parameters and choices
5. Clean up debug code and optimize performance

---

## Testing Protocol - Critical Process

### For EVERY Iteration:

**1. Implement change**

- Make ONE change at a time
- Document what was changed and why

**2. Run full test suite:**

```bash
.venv/Scripts/python.exe run_tests.py
```

**3. DON'T JUST LOOK AT PASS/FAIL - Examine EVERYTHING:**

**Look at test summary:**

- Which tests improved?
- Which tests got worse?
- What's the average accuracy change?

**Look at debug images for EACH test:**

```
test-output/<test>/debug/*_correct*.png  - Is correction better or worse?
test-output/<test>/debug/*_quantize*.png - Is quantization better or worse?
test-output/<test>/*_diag_*.png          - Error patterns changed?
```

**Look at confusion matrices:**

- Which color pairs are still confused?
- Did a specific confusion improve (e.g., LG/WH)?
- Did a new confusion appear?

**Look at RGB value analysis:**

```bash
.venv/Scripts/python.exe analyze_correction.py
# Are corrected RGB values closer to targets?
# Which channel improved? Which got worse?
```

**Look at diagnostic logs:**

- Any warnings or errors?
- Unusual values (NaN, very large/small numbers)?
- Polynomial fitting messages

**4. Record results:**

- Keep spreadsheet or log file tracking:
  - Iteration number
  - What was changed
  - Accuracy for each test
  - Overall average accuracy
  - Visual quality notes

**5. Decide next step:**

- **If accuracy improved:** Continue in same direction, try to improve further
- **If accuracy plateaued:** Try orthogonal approach
- **If accuracy decreased:** Revert change immediately, try alternative
- **If reached >99% on all:** SUCCESS! Proceed to validation phase

---

## Investigation Tools to Build

### 1. visualize_frame_colors.py ⭐ NEW - CRITICAL

```python
# Load Frame 02.png to get exact frame layout
# For each test image:
# - Sample corrected RGB at known BK, DG, LG, WH positions
# - Compare to target colors
# - Visualize frame with color labels
# - Report accuracy of frame color correction
# This is a direct test of correction quality!
```

### 2. visualize_white_samples.py

```python
# Create scatter plot of white sample positions and brightnesses
# Overlay fitted polynomial as contour lines
# Show where samples are sparse/dense
# Highlight outliers
# Compare across images
```

### 3. measure_polynomial_error.py

```python
# For each image:
# - Collect white samples
# - Fit polynomial
# - Compute residuals
# - Report statistics and create heatmap
```

### 4. test_polynomial_degrees.py

```python
# Run full pipeline with different polynomial degrees
# Generate comparison table
# Identify optimal degree per image
```

### 5. analyze_input_characteristics.py

```python
# Measure frame uniformity, border uniformity
# Compute histograms, color statistics
# Classify image difficulty
# Correlate with accuracy
```

### 6. test_warmth_strength.py

```python
# Run pipeline with warmth strengths 0%, 25%, 50%, 75%, 100%
# Measure accuracy for each
# Measure B channel dynamic range
# Find optimal strength
```

### 7. visualize_correction_artifacts.py

```python
# Show before/after correction side-by-side
# Highlight over-corrected (too bright) regions in red
# Highlight under-corrected (too dark) regions in blue
# Create artifact severity heatmap
```

---

## Success Criteria

### Quantitative Goals - PRIMARY:

**All 6 tests achieve >99% pixel accuracy:**

- thing-1: 96.04% → >99% (+3 percentage points)
- thing-2: 84.04% → >99% (+15 points) ← HARDEST CASE
- thing-3: 95.24% → >99% (+4 points)
- zelda-poster-1: 95.42% → >99% (+4 points)
- zelda-poster-2: 76.33% → >99% (+23 points) ← HARDEST CASE
- zelda-poster-3: 86.75% → >99% (+13 points)

### Qualitative Goals - EQUALLY IMPORTANT:

1. **No visible color warping** in corrected images
   - Center and edges should have same color accuracy
   - No yellow-center/purple-edge gradients
   - Frame should look uniformly yellow across all images

2. **Frame uniformly yellow (#FFFFA5)**
   - Std dev of frame RGB should be <15 after correction
   - Visual inspection: frame looks flat color, not gradated

3. **Border uniformly blue (#9494FF)**
   - Std dev of border RGB should be <15 after correction
   - Visual inspection: border looks flat color

4. **Corrected RGB values close to targets:**
   - BK: (0, 0, 0) ± 30
   - DG: (148, 148, 255) ± 20
   - LG: (255, 148, 148) ± 20
   - WH: (255, 255, 165) ± 20

### Process Goals:

- Pipeline is **robust** to variations in input images
- Pipeline is **adaptive** (detects and handles different image types appropriately)
- Pipeline has **good diagnostics** (clear debug output, visualizations)
- Pipeline parameters are **justified** (not arbitrary magic numbers, chosen based on data)

---

## Key Principles for Iteration ⭐ CRITICAL

1. **Measure before changing**
   Always gather data to understand the problem before implementing solutions. Don't guess!

2. **Change one thing at a time**
   Don't make multiple changes simultaneously, or you won't know what helped.

3. **Test thoroughly**
   Run full test suite after each change. Examine ALL debug output, not just pass/fail.

4. **Keep detailed notes**
   Record what was tried, what worked, what didn't, and why. Build institutional knowledge.

5. **Be willing to backtrack**
   If a promising idea doesn't work, revert immediately and try something else. Don't get attached to ideas.

6. **Think critically**
   Don't assume the current approach is correct. Question every step. Challenge assumptions.

7. **Use the user's insights**
   The observation about heatmap matching color warping was CRUCIAL. Pay attention to visual/qualitative feedback.

8. **Remember the goal**
   The raw images have distinguishable colors - we just need to **preserve that information** through the pipeline, not destroy it!

9. **Investigate, don't speculate**
   Build diagnostic tools to SEE what's happening. Visualize data. Measure everything.

10. **Iterate systematically**
    Follow the scientific method: hypothesis → test → analyze → refine. Don't jump randomly between ideas.

---

## Priority Ranking

### 🔴 CRITICAL - Must Do First (Iteration 1-3):

1. **Visualize frame colors** - verify correction quality using all 4 frame colors ⭐ NEW
2. **Investigate polynomial surface fitting** - identified as likely root cause
3. **Analyze thing-2 and zelda-poster-2 failures** - understand worst cases
4. **Test warmth correction impact** - may be destroying B channel

### 🟡 HIGH - Do Next (Iteration 4-7):

5. **Implement four-color frame-based correction** - use all 4 frame colors as anchors ⭐ NEW
6. **Fix polynomial fitting or replace method** - based on investigation results
7. **Implement alternative correction if needed** - non-parametric, simpler methods
8. **Make quantization robust to correction errors** - safety net for imperfect correction

### 🟢 MEDIUM - Refinements (Iteration 8-10):

9. **Revisit B channel correction** - after other fixes, may work better
10. **Retest HSL quantization** - may work if RGB values improve
11. **Handle edge cases** - BK pixels, boundaries, sample margins

### 🔵 LOW - Final Steps (Iteration 11):

12. **Final validation and documentation** - after reaching >99% on all tests

---

## Special Notes and Reminders

### About the Heatmap Visualization

⚠️ **The current heatmap may be misleading!**

- It shows the **FITTED polynomial surface**, not the actual data
- This is circular - it shows the model we're questioning
- Need to visualize **actual sample points** as scatter plot
- Need to visualize **residuals** (actual - fitted) as separate heatmap
- The "red center, blue edges" pattern in heatmap is the FITTED MODEL, not necessarily reality

### About Different Images

📊 **Different images have dramatically different needs:**

- thing-1 is nearly perfect (96%) with current correction
- thing-2 is severely broken (84%) with visible color warping
- May need to classify images and apply different strategies
- One-size-fits-all polynomial doesn't work!

### About Correction vs Quantization

⚖️ **Trade-off between correction quality and quantization sophistication:**

- Perfect correction → simple quantization (nearest color) works
- Imperfect correction → need smart quantization (clustering, adaptation)
- May be easier to improve quantization than achieve perfect correction
- Current quantization is already good (89%), just need better correction

### About B Channel

⛔ **B channel may be unfixable with current approach:**

- Warmth preprocessing destroys dynamic range
- Two-anchor affine model insufficient for 4 color levels
- May need to accept this and work around it:
  - Ignore B in correction, fix in quantization
  - Or use RG-only quantization
  - Or use per-image clustering instead of fixed targets

### About the User's Key Insights

💡 **"Each image has all four colors easily distinguishable"**

- The raw phone pictures have GOOD color separation
- We're DESTROYING it with bad correction!
- This means the problem is SOLVABLE
- We just need to stop breaking what already works
- Maybe less correction is better than more correction!

⭐ **"All four colors appear somewhere in the frame"** - CRITICAL FOR CORRECTION

- The Game Boy frame contains ALL FOUR palette colors:
  - **BK (#000000)**: Black dashes running through the frame
  - **DG (#9494FF)**: Inner border (one pixel thick around camera area)
  - **LG (#FF9494)**: Appears in frame structure (see Frame 02.png)
  - **WH (#FFFFA5)**: Frame background (15-pixel wide strips)

- **Implication:** We can sample all four colors from the frame itself!
  - Currently using only WH (frame) and DG (border) as anchors
  - We're IGNORING BK (dashes) and LG samples in the frame
  - Frame samples are distributed across the image → better spatial coverage
  - Can validate correction by checking if frame colors are correct

- **Reference files:**
  - `supporting-materials/frame_ascii.txt`: ASCII art of exact frame layout
    - ` ` (space) = #FFFFA5 (white/yellow)
    - `·` = #FF9494 (light gray/red)
    - `▓` = #9494FF (dark gray/blue)
    - `█` = #000000 (black)
  - `supporting-materials/Frame 02.png`: Grayscale representation
    - #FFFFFF → #FFFFA5
    - #A5A5A5 → #FF9494
    - #525252 → #9494FF
    - #000000 → #000000

- **Usage:**
  - Sample all four colors from frame at known positions
  - Check if corrected frame matches expected colors
  - Use frame color accuracy as diagnostic for correction quality
  - May be able to improve correction by using all 4 frame colors as anchors

---

## Final Checklist Before Each Iteration

Before implementing any change, ask yourself:

- [ ] Do I understand WHY I'm making this change? (Based on data, not guessing)
- [ ] Have I measured the current state? (Baseline metrics captured)
- [ ] Am I changing only ONE thing? (Not multiple variables)
- [ ] Do I have a hypothesis for what will improve? (Testable prediction)
- [ ] Do I know how to measure success? (Clear metrics defined)
- [ ] Have I planned the revert strategy if this fails? (Can undo quickly)

After implementing each change, ask yourself:

- [ ] Did I run the full test suite? (All 6 tests)
- [ ] Did I examine debug images for ALL tests? (Not just summary)
- [ ] Did I look at confusion matrices? (Understand error types)
- [ ] Did I run diagnostic scripts? (analyze_correction.py, etc.)
- [ ] Did I record the results? (Spreadsheet or log updated)
- [ ] Do I understand whether this helped or hurt? (Clear conclusion)
- [ ] What's my next step based on these results? (Informed decision)

---

**End of Comprehensive Plan - Ready for Systematic Iterative Execution**

**Next Action:** Begin Phase 1, Iteration 1 - Diagnose Polynomial Surface Fitting Problems
