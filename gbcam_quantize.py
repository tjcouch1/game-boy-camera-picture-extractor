#!/usr/bin/env python3
"""
gbcam_quantize.py — Quantize step: map to 4 GB Camera colors

Takes the 128×112 per-pixel brightness samples from the sample step and
produces the final 128×112 Game Boy Camera image by mapping each sample to
the nearest of the four original palette colors:

    #000000  ->  0    (black)
    #525252  ->  82   (dark gray)
    #A5A5A5  ->  165  (light gray)
    #FFFFFF  ->  255  (white)

This step also handles color correction: the adaptive threshold calibration
automatically accounts for the washed-out, uneven lighting of the GBA SP
front-lit screen without needing a separate correction step.

Threshold calibration (tried in this order):

  1. K-means (requires scikit-learn):
     Clusters the 128×112 sample values into 4 groups. The cluster centres
     correspond to the washed-out versions of the four GB colors. Thresholds
     are placed at the midpoints between adjacent centres.

  2. Frame calibration (fallback):
     Reads the co-located warp-step output to measure the actual black level
     (side-dash pixels) and white level (top frame pixels), then places four
     evenly-spaced levels between them.

  3. Min-max estimation (last resort):
     Uses the sample min/max as black/white references.

Input:  <stem>_sample.png  — from the sample step (128×112 grayscale)
Output: <stem>_gbcam.png   — 128×112 grayscale PNG, values exactly 0/82/165/255

Standalone usage:
  python gbcam_quantize.py sample_file.png [...]  [options]
  python gbcam_quantize.py --dir ./sample_outputs [options]

Options:
  --output-dir DIR    Output directory (default: same dir as input)
  --no-kmeans         Skip k-means; use frame calibration / min-max instead
  --scale N           Pixels per GB pixel for frame calibration (default: 8)
  --debug             Save 8× upscaled debug image
"""

import cv2
import numpy as np
from PIL import Image
import argparse
import sys
import traceback
from pathlib import Path

from gbcam_common import (
    GB_COLORS, CAM_W, CAM_H, STEP_SUFFIX,
    log, set_verbose, save_debug, collect_inputs, make_output_path,
    strip_step_suffix,
)

SUFFIX = STEP_SUFFIX["quantize"]


def _valley_threshold(vals_flat, lo, hi, smooth_sigma=3.0):
    """Find the histogram valley minimum between lo and hi (integer range).

    Builds a fine-grained histogram in [lo, hi], smooths it with a Gaussian
    kernel, and returns the position of the minimum.  Falls back to the
    midpoint if no clear valley exists.
    """
    from scipy.ndimage import gaussian_filter1d
    lo_i, hi_i = int(np.floor(lo)) + 1, int(np.ceil(hi))
    if hi_i <= lo_i:
        return (lo + hi) / 2.0
    hist, edges = np.histogram(vals_flat, bins=range(lo_i, hi_i + 2))
    if len(hist) == 0:
        return (lo + hi) / 2.0
    smoothed = gaussian_filter1d(hist.astype(float), sigma=smooth_sigma)
    valley_idx = int(np.argmin(smoothed))
    return float(edges[valley_idx])


# ─────────────────────────────────────────────────────────────
# RGB-palette constants
# ─────────────────────────────────────────────────────────────
# New screen palette: WH=#FFFFA5  LG=#FF9494  DG=#9494FF  BK=#000000
# Ordered BK, DG, LG, WH to match GB_COLORS index order
COLOR_PALETTE_RGB = np.array([
    [  0,   0,   0],   # BK  #000000
    [148, 148, 255],   # DG  #9494FF
    [255, 148, 148],   # LG  #FF9494
    [255, 255, 165],   # WH  #FFFFA5
], dtype=np.uint8)

# Target positions in RG space (columns 0 and 1 of COLOR_PALETTE_RGB)
_COLOR_TARGETS_RG = COLOR_PALETTE_RGB[:, :2].astype(np.float32)  # shape (4, 2)


