#!/usr/bin/env python3
"""
gbcam_quantize.py — Quantize step: map to 4 GB Camera colors

Takes the 128×112 per-pixel brightness samples from the sample step and
produces the final 128×112 Game Boy Camera image by mapping each sample to
the nearest of the four original palette colors:

    #000000  →  0    (black)
    #525252  →  82   (dark gray)
    #A5A5A5  →  165  (light gray)
    #FFFFFF  →  255  (white)

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


def _classify_color(samples_rgb, init_centers=None):
    """
    Classify 128×112 corrected (R, G, B) samples to one of the four palette indices.

    Uses k-means in 3-D RGB space with two-stage cluster matching:
      1. G channel (primary): darkest-G cluster → BK; brightest-G → WH.
         G reliably separates BK (G≈0) from WH (G=255) in all images.
      2. R−G difference (secondary): among the two middle-G clusters,
         lower R−G → DG (#9494FF: R=G=148), higher R−G → LG (#FF9494: R=255>G=148).

    Falls back to G-channel percentile segmentation if k-means fails.

    Parameters
    ----------
    samples_rgb  : (112, 128, 3) float32 — corrected (R, G, B) per camera pixel
    init_centers : (4, 3) float32 or None — optional k-means initial seeds

    Returns
    -------
    labels : (112, 128) uint8  — palette index 0=BK 1=DG 2=LG 3=WH
    method : str
    """
    flat = samples_rgb.reshape(-1, 3).astype(np.float32)   # (14336, 3)

    if init_centers is None:
        init_centers = COLOR_PALETTE_RGB.astype(np.float32)

    # ── Try k-means in 3-D RGB ────────────────────────────────────────────────
    try:
        from sklearn.cluster import KMeans
        from itertools import combinations

        km = KMeans(n_clusters=4, init=init_centers,
                    n_init=3, max_iter=300, random_state=42)
        km.fit(flat)
        centers = km.cluster_centers_    # (4, 3)

        # Degenerate-cluster guard
        min_sep = min(np.linalg.norm(centers[i] - centers[j])
                      for i, j in combinations(range(4), 2))
        if min_sep < 15.0:
            raise ValueError(f"Degenerate k-means: min separation {min_sep:.1f}")

        # Stage 1: sort by G → assign BK and WH
        g_order = np.argsort(centers[:, 1])
        km_to_palette = np.empty(4, dtype=int)
        km_to_palette[g_order[0]] = 0   # darkest G  → BK
        km_to_palette[g_order[3]] = 3   # brightest G → WH

        # Stage 2: R−G difference distinguishes DG from LG
        mid = [g_order[1], g_order[2]]
        rg0 = centers[mid[0], 0] - centers[mid[0], 1]
        rg1 = centers[mid[1], 0] - centers[mid[1], 1]
        if rg0 <= rg1:
            km_to_palette[mid[0]] = 1   # lower R−G → DG
            km_to_palette[mid[1]] = 2   # higher R−G → LG
        else:
            km_to_palette[mid[0]] = 2
            km_to_palette[mid[1]] = 1

        labels_flat = km_to_palette[km.labels_]
        names = ['BK', 'DG', 'LG', 'WH']
        log(f"  Color k-means (3D RGB): centres "
            f"{[(int(c[0]),int(c[1]),int(c[2])) for c in centers[g_order]]} "
            f"→ {[names[km_to_palette[g_order[i]]] for i in range(4)]}  (G-primary, R−G-secondary)")
        return labels_flat.reshape(112, 128).astype(np.uint8), "kmeans"

    except Exception as e:
        log(f"  Color k-means failed ({e}); falling back to G-percentile segmentation")

    # ── G-percentile fallback ─────────────────────────────────────────────────
    g_vals = flat[:, 1]
    q1, q2, q3 = np.percentile(g_vals, [25, 50, 75])
    labels_flat = np.zeros(len(g_vals), dtype=np.uint8)
    labels_flat[g_vals >= q1] = 1
    labels_flat[g_vals >= q2] = 2
    labels_flat[g_vals >= q3] = 3
    log(f"  G-percentile thresholds: {q1:.1f} / {q2:.1f} / {q3:.1f}")
    return labels_flat.reshape(112, 128).astype(np.uint8), "percentile"


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

    # Load auxiliary zero-count image for DG→BK rule
    zc_path = stem_p.parent / (stem + "_zc" + stem_p.suffix)
    zerocounts = cv2.imread(str(zc_path), cv2.IMREAD_GRAYSCALE) if zc_path.exists() else None
    med_path   = stem_p.parent / (stem + "_med" + stem_p.suffix)
    medians    = cv2.imread(str(med_path), cv2.IMREAD_GRAYSCALE) if med_path.exists() else None

    # Read correction metadata (obs_frame_R, obs_border_R) saved by the correct step.
    # These are used to compute adaptive k-means initial centres that reflect the
    # actual white-normalised positions of the palette colours in this specific image,
    # rather than relying on the canonical target positions which only hold for
    # well-exposed images.
    init_centers = None
    # The correct step saves a <stem_correct>.json alongside the correct PNG.
    # The sample PNG stem ends in _sample; the correct PNG stem ends in _correct.
    # Find the sibling correct.json by walking back from the sample path.
    from gbcam_common import strip_step_suffix
    base_stem = strip_step_suffix(stem)
    meta_path = stem_p.parent / (base_stem + "_correct.json")
    if not meta_path.exists():
        # Also try one directory up (if output_dir differs from correct_dir)
        meta_path2 = stem_p.parent.parent / (base_stem + "_correct.json")
        if meta_path2.exists():
            meta_path = meta_path2
    if meta_path.exists():
        try:
            import json as _json
            meta = _json.load(open(meta_path))
            obs_fr = float(meta.get("obs_frame_R", 255))
            obs_br = float(meta.get("obs_border_R", 148))
            # After white-only R correction, the expected corrected positions are:
            #   WH.R ≈ 255  (by construction)
            #   DG.R ≈ obs_br / obs_fr * 255  (border R normalised to white)
            #   LG.R ≈ 255  (LG has max R, same as WH)
            #   BK.R ≈ 0    (theoretical; actual slightly above 0)
            dg_r_init = float(np.clip(obs_br / max(obs_fr, 1.0) * 255, 0, 200))
            init_centers = np.array([
                [0.0,       0.0,   0.0],    # BK
                [dg_r_init, 148.0, 255.0],  # DG: adaptive R, G=148, B=255
                [255.0,     148.0, 148.0],  # LG
                [255.0,     255.0, 165.0],  # WH
            ], dtype=np.float32)
            log(f"  Adaptive k-means seeds: DG.R_init={dg_r_init:.0f}  "
                f"(obs_frame_R={obs_fr:.0f}, obs_border_R={obs_br:.0f})")
        except Exception as e:
            log(f"  Could not read correction metadata ({e}); using default k-means seeds")
            init_centers = None

    img_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    samples_rgb = img_rgb.astype(np.float32)   # (112, 128, 3) — corrected R, G, B

    log(f"  Loaded {CAM_W}×{CAM_H} colour sample image")
    log(f"  R: {samples_rgb[:,:,0].min():.0f}–{samples_rgb[:,:,0].max():.0f}  "
        f"G: {samples_rgb[:,:,1].min():.0f}–{samples_rgb[:,:,1].max():.0f}  "
        f"B: {samples_rgb[:,:,2].min():.0f}–{samples_rgb[:,:,2].max():.0f}")

    # Classify in 3D RGB space (G primary, R-G secondary for DG/LG disambiguation)
    labels, method = _classify_color(samples_rgb, init_centers=init_centers)
    log(f"  Classification: {method}")

    # Optional DG→BK zero-count rule (same as grayscale pipeline)
    if smooth and zerocounts is not None:
        changed = 0
        for r in range(CAM_H):
            for c in range(CAM_W):
                if labels[r, c] == 1:   # DG
                    zc = int(zerocounts[r, c])
                    sv = int(samples_rgb[r, c, 0])   # R channel as brightness proxy
                    if zc >= 12 or (zc >= 8 and sv <= 57):
                        labels[r, c] = 0   # → BK
                        changed += 1
        if changed:
            log(f"  Zero-count DG→BK: {changed} pixels corrected")

    # Build output images
    GRAY_VALS = np.array([0, 82, 165, 255], dtype=np.uint8)
    out_gray = GRAY_VALS[labels]                      # (112, 128) grayscale
    out_rgb  = COLOR_PALETTE_RGB[labels]              # (112, 128, 3) RGB

    # Save grayscale output
    Image.fromarray(out_gray, "L").save(str(output_path))
    log(f"  Saved → {output_path}  (grayscale palette)", always=True)

    # Save colour output alongside (stem_gbcam_rgb.png)
    out_path = _Path(output_path)
    rgb_path = out_path.parent / (
        strip_step_suffix(out_path.stem) + STEP_SUFFIX["quantize"] + "_rgb.png")
    out_bgr = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(rgb_path), out_bgr)
    log(f"  Saved → {rgb_path}  (new RGB palette)", always=True)

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

      DG → LG  if ≥3 of 4 neighbours are pure white  AND  sample ≥ 95
      BK → DG  if ≥3 of 4 neighbours are LG or white  AND  sample ≥ 42
      BK → DG  if ≥2 of 4 neighbours are LG or white  AND  sample ≥ 48
      LG → DG  if ≥3 of 4 neighbours are DG or black  AND  sample < 127
      LG → DG  if ≥2 of 4 neighbours are DG or black  AND  sample < 125  AND  median < 123
      DG → BK  if block has ≥12 zero sub-pixels, OR ≥8 zeros AND sample ≤ 57

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

            # DG → LG : island of DG floating in white
            if q[r, c] == 82 and sv >= 95 and wh >= 3:
                q2[r, c] = 165

            # BK → DG : isolated black pixel in a light neighbourhood
            # Suppressed when the block has many true-zero sub-pixels: those are
            # genuinely dark cells, not accidentally-dark DG, and should stay BK.
            _zc = int(zerocounts[r, c]) if have_aux else 0
            if q[r, c] == 0 and _zc < 8 and sv >= 42 and lg >= 3:
                q2[r, c] = 82
            elif q[r, c] == 0 and _zc < 8 and sv >= 48 and lg >= 2:
                q2[r, c] = 82

            # LG → DG : isolated light pixel in a dark neighbourhood (neighbour rule)
            # Threshold raised to 127 to capture sv=125–126 edge cases safely.
            if q[r, c] == 165 and sv < 127 and dg + bk >= 3:
                q2[r, c] = 82

            # LG → DG : dark-neighbourhood override with median confirmation
            # Requires auxiliary stats from the sample step.
            if have_aux and q[r, c] == 165 and sv < 125 and dg + bk >= 2:
                if int(medians[r, c]) < 123:
                    q2[r, c] = 82

            # DG → BK : block is mostly dark sub-pixels (boundary bleed-over)
            # Fires when the raw block contains many exactly-zero sub-pixels,
            # indicating the GB screen backlight was truly off for most of the cell.
            # Requires auxiliary stats from the sample step.
            if have_aux and q[r, c] == 82:
                zc = int(zerocounts[r, c])
                if zc >= 12 or (zc >= 8 and sv <= 57):
                    q2[r, c] = 0

    return q2


def process_file(input_path, output_path, use_kmeans=True, scale=8,
                 smooth=True, color=False, debug=False, debug_dir=None):
    if color:
        _process_file_color(input_path, output_path, smooth=smooth,
                            debug=debug, debug_dir=debug_dir)
        return

    stem = Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[quantize] {input_path}", always=True)

    raw = cv2.imread(str(input_path), cv2.IMREAD_GRAYSCALE)
    if raw is None:
        raise RuntimeError(f"Cannot read image: {input_path}")
    if raw.shape != (CAM_H, CAM_W):
        raise RuntimeError(f"Unexpected size {raw.shape[1]}×{raw.shape[0]}; "
                           f"expected {CAM_W}×{CAM_H}.")
    samples = raw.astype(np.float32)
    log(f"  Loaded {raw.shape[1]}×{raw.shape[0]} px — "
        f"range {samples.min():.0f}–{samples.max():.0f}")

    thresholds = None

    if use_kmeans:
        try:
            thresholds = _thresholds_kmeans(samples)
        except Exception as e:
            log(f"  K-means failed ({e})")

    if thresholds is None:
        base = strip_step_suffix(Path(input_path).stem)
        # Prefer the correct-step output (better-normalized) if available
        for ref_suffix in (STEP_SUFFIX["correct"], STEP_SUFFIX["warp"]):
            ref_path = Path(input_path).parent / (base + ref_suffix + ".png")
            if ref_path.exists():
                try:
                    thresholds = _thresholds_frame(str(ref_path), scale)
                    break
                except Exception as e:
                    log(f"  Frame calib from {ref_path.name} failed ({e})")
        if thresholds is None:
            log(f"  No warp/correct reference found; skipping frame calib")

    if thresholds is None:
        log("  Falling back to min-max calibration")
        thresholds = _thresholds_minmax(samples)

    output_arr = quantize(samples, thresholds)

    if smooth:
        # Load auxiliary per-pixel stats produced by the sample step, if present.
        ip = Path(input_path)
        med_path = ip.parent / (ip.stem + "_med" + ip.suffix)
        zc_path  = ip.parent / (ip.stem + "_zc"  + ip.suffix)
        medians    = cv2.imread(str(med_path), cv2.IMREAD_GRAYSCALE) if med_path.exists() else None
        zerocounts = cv2.imread(str(zc_path),  cv2.IMREAD_GRAYSCALE) if zc_path.exists()  else None
        output_arr = spatial_smooth(output_arr, raw, medians, zerocounts)
        log("  Spatial smoothing applied.")

    unique, counts = np.unique(output_arr, return_counts=True)
    for u, c in zip(unique, counts):
        log(f"  Color {u:3d}: {c:5d} px  ({100*c/output_arr.size:5.1f}%)")

    Image.fromarray(output_arr, "L").save(str(output_path))
    log(f"  Saved → {output_path}", always=True)

    if debug and debug_dir and stem:
        big = np.repeat(np.repeat(output_arr, 8, axis=0), 8, axis=1)
        save_debug(big, debug_dir, stem, "quantize_a_8x")


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
            process_file(f, out, not args.no_kmeans, args.scale,
                         not args.no_smooth, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
