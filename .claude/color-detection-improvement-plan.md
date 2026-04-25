# Game Boy Camera Color Detection Improvement Plan

**Date:** 2026-03-18
**Goal:** Fix color quantization to achieve 100% accuracy on test images while maintaining robustness for varied inputs

**Environment:** Always use the `.venv` virtual environment when running Python scripts:
- Windows: `.venv/Scripts/python.exe <script>`
- Linux/Mac: `.venv/bin/python <script>`

---

## Problem Analysis

### Current Test Results (0/6 passing):
- thing-1: 98.20% (258 errors)
- thing-2: 79.84% (2890 errors)
- thing-3: 97.59% (346 errors)
- zelda-poster-1: 98.65% (194 errors)
- zelda-poster-2: 71.90% (4029 errors)
- zelda-poster-3: 84.70% (2194 errors)

### Primary Issues (from zelda-poster-3 confusion matrix):
1. **1403 WH pixels misclassified as LG** ← MAJOR: Yellow (#FFFFA5) → Pink (#FF9494)
2. **363 BK pixels misclassified as DG** - Black (#000000) → Blue (#9494FF)
3. **417 DG pixels misclassified as LG** - Blue (#9494FF) → Pink (#FF9494)

### Root Cause:
Current quantization uses **nearest-neighbor in weighted RGB space** (R, G, B×0.40). This fails because:
- RGB distances don't capture color semantics (hue relationships)
- Washed-out/tinted colors distort RGB distances unpredictably
- The B-weighting (0.40) is a band-aid that doesn't solve fundamental issues
- **Spatial smoothing applies WH→LG correction**, making the problem WORSE

---

## Solution: HSL-Based Color Classification

### Why HSL is Superior

The four Game Boy colors have **perfect separation in HSL space**:

| Color | RGB | Hue | Saturation | Lightness |
|-------|-----|-----|------------|-----------|
| **BK** #000000 | (0,0,0) | undefined | 0% | 0% |
| **DG** #9494FF | (148,148,255) | **240°** (blue) | 100% | 79% |
| **LG** #FF9494 | (255,148,148) | **0°** (red) | 100% | 79% |
| **WH** #FFFFA5 | (255,255,165) | **60°** (yellow) | 100% | 82% |

**Key Advantages:**
1. **Hue separates chromatic colors perfectly**: Red (0°), Yellow (60°), Blue (240°)
2. **Lightness isolates black**: BK L≈0%, others L≈79-82%
3. **Robust to washing/tinting**: Hue relationships preserved despite color distortion
4. **Solves LG/WH confusion**: RGB method fails (both R=255), HSL succeeds (0° vs 60°)

---

## Implementation Plan

### Phase 1: Core HSL Implementation

**File:** `gbcam_quantize.py`

#### 1.1. Add RGB to HSL Conversion

```python
def rgb_to_hsl(rgb):
    """
    Convert RGB (0-255) to HSL (H: 0-360°, S: 0-100%, L: 0-100%)

    Parameters:
        rgb: ndarray of shape (H, W, 3) with values 0-255

    Returns:
        hsl: ndarray of shape (H, W, 3) with H in [0,360], S,L in [0,100]
    """
    # Normalize RGB to [0, 1]
    # Calculate max, min, delta for each pixel
    # Compute L = (max + min) / 2
    # Compute S = delta / (2 - max - min) if L > 0.5, else delta / (max + min)
    # Compute H based on which channel is max:
    #   - R is max: H = 60 * ((G - B) / delta % 6)
    #   - G is max: H = 60 * ((B - R) / delta + 2)
    #   - B is max: H = 60 * ((R - G) / delta + 4)
    # Handle edge cases: grayscale (delta=0), pure black/white
```

#### 1.2. Hue Distance Helper

```python
def hue_distance(h1, h2):
    """
    Calculate angular distance between two hues (0-360°).
    Accounts for circular wraparound (0° = 360°).

    Examples:
        hue_distance(10, 350) = 20  (not 340)
        hue_distance(60, 240) = 180
    """
    d = abs(h1 - h2)
    return min(d, 360 - d)
```

#### 1.3. Replace `_classify_color` with HSL-Based Version

```python
def _classify_color_hsl(samples_rgb):
    """
    Classify 128×112 corrected samples using HSL color space.

    Strategy:
    1. Convert RGB to HSL
    2. Classify based on lightness and hue:
       - Very dark pixels → BK
       - Others: use hue distance to classify as DG/LG/WH
       - Handle edge cases (low saturation, etc.)

    Parameters:
        samples_rgb: (112, 128, 3) float32 - corrected R,G,B samples

    Returns:
        labels: (112, 128) uint8 - palette index 0=BK 1=DG 2=LG 3=WH
        method: str - classification method description
    """
    # Convert to HSL
    hsl = rgb_to_hsl(samples_rgb)
    H = hsl[:, :, 0]  # Hue (0-360)
    S = hsl[:, :, 1]  # Saturation (0-100)
    L = hsl[:, :, 2]  # Lightness (0-100)

    labels = np.zeros((112, 128), dtype=np.uint8)

    # Target hues for non-black colors
    HUE_LG = 0    # Red
    HUE_WH = 60   # Yellow
    HUE_DG = 240  # Blue

    # Classification thresholds (adjust based on testing)
    LIGHTNESS_BLACK_THRESHOLD = 35  # L < 35% → likely black

    for r in range(112):
        for c in range(128):
            h, s, l = H[r, c], S[r, c], L[r, c]

            # Step 1: Check for black (very low lightness)
            if l < LIGHTNESS_BLACK_THRESHOLD:
                labels[r, c] = 0  # BK
                continue

            # Step 2: For non-black pixels, classify by hue
            # Try hue distance first, even for low saturation
            # (User suggestion: desaturated pixels may still have reliable hue)

            dist_lg = hue_distance(h, HUE_LG)
            dist_wh = hue_distance(h, HUE_WH)
            dist_dg = hue_distance(h, HUE_DG)

            min_dist = min(dist_lg, dist_wh, dist_dg)

            if min_dist == dist_lg:
                labels[r, c] = 2  # LG
            elif min_dist == dist_wh:
                labels[r, c] = 3  # WH
            else:
                labels[r, c] = 1  # DG

    # Log diagnostics
    counts = np.bincount(labels.ravel(), minlength=4)
    names = ['BK', 'DG', 'LG', 'WH']

    # Calculate mean RGB and HSL for each class
    flat_rgb = samples_rgb.reshape(-1, 3)
    flat_hsl = hsl.reshape(-1, 3)
    labels_flat = labels.ravel()

    center_info = []
    for i, (name, cnt) in enumerate(zip(names, counts)):
        if cnt > 0:
            m_rgb = flat_rgb[labels_flat == i].mean(axis=0)
            m_hsl = flat_hsl[labels_flat == i].mean(axis=0)
            center_info.append(
                f"{name}({cnt})~RGB({int(m_rgb[0])},{int(m_rgb[1])},{int(m_rgb[2])}) "
                f"HSL(H={int(m_hsl[0])},S={int(m_hsl[1])},L={int(m_hsl[2])})"
            )

    log("  HSL classification: " + "  ".join(center_info))

    return labels, "HSL-hue-distance"
```

#### 1.4. Remove Harmful Spatial Smoothing

**In `_process_file_color` function (lines 195-235):**
- **REMOVE** the entire WH→LG spatial smoothing block
- User guidance: "avoid using color smoothing because that uses approximations rather than actual colors"
- HSL classification should be accurate enough to eliminate need for smoothing

---

### Phase 2: Advanced Refinements

#### 2.1. Hue Clustering (If many pixels fall outside ±30° from targets)

```python
def _analyze_hue_distribution(samples_rgb):
    """
    Analyze actual hue distribution in the image.
    If many pixels don't cluster around expected hues (0°, 60°, 240°),
    use k-means clustering on hue values to find actual clusters,
    then map clusters to colors.

    This handles cases where color correction didn't perfectly
    normalize hues to target values.
    """
    hsl = rgb_to_hsl(samples_rgb)
    # Filter to non-black pixels (L > 35%)
    # Extract hues, perform circular k-means clustering (k=3)
    # Map each cluster to nearest target color (LG/WH/DG)
    # Return cluster assignments
```

**When to use:**
- If > 5% of pixels have hue distance > 30° from all targets
- If classification accuracy is poor despite HSL implementation
- Indicates color correction may need improvement

#### 2.2. Desaturated Pixel Handling

**Try hue-first approach (user suggestion):**
```python
# Even for low saturation, try hue distance first
if min_hue_distance < 45:  # More lenient threshold for low-sat pixels
    # Use hue-based classification
else:
    # Fallback: use lightness-based classification
    if l < 40: labels[r,c] = 0  # BK
    elif l < 60: labels[r,c] = 1  # DG
    elif l < 75: labels[r,c] = 2  # LG
    else: labels[r,c] = 3  # WH
```

#### 2.3. Sample Margin Adjustment

**File:** `gbcam_sample.py`

**Current setup (from logs):**
- Block: 8×8 pixels per GB pixel (at scale=8)
- Horizontal margin: 2 pixels
- Vertical margin: 1 pixel
- Sample region: 4×6 pixels (center of each 8×8 block)
- Subpixel columns: B=[1,3), G=[3,5), R=[5,7)

**Experiment with:**
1. **Wider horizontal sampling** to capture more subpixel information:
   - Try margin_h=1 instead of 2 → sample region 6×6
   - Allows more blue (left) and red (right) subpixel data

2. **Asymmetric sampling** to bias toward specific subpixels:
   - For blue (DG): sample more from left side (columns 0-4)
   - For red (LG): sample more from right side (columns 4-7)
   - For yellow (WH): sample from middle-right (columns 2-6)

3. **Subpixel-aware classification:**
   - Calculate separate R, G, B means from their respective subpixel regions
   - Use these in HSL conversion for more accurate color detection

**Trade-offs:**
- Wider sampling may introduce more noise/bleeding from adjacent pixels
- May not improve accuracy; worth testing as follow-up
- User note: "These things may not have much impact... but it's worth considering"

---

### Phase 3: Testing & Iteration

#### 3.1. Initial Testing

**IMPORTANT:** Always run Python using the .venv virtual environment:

```bash
# On Windows:
.venv/Scripts/python.exe run_tests.py

# On Linux/Mac:
.venv/bin/python run_tests.py
```

**Examine:**
- Color distribution: should match reference counts (±50 pixels)
- Confusion matrix: minimize off-diagonal errors
- Error maps: identify spatial patterns in errors

#### 3.2. Threshold Tuning

**Adjust based on results:**

| Parameter | Initial | Tune If... |
|-----------|---------|------------|
| `LIGHTNESS_BLACK_THRESHOLD` | 35% | BK under-detected: lower<br>BK over-detected: raise |
| Hue distance tolerance | ±30° | Many pixels outside range: use clustering<br>Hue-based errors: analyze per-color |

#### 3.3. Diagnostics

**Add debug logging:**
```python
if debug:
    # Log HSL statistics for each color class
    # Save H, S, L channel images separately
    # Highlight pixels with ambiguous classification:
    #   - L near black threshold
    #   - Hue equidistant from two targets
    #   - Very low saturation
    # Save hue distribution histogram
```

#### 3.4. Color Correction Assessment

**If quantization issues persist after HSL implementation:**
- The problem may be in the **color correction step** (gbcam_correct.py)
- Check if corrected colors actually normalize to target RGB values
- Examine debug images: `*_correct_color_c_full.png`
- Look for:
  - Uneven color distribution across the frame
  - Residual tinting (blue/yellow bias)
  - Over/under correction artifacts

**Potential color correction improvements:**
- Refine white surface normalization
- Adjust polynomial degree for G-channel correction
- Better handling of edge regions
- More robust anchor pixel selection (frame whites, border blues)

---

### Phase 4: Edge Cases & Robustness

#### 4.1. Extreme Lighting

- **Very dark images:** Lower black threshold dynamically based on histogram
- **Very bright images:** Check for clipping (R,G,B at 255)
- **High dynamic range:** Consider adaptive thresholds per image region

#### 4.2. Noise & Artifacts

- **JPEG compression noise:** May cause single-pixel errors
- **LCD artifacts:** Subpixel bleeding, dead pixels, lines
- **Consider:** Median filtering on HSL values (3×3 window) BEFORE classification
  - NOT the same as spatial smoothing on final labels
  - Reduces noise while preserving actual color information

#### 4.3. Validation

- Test on additional images beyond the 6 test cases
- Verify robustness to different lighting conditions
- Check that changes don't break sample-pictures (non-test images)

---

## Implementation Priority

### Must Do (Phase 1):
1. ✓ **Implement RGB to HSL conversion** (1.1)
2. ✓ **Implement hue distance calculation** (1.2)
3. ✓ **Replace `_classify_color` with HSL version** (1.3)
4. ✓ **Remove WH→LG spatial smoothing** (1.4)
5. ✓ **Run tests and validate improvement**

### Should Do (Phase 2-3):
6. **Tune lightness threshold for black detection** (3.2)
7. **Add HSL debug logging and visualizations** (3.3)
8. **Experiment with desaturated pixel handling** (2.2)
9. **Assess if color correction needs improvement** (3.4)

### Nice to Have (Phase 2-4):
10. **Implement hue clustering fallback** (2.1)
11. **Experiment with sample margins** (2.3)
12. **Add noise filtering** (4.2)
13. **Test on wider variety of images** (4.3)

---

## Success Criteria

### Quantitative:
- **All 6 test cases pass** (100% or near-100% pixel accuracy)
- **Confusion matrix:** Minimal off-diagonal errors (< 50 pixels per category)
- **Color distribution:** Match reference within ±2%

### Qualitative:
- **No visible artifacts** in side-by-side comparisons
- **Error maps mostly white** (correct pixels)
- **Robust to image variations** (different lighting, tinting, washing)
- **No spatial smoothing needed** (get it right the first time)

### Expected Improvements:
- **zelda-poster-3:** 84.70% → > 99% (reduce LG/WH confusion from 1403 to < 50)
- **thing-2:** 79.84% → > 99% (worst case currently)
- **Overall:** 0/6 passing → 6/6 passing

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| HSL conversion introduces new errors | Validate conversion against known test cases; use standard formulas |
| Black detection threshold too aggressive | Make threshold configurable; tune based on test results |
| Hue unreliable for some pixels | Use hue clustering or lightness fallback |
| Color correction inadequate | Phase 3.4: assess and improve correction step if needed |
| Sample margins affect accuracy | Phase 2.3: experiment carefully; revert if accuracy degrades |
| Over-fitting to test images | Validate on non-test images; maintain generalizability |

---

## Notes & Considerations

1. **User guidance:** "Avoid color smoothing - uses approximations rather than actual colors"
   - We're removing spatial smoothing entirely
   - HSL classification should be accurate enough

2. **User insight:** "Hues may be clustered closely in a distinguishable way"
   - Even with washed-out colors, hue relationships are preserved
   - Clustering can map actual observed hues to target colors

3. **User insight:** "Black pixels will be significantly darker"
   - Lightness is the key discriminator for black vs. non-black
   - Much more reliable than RGB distance

4. **Generalizability:** "Don't want algorithm to work just for these test images"
   - Use robust, principled approach (HSL color theory)
   - Avoid hard-coded special cases
   - Validate on variety of images

5. **Correction vs. Quantization:**
   - If many pixels have hues far from targets (0°, 60°, 240°)
   - Problem is likely in color correction, not quantization
   - Fix root cause rather than band-aiding in quantization

---

## Appendix: HSL Color Theory

### Why Hue Works for This Problem

The Game Boy Camera uses four colors that are fundamentally different **hues**:
- Black: no hue (achromatic)
- Blue, Red, Yellow: primary/secondary hues evenly spaced on color wheel

When colors are washed out or tinted:
- **Hue relationships are preserved** (red stays redder than yellow)
- **RGB distances change dramatically** (washing increases all channels)
- **Saturation decreases** but hue remains relatively stable

This is why HSL is superior to RGB for this specific problem.

### HSL Conversion Reference

Standard formulas (ITU-R BT.709):
```
R', G', B' = R/255, G/255, B/255  (normalize to [0,1])

M = max(R', G', B')
m = min(R', G', B')
C = M - m  (chroma)

L = (M + m) / 2

S = C / (1 - |2L - 1|)  if L ∈ (0, 1), else 0

     ⎧ undefined           if C = 0
     ⎪ ((G'-B')/C mod 6) × 60°   if M = R'
H = ⎨ ((B'-R')/C + 2) × 60°     if M = G'
     ⎩ ((R'-G')/C + 4) × 60°     if M = B'
```

### Circular Hue Distance

Hue is circular: 0° = 360° (both red)

Distance between h1 and h2:
```
d = |h1 - h2|
distance = min(d, 360 - d)
```

Examples:
- distance(10°, 350°) = 20° (not 340°)
- distance(0°, 180°) = 180°
- distance(60°, 240°) = 180°

---

**End of Plan**