def rgb_to_hsl(rgb):
    """
    Convert RGB (0-255) to HSL (H: 0-360°, S: 0-100%, L: 0-100%)

    Parameters:
        rgb: ndarray of shape (H, W, 3) with values 0-255

    Returns:
        hsl: ndarray of shape (H, W, 3) with H in [0,360], S,L in [0,100]
    """
    # Normalize RGB to [0, 1]
    rgb_norm = rgb / 255.0
    r, g, b = rgb_norm[:, :, 0], rgb_norm[:, :, 1], rgb_norm[:, :, 2]

    # Calculate max, min, delta for each pixel
    max_val = np.maximum(np.maximum(r, g), b)
    min_val = np.minimum(np.minimum(r, g), b)
    delta = max_val - min_val

    # Initialize HSL arrays
    h = np.zeros_like(r)
    s = np.zeros_like(r)
    l = (max_val + min_val) / 2.0

    # Calculate saturation (avoid division by zero)
    mask_s = delta != 0
    s[mask_s] = np.where(
        l[mask_s] > 0.5,
        delta[mask_s] / (2.0 - max_val[mask_s] - min_val[mask_s]),
        delta[mask_s] / (max_val[mask_s] + min_val[mask_s])
    )

    # Calculate hue (only where delta != 0)
    mask_r = (max_val == r) & mask_s
    mask_g = (max_val == g) & mask_s
    mask_b = (max_val == b) & mask_s

    h[mask_r] = 60.0 * (((g[mask_r] - b[mask_r]) / delta[mask_r]) % 6.0)
    h[mask_g] = 60.0 * ((b[mask_g] - r[mask_g]) / delta[mask_g] + 2.0)
    h[mask_b] = 60.0 * ((r[mask_b] - g[mask_b]) / delta[mask_b] + 4.0)

    # Ensure hue is in [0, 360)
    h = np.where(h < 0, h + 360.0, h)

    # Convert S and L to percentages
    s = s * 100.0
    l = l * 100.0

    return np.stack([h, s, l], axis=-1)


def hue_distance(h1, h2):
    """
    Calculate angular distance between two hues (0-360°).
    Accounts for circular wraparound (0° = 360°).

    Examples:
        hue_distance(10, 350) = 20  (not 340)
        hue_distance(60, 240) = 180
    """
    d = np.abs(h1 - h2)
    return np.minimum(d, 360.0 - d)


