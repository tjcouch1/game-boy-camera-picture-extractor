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


def spatial_smooth(q, samples):
    """
    Post-quantize spatial consistency pass.

    Corrects isolated mis-classified pixels by examining 4-connected neighbours
    and comparing sample brightness against the expected range for the current
    and neighbouring colours.  Only safe, high-confidence moves are made:

      DG → LG  if ≥3 of 4 neighbours are pure white  AND  sample ≥ 95
      BK → DG  if ≥3 of 4 neighbours are LG or white  AND  sample ≥ 42
      BK → DG  if ≥2 of 4 neighbours are LG or white  AND  sample ≥ 48
      LG → DG  if ≥3 of 4 neighbours are DG or black  AND  sample < 125

    These rules fix isolated calibration-edge pixels that end up one level off
    because their block straddles the quantisation boundary.  They are
    conservative enough not to disturb genuine content edges.

    Parameters
    ----------
    q       : (112, 128) uint8 ndarray — quantised result (palette values)
    samples : (112, 128) uint8 ndarray — raw brightness from the sample step

    Returns
    -------
    (112, 128) uint8 ndarray with the same dtype
    """
    q2 = q.copy()
    H, W = q2.shape
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
            if q[r, c] == 0 and sv >= 42 and lg >= 3:
                q2[r, c] = 82
            elif q[r, c] == 0 and sv >= 48 and lg >= 2:
                q2[r, c] = 82

            # LG → DG : isolated light pixel in a dark neighbourhood
            # Fires when ≥3 of 4 neighbours are DG or black and sample is sub-LG.
            # Broader than the old bk≥3 rule: DG neighbours count as dark context
            # because they sit well below the LG threshold.
            if q[r, c] == 165 and sv < 125 and dg + bk >= 3:
                q2[r, c] = 82

    return q2


def process_file(input_path, output_path, use_kmeans=True, scale=8,
                 smooth=True, debug=False, debug_dir=None):
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
        output_arr = spatial_smooth(output_arr, raw)
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
