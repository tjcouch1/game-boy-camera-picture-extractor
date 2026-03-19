# Comprehensive Color Detection Improvement Plan - Iterative Approach

**Date:** 2026-03-18 (updated 2026-03-19)
**Goal:** Achieve >99.5% accuracy on all 6 test images through systematic investigation and iterative improvement

---

## CURRENT STATE (as of 2026-03-19)

### Accuracy Progress

| Test | Baseline | Previous Best | Current | Target |
|------|----------|--------------|---------|--------|
| thing-1 | 88.97%* | 96.04% | 96.04% | 99.5% |
| thing-2 | 84.04% | 93.00% | 93.00% | 99.5% |
| thing-3 | 95.24% | 97.15% | 97.15% | 99.5% |
| zelda-poster-1 | 95.42% | 98.98% | 98.98% | 99.5% |
| zelda-poster-2 | 76.33% | 95.87% | 95.87% | 99.5% |
| zelda-poster-3 | 86.75% | 92.66% | 92.66% | 99.5% |
| **Average** | **88.97%** | **95.62%** | **95.62%** | **99.5%** |

*Baseline was the state before all work in this session.

### Current Files State

- **`gbcam_warp.py`**: `_WARMTH_STRENGTH = 0.0` (disabled from 0.75)
- **`gbcam_correct.py`**: R channel uses two-anchor correction (Coons + polynomial, DG border as dark anchor); G channel similar; refinement pass for both R and G
- **`gbcam_quantize.py`**: Adaptive k-means in RG space with optimal permutation assignment
- **`visualize_frame_colors.py`**: Created - samples all 4 palette colors from frame
- **`visualize_white_samples.py`**: Created - scatter plots of white sample distribution and polynomial fit
- **`measure_spatial_bias.py`**: Created - measures R/G/B variation across 3x3 grid of image regions
- **`test_polynomial_degrees.py`**: Created - tests degrees 0-3 via subprocess

### Confirmed Root Cause (Not Yet Fixed)

**The polynomial surface fitting creates spatial artifacts that directly cause misclassification.**

User confirmed for `thing-1`: the error map (`thing-1_diag_error_map.png`) overlaps **almost perfectly** with the polynomial surface heatmap (`thing-1_warp__correct_color_b_white_surf_heatmap.png`). Errors are clustered around heatmap edges. Right-side errors in thing-1 make red look yellow — the polynomial surface correction is introducing false color gradients.

This pattern repeats across all images. The polynomial fit quality may be fine (RMSE ~10), but the fitted surface is still spatially biased enough to push pixels across decision boundaries.

---

## COMPLETED WORK AND RESULTS

### Phase 1 Investigations (COMPLETED)

#### Iteration 1: Diagnostic Tools Built

All diagnostic tools from the plan were built and run:

1. **`visualize_frame_colors.py`** — sampled BK, DG, LG, WH from frame. Key finding: LG was never found in the frame (n=0 for all images). DG values were consistently 40-50 points too high for R before correction fix.

2. **`visualize_white_samples.py`** — polynomial fit quality is good (RMSE ~10, mean residual near 0). The polynomial fits the white samples well. However, the surface itself has 40-45 brightness level variation across the image (center brighter, edges darker), creating the spatial artifact.

3. **`measure_spatial_bias.py`** — confirmed severe spatial bias in corrected images:
   - zelda-poster-3: R varies by 67 points, G varies by 53 points (>30 threshold)
   - thing-1: R varies by ~60 points
   - This variation causes misclassification at region boundaries

4. **`test_polynomial_degrees.py`** — created but not extensively run (polynomial fit quality was already found to be good, so alternative degrees may not help much since the illumination gradient itself is real)

#### Iteration 2: Warmth Correction Disabled (SUCCESS)

- Changed `_WARMTH_STRENGTH` from 0.75 to 0.0 in `gbcam_warp.py`
- **Result**: +0.68 points average improvement
  - thing-2: +1.55%
  - zelda-poster-2: +2.22%
  - zelda-poster-1: -0.07% (tiny regression)
- Warmth was destroying B channel dynamic range; now B still unreliable but less so

#### Iteration 3: R Channel Two-Anchor Correction (SUCCESS)

Added dark anchor (DG inner border) to R channel correction in `gbcam_correct.py`:
- Before: R used only white-surface normalization (no dark anchor)
- After: R uses Coons patch (dark surface) + polynomial (white surface), targeting DG.R=148, WH.R=255
- Also added refinement pass for R using interior DG pixels + degree-3 polynomial re-fit with edge blending