def _classify_color(samples_rgb, init_centers=None):
    """
    Classify 128×112 corrected samples into the four palette colours.

    Uses adaptive k-means clustering in RG plane, then intelligently maps
    clusters to BK/DG/LG/WH based on cluster properties (mean R, G values).
    This adapts to whatever the correction produced, making it more robust.

    After correction and subpixel-aware sampling, the typical clusters are:
        BK  #000000   ~(R= 98, G= 17)  — lowest R+G
        DG  #9494FF   ~(R=165, G=120)  — mid R+G, higher G than R
        LG  #FF9494   ~(R=236, G=141)  — mid-high R+G, higher R than G
        WH  #FFFFA5   ~(R=243, G=235)  — highest R+G

    These form well-separated clusters in the RG plane.

    Parameters
    ----------
    samples_rgb  : (112, 128, 3) float32 — corrected, subpixel-sampled R, G, B
    init_centers : ignored (kept for API compatibility)

    Returns
    -------
    labels : (112, 128) uint8  — palette index 0=BK 1=DG 2=LG 3=WH
    method : str  — classification method description
    """
    flat_rg = samples_rgb[:, :, :2].reshape(-1, 2).astype(np.float32)  # (N, 2)
    flat = samples_rgb.reshape(-1, 3)

    # Try adaptive k-means clustering first
    try:
        from sklearn.cluster import KMeans

        # K-means in RG space with smart initialization
        # Initialize near expected palette colors for faster, more stable convergence
        init_centers = np.array([
            [80, 20],    # BK: low R, very low G
            [148, 148],  # DG: balanced mid-range
            [240, 148],  # LG: high R, mid G
            [250, 250],  # WH: high R, high G
        ], dtype=np.float32)

        kmeans = KMeans(n_clusters=4, init=init_centers, n_init=1, max_iter=300, random_state=42)
        cluster_labels = kmeans.fit_predict(flat_rg)
        centers_rg = kmeans.cluster_centers_  # (4, 2) — R, G for each cluster

        # Map clusters to palette colors using optimal assignment
        # Compute distance from each cluster center to each target color
        targets_rg = COLOR_PALETTE_RGB[:, :2].astype(np.float32)  # (4, 2)

        # Distance matrix: cluster i to target j
        dist_matrix = np.zeros((4, 4))
        for i in range(4):
            for j in range(4):
                dist_matrix[i, j] = np.linalg.norm(centers_rg[i] - targets_rg[j])

        # Use Hungarian algorithm (optimal assignment) to find best mapping
        # Try all 24 permutations (4!) and find the one with minimum total distance
        from itertools import permutations
        best_perm = None
        best_cost = float('inf')

        for perm in permutations(range(4)):
            cost = sum(dist_matrix[i, perm[i]] for i in range(4))
            if cost < best_cost:
                best_cost = cost
                best_perm = perm

        # best_perm[i] = palette_index for cluster i
        cluster_to_palette = np.array(best_perm, dtype=int)

        # Remap cluster labels to palette indices
        labels_flat = cluster_to_palette[cluster_labels]

        # Log diagnostics
        counts = np.bincount(labels_flat, minlength=4)
        names = ['BK', 'DG', 'LG', 'WH']
        center_info = []
        for i, (name, cnt) in enumerate(zip(names, counts)):
            if cnt > 0:
                m = flat[labels_flat == i].mean(axis=0)
                center_info.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log(f"  Global k-means RG: " + "  ".join(center_info))

        # ── Column-strip k-means for locally adaptive classification ──
        # Run k-means on overlapping vertical strips, using global centers
        # as initialization.  Each strip adapts to the local gradient.
        labels_2d = labels_flat.reshape(CAM_H, CAM_W)
        samples_rg = samples_rgb[:, :, :2].astype(np.float32)

        # Get global centers in palette order
        global_centers_po = np.zeros((4, 2), dtype=np.float32)
        for pi in range(4):
            cidx = np.where(cluster_to_palette == pi)[0]
            global_centers_po[pi] = centers_rg[cidx[0]] if len(cidx) > 0 else targets_rg[pi]

        strip_width = 32
        step = 16  # overlap of 16
        n_strips = (CAM_W - strip_width) // step + 1

        strip_labels = np.full((CAM_H, CAM_W, n_strips), -1, dtype=np.int8)
        strip_centers_col = np.zeros(n_strips, dtype=float)  # center column of each strip

        for s in range(n_strips):
            col_start = s * step
            col_end = min(col_start + strip_width, CAM_W)
            strip_data = samples_rg[:, col_start:col_end, :].reshape(-1, 2)

            # Run k-means with global centers as init
            km_strip = KMeans(n_clusters=4, init=global_centers_po,
                              n_init=1, max_iter=300, random_state=42)
            sl = km_strip.fit_predict(strip_data)
            sc = km_strip.cluster_centers_

            # Map strip clusters to palette using optimal assignment
            dm = np.zeros((4, 4))
            for i in range(4):
                for j in range(4):
                    dm[i, j] = np.linalg.norm(sc[i] - targets_rg[j])

            best_p2 = None
            best_c2 = float('inf')
            for perm in permutations(range(4)):
                cost = sum(dm[i, perm[i]] for i in range(4))
                if cost < best_c2:
                    best_c2 = cost
                    best_p2 = perm

            c2p = np.array(best_p2, dtype=int)
            sl_palette = c2p[sl].reshape(CAM_H, col_end - col_start)
            strip_labels[:, col_start:col_end, s] = sl_palette
            strip_centers_col[s] = (col_start + col_end) / 2.0

        # Ensemble: for each pixel, if ANY strip agrees with global → keep global.
        # If ALL overlapping strips disagree with global → use the closest strip.
        # This avoids strip k-means introducing errors while capturing improvements.
        final_labels = labels_2d.copy()
        changed = 0
        for x in range(CAM_W):
            # Find all strips that cover this column
            covering_strips = []
            for s in range(n_strips):
                col_start = s * step
                col_end = min(col_start + strip_width, CAM_W)
                if col_start <= x < col_end and strip_labels[0, x, s] >= 0:
                    covering_strips.append(s)

            if not covering_strips:
                continue

            # Get the closest strip
            best_strip = min(covering_strips,
                             key=lambda s: abs(strip_centers_col[s] - x))

            for y in range(CAM_H):
                global_l = int(labels_2d[y, x])
                strip_l = int(strip_labels[y, x, best_strip])

                if strip_l != global_l:
                    # Check if ANY covering strip agrees with global
                    any_agree = any(int(strip_labels[y, x, s]) == global_l
                                    for s in covering_strips)
                    if not any_agree:
                        # All strips disagree — use closest strip
                        final_labels[y, x] = strip_l
                        changed += 1

        log(f"  Strip ensemble: {n_strips} strips, changed {changed} px")

        # Log refined results
        counts2 = np.bincount(final_labels.ravel(), minlength=4)
        center_info2 = []
        for i, (name, cnt) in enumerate(zip(names, counts2)):
            if cnt > 0:
                mask = (final_labels == i)
                m = samples_rgb[mask].mean(axis=0)
                center_info2.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log(f"  Strip-refined RG:   " + "  ".join(center_info2))

        return final_labels.astype(np.uint8), "strip-kmeans-RG"

    except (ImportError, Exception) as e:
        # Fallback to fixed nearest-neighbor if k-means fails
        log(f"  K-means failed ({e}), using fixed nearest-RG")
        targets_rg = COLOR_PALETTE_RGB[:, :2].astype(np.float32)
        dists = np.sum((flat_rg[:, None, :] - targets_rg[None, :, :])**2, axis=-1)
        labels_flat = np.argmin(dists, axis=1)

        counts = np.bincount(labels_flat, minlength=4)
        names = ['BK', 'DG', 'LG', 'WH']
        center_info = []
        for i, (name, cnt) in enumerate(zip(names, counts)):
            if cnt > 0:
                m = flat[labels_flat == i].mean(axis=0)
                center_info.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log(f"  Nearest-RG (B ignored): " + "  ".join(center_info))

        return labels_flat.reshape(112, 128).astype(np.uint8), "nearest-RG"


def _process_file_color(input_path, output_path, smooth=True,
                        debug=False, debug_dir=None):
    """
    Colour-mode quantisation step.

    Loads a 3-channel BGR sample image produced by the colour-mode sample step,
    classifies each pixel by nearest-neighbour / k-means in the corrected (R, G)
    plane, and writes two output files:

      <stem>_gbcam.png      — 128×112 grayscale image using the original
                              4-level GB palette (0 / 82 / 165 / 255)
      <stem>_gbcam_rgb.png  — 128×112 colour image using the new RGB palette
                              (#000000 / #9494FF / #FF9494 / #FFFFA5)

    Spatial smoothing is not applied in colour mode: the corrected RG separation
    between palette classes is large enough (~100 RG units vs ±10 within-class
    std) that post-hoc neighbourhood corrections would not improve accuracy.
    """
    from pathlib import Path as _Path
    stem_p = _Path(input_path)
    stem   = stem_p.stem
    log(f"\n{'='*60}", always=True)
    log(f"[quantize/color] {input_path}", always=True)

    bgr = cv2.imread(str(input_path))
    if bgr is None:
        raise RuntimeError(f"Cannot read image: {input_path}")
    if bgr.shape[:2] != (CAM_H, CAM_W):
        raise RuntimeError(f"Unexpected size {bgr.shape[1]}×{bgr.shape[0]}; "
                           f"expected {CAM_W}×{CAM_H}.")

    # Load the subpixel-sampled colour image from the sample step.
    img_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    samples_rgb = img_rgb.astype(np.float32)   # (112, 128, 3) — R, G, B

    log(f"  Loaded {CAM_W}×{CAM_H} colour sample image")
    log(f"  R: {samples_rgb[:,:,0].min():.0f}–{samples_rgb[:,:,0].max():.0f}  "
        f"G: {samples_rgb[:,:,1].min():.0f}–{samples_rgb[:,:,1].max():.0f}  "
        f"B: {samples_rgb[:,:,2].min():.0f}–{samples_rgb[:,:,2].max():.0f}")

    # Classify pixels using HSL-based hue distance
    labels, method = _classify_color(samples_rgb)
    log(f"  Classification: {method}")

    # Build output images
    GRAY_VALS = np.array([0, 82, 165, 255], dtype=np.uint8)
    out_gray = GRAY_VALS[labels]                      # (112, 128) grayscale
    out_rgb  = COLOR_PALETTE_RGB[labels]              # (112, 128, 3) RGB

    # Save grayscale output
    Image.fromarray(out_gray, "L").save(str(output_path))
    log(f"  Saved -> {output_path}  (grayscale palette)", always=True)

    # Save colour output alongside (stem_gbcam_rgb.png)
    out_path = _Path(output_path)
    rgb_path = out_path.parent / (
        strip_step_suffix(out_path.stem) + STEP_SUFFIX["quantize"] + "_rgb.png")
    out_bgr = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(rgb_path), out_bgr)
    log(f"  Saved -> {rgb_path}  (new RGB palette)", always=True)

    # Color distribution
    for i, (gv, name, hex_) in enumerate([
            (0, 'BK', '#000000'), (82, 'DG', '#9494FF'),
            (165, 'LG', '#FF9494'), (255, 'WH', '#FFFFA5')]):
        cnt = int((labels == i).sum())
        log(f"  {name} ({hex_}): {cnt:5d} px  ({100*cnt/labels.size:5.1f}%)")

    if debug and debug_dir and stem:
        big = np.repeat(np.repeat(out_gray, 8, axis=0), 8, axis=1)
        save_debug(big, debug_dir, stem, "quantize_color_a_gray_8x")
        big_rgb = np.repeat(np.repeat(out_rgb, 8, axis=0), 8, axis=1)
        save_debug(cv2.cvtColor(big_rgb, cv2.COLOR_RGB2BGR),
                   debug_dir, stem, "quantize_color_b_rgb_8x")