**Result**: ~+6 points average across all images (combined with warmth change):
- zelda-poster-2: 76.33% → 95.87% (+19.54 points!) — massive improvement
- thing-2: 84.04% → 93.00% (+8.96 points)
- thing-3: 95.24% → 97.15%
- zelda-poster-1: 95.42% → 98.98%
- zelda-poster-3: 86.75% → 92.66%
- thing-1: 96.04% (small regression from prior state)

#### Iteration 4: Adaptive K-Means Quantization (SUCCESS - small gain)

Replaced fixed nearest-RG with adaptive k-means clustering in `gbcam_quantize.py`:
- Smart initialization near expected palette colors in RG space
- Optimal cluster-to-palette assignment via exhaustive permutation search (4! = 24)
- Falls back to nearest-neighbor if k-means fails
- B channel ignored (unreliable)

**Result**: Small but consistent improvement in quantization robustness.

### Failed Approaches (DO NOT RETRY)

#### FAILED: Spatial smoothing with median filter
- Applied `median_filter(labels, size=3)` on quantized output
- **Result**: Accuracy dropped from 95.62% to ~70%
- **Why it failed**: Changes too many correct pixels at color boundaries; every edge pixel has different-colored neighbors, so median votes them to wrong class
- **Lesson**: Do not use spatial smoothing on the label image

#### FAILED: R channel dynamic range stretch
- Estimated DG/LG clusters from percentiles, applied linear stretch
- **Result**: Accuracies dropped to 57-82% (catastrophic)
- **Why it failed**: Percentile estimation was inaccurate; applying a stretch based on wrong anchors made everything worse
- **Lesson**: Do not try to stretch R channel based on estimated cluster positions

#### FAILED: Adaptive correction based on frame uniformity
- Images with high frame_std (23.6) were sent to simpler correction (degree=1, no refinement)
- **Why it failed**: Backward logic — high frame_std means MORE illumination variation, needs MORE correction not less
- **Lesson**: If implementing adaptive correction, high frame_std → more aggressive, not less

#### FAILED: Conservative isolated-pixel smoothing
- Checked if all 8 neighbors differ from center pixel; if so, replaced with neighbor value
- **Result**: Accuracy dropped from 95.62% to ~90.88%
- **Why it failed**: Real image edges have pixels where all 8 neighbors are different — this "correction" was destroying real edge detail
- **Lesson**: Even very conservative spatial smoothing on labels damages accuracy