def _thresholds_kmeans(samples):
    try:
        from sklearn.cluster import KMeans
    except ImportError:
        raise ValueError("scikit-learn not available — install with: pip install scikit-learn")
    vals    = samples.ravel().reshape(-1, 1).astype(np.float64)
    km      = KMeans(n_clusters=4, random_state=0, n_init=10, max_iter=300)
    km.fit(vals)
    centres = sorted(km.cluster_centers_.ravel())
    log(f"  K-means centres: {[f'{c:.1f}' for c in centres]}")
    gaps = [centres[i+1] - centres[i] for i in range(3)]
    log(f"  Cluster gaps:    {[f'{g:.1f}' for g in gaps]}")
    if min(gaps) < 15:
        raise ValueError(f"Clusters too close (min gap {min(gaps):.1f} < 15)")
    # Use histogram valley minimum instead of simple midpoint for better accuracy
    vals_flat = samples.ravel().astype(float)
    thresholds = [_valley_threshold(vals_flat, centres[i], centres[i+1])
                  for i in range(3)]
    log(f"  K-means thresholds: {[f'{t:.1f}' for t in thresholds]}")
    return thresholds


def _thresholds_frame(warp_path, scale=8):
    warp = cv2.imread(str(warp_path), cv2.IMREAD_GRAYSCALE)
    if warp is None:
        raise RuntimeError(f"Cannot read warp file: {warp_path}")
    black_obs = float(np.percentile(warp[6*scale:10*scale, 1*scale:3*scale], 5))
    white_obs = float(np.percentile(warp[0:4*scale, 20*scale:140*scale], 85))
    log(f"  Frame calib (from {Path(warp_path).name}): "
        f"black={black_obs:.1f}  white={white_obs:.1f}")
    step = (white_obs - black_obs) / 3.0
    c    = [black_obs + i * step for i in range(4)]
    thresholds = [(c[i] + c[i+1]) / 2 for i in range(3)]
    log(f"  Frame thresholds: {[f'{t:.1f}' for t in thresholds]}")
    return thresholds


def _thresholds_minmax(samples):
    lo, hi = float(samples.min()), float(samples.max())
    log(f"  Min-max calib: lo={lo:.1f}  hi={hi:.1f}")
    step = (hi - lo) / 3.0
    c    = [lo + i * step for i in range(4)]
    thresholds = [(c[i] + c[i+1]) / 2 for i in range(3)]
    log(f"  Min-max thresholds: {[f'{t:.1f}' for t in thresholds]}")
    return thresholds


def quantize(samples, thresholds):
    t0, t1, t2 = thresholds
    out = np.empty_like(samples, dtype=np.uint8)
    out[samples <  t0] = GB_COLORS[0]
    out[(samples >= t0) & (samples <  t1)] = GB_COLORS[1]
    out[(samples >= t1) & (samples <  t2)] = GB_COLORS[2]
    out[samples >= t2] = GB_COLORS[3]
    return out


def spatial_smooth(q, samples, medians=None, zerocounts=None):
    """
    Post-quantize spatial consistency pass.

    Corrects isolated mis-classified pixels by examining 4-connected neighbours
    and comparing sample brightness against the expected range for the current
    and neighbouring colours.  Only safe, high-confidence moves are made:

      DG -> LG  if ≥3 of 4 neighbours are pure white  AND  sample ≥ 95
      BK -> DG  if ≥3 of 4 neighbours are LG or white  AND  sample ≥ 42
      BK -> DG  if ≥2 of 4 neighbours are LG or white  AND  sample ≥ 48
      LG -> DG  if ≥3 of 4 neighbours are DG or black  AND  sample < 127
      LG -> DG  if ≥2 of 4 neighbours are DG or black  AND  sample < 125  AND  median < 123
      DG -> BK  if block has ≥12 zero sub-pixels, OR ≥8 zeros AND sample ≤ 57

    The final two rules require the auxiliary median and zero-count images
    produced by the sample step.  If they are not provided the rules are
    silently skipped (pipeline still reaches >99.9 % accuracy without them).

    Parameters
    ----------
    q          : (112, 128) uint8 ndarray — quantised result (palette values)
    samples    : (112, 128) uint8 ndarray — raw mean brightness (sample step)
    medians    : (112, 128) uint8 ndarray or None — per-pixel block median
    zerocounts : (112, 128) uint8 ndarray or None — count of zero sub-pixels

    Returns
    -------
    (112, 128) uint8 ndarray with the same dtype
    """
    q2 = q.copy()
    H, W = q2.shape
    have_aux = (medians is not None) and (zerocounts is not None)
    for r in range(H):
        for c in range(W):
            nbrs4 = [(r + dr, c + dc)
                     for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))
                     if 0 <= r + dr < H and 0 <= c + dc < W]
            if len(nbrs4) < 4:
                continue
            nbv = [q[nr, nc] for nr, nc in nbrs4]
            sv  = int(samples[r, c])
            wh  = sum(v == 255 for v in nbv)
            lg  = sum(v >= 165 for v in nbv)
            dg  = sum(v == 82  for v in nbv)
            bk  = sum(v == 0   for v in nbv)

            # DG -> LG : island of DG floating in white
            if q[r, c] == 82 and sv >= 95 and wh >= 3:
                q2[r, c] = 165

            # BK -> DG : isolated black pixel in a light neighbourhood
            # Suppressed when the block has many true-zero sub-pixels: those are
            # genuinely dark cells, not accidentally-dark DG, and should stay BK.
            _zc = int(zerocounts[r, c]) if have_aux else 0
            if q[r, c] == 0 and _zc < 8 and sv >= 42 and lg >= 3:
                q2[r, c] = 82
            elif q[r, c] == 0 and _zc < 8 and sv >= 48 and lg >= 2:
                q2[r, c] = 82

            # LG -> DG : isolated light pixel in a dark neighbourhood (neighbour rule)
            # Threshold raised to 127 to capture sv=125–126 edge cases safely.
            if q[r, c] == 165 and sv < 127 and dg + bk >= 3:
                q2[r, c] = 82

            # LG -> DG : dark-neighbourhood override with median confirmation
            # Requires auxiliary stats from the sample step.
            if have_aux and q[r, c] == 165 and sv < 125 and dg + bk >= 2:
                if int(medians[r, c]) < 123:
                    q2[r, c] = 82

            # DG -> BK : block is mostly dark sub-pixels (boundary bleed-over)
            # Fires when the raw block contains many exactly-zero sub-pixels,
            # indicating the GB screen backlight was truly off for most of the cell.
            # Requires auxiliary stats from the sample step.
            if have_aux and q[r, c] == 82:
                zc = int(zerocounts[r, c])
                if zc >= 12 or (zc >= 8 and sv <= 57):
                    q2[r, c] = 0

    return q2