#### NOTE: Unicode encoding issue (fixed)
- Using `→` arrow character in log strings caused crash on Windows (cp1252 can't encode it)
- Fixed by replacing all `→` with ASCII `->` in log messages

---

## ROOT CAUSE ANALYSIS

### Why Polynomial Surface Fitting Creates Errors

1. **The polynomial fit is accurate** — RMSE ~10, mean residual ~0. The polynomial IS fitting the white samples well.

2. **But the fitted surface creates a 40-45 point brightness gradient** across the image (center brighter, edges darker). This is a real illumination gradient.

3. **The correction divides each pixel by the surface value**. In bright areas (center), pixels get divided by a larger number → come out darker. In dark areas (edges), pixels get divided by smaller number → come out brighter.

4. **For pixels near color boundaries**, this gradient shifts their post-correction values enough to cross the classification threshold. A LG pixel near the center gets over-corrected and classified as WH. A DG pixel near the edge gets under-corrected and classified as BK.

5. **The error map exactly matches the heatmap** because the polynomial surface determines which pixels get over/under corrected. Errors occur precisely where the surface value is far from the global mean — i.e., at heatmap edges and center.

### Why This Is Hard to Fix

The polynomial surface represents **real illumination variation** in the original photo. Simply reducing the correction (lower poly degree) would leave residual illumination gradients in the data. But aggressively correcting based on a polynomial that may not perfectly match the real gradient creates the artifacts we see.

The ideal fix is a correction surface that better matches reality:
- More flexible (not forced to be polynomial)
- Better constrained at interior points (not just frame edges)
- Accounts for all four palette colors simultaneously

---

## NEXT STEPS — WHAT TO TRY

### HIGHEST PRIORITY: Replace Polynomial with Better Interpolation

The polynomial surface fitting is the confirmed root cause. Replace it with one of:

#### Option A: Thin-Plate Spline / RBF (MOST PROMISING)

```python
from scipy.interpolate import RBFInterpolator

# Current: fit_surface() uses np.linalg.lstsq with polynomial basis
# Replace: use RBF with thin_plate kernel

def fit_surface_rbf(ys, xs, vals, H, W):
    points = np.column_stack([
        (np.array(ys) / H) * 2 - 1,
        (np.array(xs) / W) * 2 - 1
    ])
    vals_arr = np.array(vals, dtype=float)

    # RBF with thin-plate spline kernel
    rbf = RBFInterpolator(points, vals_arr, kernel='thin_plate_spline', smoothing=1.0)

    # Evaluate on full grid
    all_y = (np.arange(H, dtype=float) / H) * 2 - 1
    all_x = (np.arange(W, dtype=float) / W) * 2 - 1
    Yn2d, Xn2d = np.meshgrid(all_y, all_x, indexing='ij')
    grid_points = np.column_stack([Yn2d.ravel(), Xn2d.ravel()])
    surface = rbf(grid_points).reshape(H, W)
    return surface.astype(np.float32)
```

**Why this might work better**: Thin-plate spline is more flexible than polynomial, fits the data without forcing a polynomial shape, and naturally minimizes "bending energy" (smoothness). The `smoothing` parameter controls how closely it fits vs. how smooth it is.

**Risk**: May over-fit to noisy samples, creating wiggly surfaces. Start with `smoothing=1.0` or higher.

#### Option B: Four-Color Frame-Based Correction (PLANNED FROM BEFORE, NOT YET IMPLEMENTED)

Use ALL four palette colors from the frame as spatial anchors:
- BK (black dashes) — target (0, 0, 0)
- DG (inner border) — target (148, 148, 255)
- LG (frame elements at known positions) — target (255, 148, 148)
- WH (frame background) — target (255, 255, 165)

For each channel, collect samples of pixels known to be a specific palette color and use them all together to fit a correction surface. This gives 4x more data points and better constrains the surface in all regions.

**Key challenge**: LG was not found in the frame (n=0) using the current `visualize_frame_colors.py`. Need to re-examine the frame layout from `supporting-materials/frame_ascii.txt` to find exact LG positions. The `·` character in frame_ascii.txt maps to #FF9494 (LG). Those positions need to be hardcoded or parsed.

```python
# In gbcam_correct.py, after collecting white and DG samples:
# Also collect LG samples from known frame positions (the `·` pixels in frame_ascii.txt)
# Then use ALL samples for a single unified polynomial/RBF fit
# where each sample has its own known target value
```

#### Option C: Piecewise Correction (Divide and Conquer)

Divide the camera area into a grid (e.g., 4x4 tiles), correct each tile independently using only frame samples nearby that tile. Avoids global polynomial over-fitting.

**Risk**: May create visible tile boundaries. Requires careful blending.

#### Option D: Reduce Polynomial Degree to 1 (Simple Gradient Only)

Degree-1 polynomial = flat tilted plane. Cannot create the "center hot, edge cool" bowl-shape that causes current errors. May eliminate the artifact at the cost of less precise illumination correction.

```python
# In gbcam_correct.py, change:
poly_degree = 1  # Instead of 2
```

**Test immediately**: This is the simplest change. If it improves accuracy even slightly, worth understanding why. The current degree-2 surface creates a bowl that the degree-1 can't, which might mean the "bowl" is the problematic pattern.

#### Option E: Limit Surface Range (Clamp Correction)

Instead of applying the full polynomial correction, limit how much the correction can deviate from global mean:

```python
# After fitting surface:
surface_mean = surface.mean()
# Clamp surface to ±10% of mean (prevents extreme over/under correction)
surface_clamped = np.clip(surface, 0.9 * surface_mean, 1.1 * surface_mean)
# Use clamped surface for correction
```

This prevents the polynomial from creating extreme gradients even if it fits the samples well.

---

### SECONDARY: Better Quantization Decision Boundary

Even after improving correction, classification near boundaries is still error-prone. Consider:

1. **Weighted k-means that knows about the frame samples**: Use frame pixel classifications as "hard" assignments to anchor the clustering.

2. **Per-channel threshold optimization**: Instead of using fixed RG targets, compute optimal thresholds from the actual distribution of corrected pixel values.

3. **Use image-specific cluster centers**: Run k-means on the corrected image, find 4 cluster centers, then map each cluster to the nearest palette color. This adapts to whatever correction produced.

---

### DIAGNOSTIC: Visualize Where Errors Occur

Before implementing fixes, run these to understand exact error patterns:

```bash
# Check if errors follow the polynomial surface pattern
python measure_spatial_bias.py --all-tests

# Visualize the polynomial surface for each image
python visualize_white_samples.py --all-tests --output-dir diagnostic-output/

# Run test with degree-1 to see if errors change pattern
python test_polynomial_degrees.py --all-tests
```

Key question: Do the errors in `thing-1_diag_error_map.png` change when using degree-1 polynomial? If yes, this confirms the bowl shape is the issue and degree-1 may help.

---

## WHAT HAS BEEN TRIED AND SUMMARY

### Summary Table of All Approaches

| Approach | Outcome | Delta | Notes |
|----------|---------|-------|-------|
| HSL-based quantization | FAILED | -20% avg | Corrected values too inaccurate for HSL |
| Fix B channel normalization | FAILED | ~0% | Warmth destroys B dynamic range |
| Disable warmth (0.0) | SUCCESS | +0.68% avg | Preserves more dynamic range |
| R channel two-anchor correction | SUCCESS | +5-19% per image | Major improvement |
| Adaptive k-means quantization | SUCCESS (small) | +~0.5% | More robust cluster assignment |
| Median filter on labels | FAILED | -25% | Destroys real edges |
| R channel dynamic range stretch | FAILED | -10-30% | Wrong anchor estimation |
| Adaptive degree by frame_std | FAILED | ~0% | Backward logic, reverted |
| Isolated-pixel smoothing | FAILED | -5% | Correct pixels at edges look "isolated" |

### What We Know For Sure

1. **B channel is fundamentally broken**: Even with 0% warmth, DG.B achieves ~194-200 instead of 255. Two-anchor affine model can't recover correct B. Solution: ignore B, use RG-only quantization. Already implemented.

2. **Quantization is not the bottleneck**: K-means RG quantization is good. The issue is spatial artifacts in the corrected image pushing pixels across boundaries.

3. **The polynomial fit quality is good but insufficient**: RMSE ~10 means it fits the white samples accurately. But a 40-45 point brightness gradient across the image is still enough to misclassify pixels near decision boundaries.

4. **Error maps match heatmap patterns exactly**: User confirmed for thing-1. This is not a coincidence — it proves the polynomial surface is the direct cause of spatial error clustering.

5. **The problem is solvable**: Raw images have clearly distinguishable colors. The correction step is the only thing degrading them. Better correction (or less aggressive correction) will directly improve accuracy.

---

## ORIGINAL PLAN (PHASES 1-3) — Status

### Phase 1: Deep Investigation (COMPLETED)

- [x] Iteration 1: Diagnose Polynomial Surface Fitting + Visualize Frame Colors
- [x] Iteration 2: Analyze Input Image Characteristics (frame uniformity measured)
- [x] Iteration 3: Test Warmth Correction Impact (DONE, disabled)

### Phase 2: Implement Top Solutions (PARTIALLY COMPLETED)

- [x] Iteration 4: R channel two-anchor correction (DONE)
- [x] Iteration 5: Adaptive k-means quantization (DONE)
- [ ] **Iteration 6: Replace polynomial with better interpolation** ← CURRENT PRIORITY
- [ ] Iteration 7: Four-color frame-based correction (LG positions still unknown)

### Phase 3: Refinement and Optimization (NOT STARTED)

- [ ] Iteration 8: Revisit B channel (probably not needed, RG-only works)
- [ ] Iteration 9: HSL quantization revisit (probably not needed)
- [ ] Iteration 10: Handle edge cases
- [ ] Iteration 11: Final validation

---

## KEY CODE IMPLEMENTATIONS (CURRENT STATE)

### R Channel Correction in gbcam_correct.py

```python
# Stage 1a: R channel — Coons + polynomial, two anchors -> 255 / 148
wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 0)
white_surf_R = fit_surface(wy, wx, wv, H, W, poly_degree)

# Dark anchor: DG inner border
left_r  = np.array([_gb_block_sample_ch_color(img_rgb, gy, INNER_LEFT,  scale, 0)
                    for gy in range(INNER_TOP, INNER_BOT + 1)])
# ... (collect all 4 border sides)
dark_surf_R = build_dark_surface(left_r, right_r, top_r, bot_r, H, W, scale, dark_smooth)

span_R = np.maximum(white_surf_R - dark_surf_R, 5.0)
gain_R = (span_R / (255.0 - 148.0)).astype(np.float32)
off_R  = (dark_surf_R - gain_R * 148.0).astype(np.float32)
corr_R = np.clip((img_rgb[:, :, 0] - off_R) / gain_R, 0.0, 255.0).astype(np.float32)

# Refinement pass: uses interior DG pixels + degree-3 polynomial, with edge blending
```

### K-Means Quantization in gbcam_quantize.py

```python
def _classify_color(samples_rgb, init_centers=None):
    flat_rg = samples_rgb[:, :, :2].reshape(-1, 2).astype(np.float32)
    init_centers = np.array([
        [80, 20],    # BK: low R, very low G
        [148, 148],  # DG: balanced mid-range
        [240, 148],  # LG: high R, mid G
        [250, 250],  # WH: high R, high G
    ], dtype=np.float32)
    kmeans = KMeans(n_clusters=4, init=init_centers, n_init=1, max_iter=300, random_state=42)
    cluster_labels = kmeans.fit_predict(flat_rg)
    centers_rg = kmeans.cluster_centers_
    # Optimal assignment via exhaustive permutation
    from itertools import permutations
    dist_matrix = np.zeros((4, 4))
    for i in range(4):
        for j in range(4):
            dist_matrix[i, j] = np.linalg.norm(centers_rg[i] - targets_rg[j])
    best_perm = min(permutations(range(4)),
                    key=lambda p: sum(dist_matrix[i,p[i]] for i in range(4)))
    cluster_to_palette = np.array(best_perm, dtype=int)
    labels_flat = cluster_to_palette[cluster_labels]
```

### Warmth Disabled in gbcam_warp.py

```python
_WARMTH_STRENGTH = 0.0  # Disabled — was 0.75, preserves B channel dynamic range
```

---

## FRAME COLOR REFERENCE

The Game Boy frame contains all four palette colors at known positions:

- `supporting-materials/frame_ascii.txt`: ASCII art of exact frame layout
  - ` ` (space) = #FFFFA5 (WH - white/yellow)
  - `·` = #FF9494 (LG - light gray/red)
  - `▓` = #9494FF (DG - dark gray/blue)
  - `█` = #000000 (BK - black)
- `supporting-materials/Frame 02.png`: Grayscale representation
  - #FFFFFF -> #FFFFA5 (WH)
  - #A5A5A5 -> #FF9494 (LG)
  - #525252 -> #9494FF (DG)
  - #000000 -> #000000 (BK)

**Note**: LG (`·`) positions were not found by `visualize_frame_colors.py`. Need to re-examine the frame_ascii.txt parsing logic — the `·` character may require special Unicode handling, or positions may be in unexpected locations.

---

## SUCCESS CRITERIA

### Quantitative Goals:
**All 6 tests achieve >99.5% pixel accuracy:**
- thing-1: 96.04% → >99.5% (+3.46 points needed)
- thing-2: 93.00% → >99.5% (+6.5 points needed)
- thing-3: 97.15% → >99.5% (+2.35 points needed)
- zelda-poster-1: 98.98% → >99.5% (+0.52 points needed)
- zelda-poster-2: 95.87% → >99.5% (+3.63 points needed)
- zelda-poster-3: 92.66% → >99.5% (+6.84 points needed)

### Qualitative Goals:
1. No visible color warping in corrected images
2. Right side of thing-1 should not make red look yellow
3. zelda-poster-3 left area should not look too red
4. Error maps should not match the polynomial heatmap pattern

---

## TESTING PROTOCOL

For EVERY iteration:

1. Make ONE change at a time
2. Run: `.venv/Scripts/python.exe run_tests.py`
3. Examine ALL debug images, not just summary numbers
4. Check confusion matrices for which color pairs are confused
5. Check if error maps still match heatmap patterns
6. Record result in the table above
7. If accuracy drops: revert IMMEDIATELY, do not try to patch it

---

**Next Action:** Try Option D (degree-1 polynomial) first as a quick test. If it improves accuracy or changes the error map pattern, proceed to Option A (RBF/thin-plate spline). The confirmed root cause is the polynomial surface creating spatial artifacts — the fix must address the shape of the correction surface.