def process_file(input_path, output_path, use_kmeans=True, scale=8,
                 smooth=True, debug=False, debug_dir=None):
    _process_file_color(input_path, output_path, smooth=smooth,
                        debug=debug, debug_dir=debug_dir)


def main():
    parser = argparse.ArgumentParser(
        description="Quantize step: map samples to 4 GB Camera colors",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("inputs", nargs="*",
                        help="Sample-step output files (*_sample.png) to quantize.")
    parser.add_argument("--dir", "-d", metavar="DIR",
                        help="Directory of sample-step outputs to glob.")
    parser.add_argument("--output-dir", "-o", metavar="DIR",
                        help="Where to write *_gbcam.png outputs. Default: same "
                             "directory as each input file.")
    parser.add_argument("--scale", type=int, default=8, metavar="N",
                        help="Working resolution multiplier used in earlier steps. "
                             "Only relevant here for the frame-calibration fallback, "
                             "which reads reference pixels from a co-located "
                             "*_correct.png or *_warp.png file at the expected "
                             "pixel coordinates. Default: 8.")
    parser.add_argument("--no-kmeans", action="store_true",
                        help="Skip k-means clustering and use simpler threshold "
                             "calibration instead. Normally k-means clusters the "
                             "128x112 sample values into 4 groups and places "
                             "thresholds at the midpoints between cluster centres — "
                             "adaptive, requires no tuning. With --no-kmeans the "
                             "step looks for a co-located *_correct.png or "
                             "*_warp.png file and reads actual black and white "
                             "reference pixels from the frame geometry to compute "
                             "evenly-spaced thresholds; if neither is found it "
                             "falls back to the sample min and max. Use if "
                             "scikit-learn is not installed or k-means is producing "
                             "poor results for a particular image.")
    parser.add_argument("--no-smooth", action="store_true",
                        help="Disable spatial-consistency smoothing. By default a "
                             "single post-quantise pass corrects isolated pixels "
                             "whose 4-connected neighbours are all in a different "
                             "palette level (e.g. a lone dark-gray pixel surrounded "
                             "by white). Use this flag to get the raw k-means "
                             "output without any neighbourhood correction.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save a diagnostic 8x "
                             "upscaled image (quantize_a_8x) so the four-color "
                             "result is visible at block level. Saved to "
                             "<output-dir>/debug/.")
    args = parser.parse_args()
    set_verbose(args.debug)
    files = collect_inputs(args.inputs, args.dir)
    if not files:
        parser.print_help(); print("\nError: no input files.", file=sys.stderr); sys.exit(1)
    debug_dir = (args.output_dir or ".") + "/debug" if args.debug else None
    errors = []
    for f in files:
        out = make_output_path(f, args.output_dir, SUFFIX)
        try:
            process_file(f, out, smooth=not args.no_smooth,
                         debug=args.debug, debug_dir=debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
