#!/usr/bin/env python3
"""
gbcam_correct.py — Correct step: compensate for front-light brightness gradient

The GBA SP uses a side-mounted front-light that creates a smooth 2D brightness
gradient across the screen — both horizontally and vertically. The effect is
affine per pixel: both the black floor and white ceiling shift together, so a
single global multiplicative correction is wrong.

REFERENCE REGIONS USED
  White reference (true value = 255):
    All four filmstrip frame strips — top (GB rows 0–14), bottom (GB rows
    129–143), left (GB cols 0–14), right (GB cols 145–159).  For each GB-pixel
    block the 85th-percentile brightness is used; blocks below 75% of the
    median are dropped (excludes dashes and corner artifacts).
    A degree-2 bivariate polynomial is fit to these scattered samples.

  Dark reference (true value = 82 = #525252):
    All four inner border bands — left (GB col 15), right (GB col 144),
    top (GB row 15), bottom (GB row 128).  These form a complete rectangle
    around the camera area, giving one per-row profile on the left and right
    and one per-column profile on the top and bottom.
    A Coons bilinear patch is built from these four smoothed boundary curves.
    This exactly reproduces the measured border values and smoothly blends
    across the interior — far more accurate than a polynomial fit for this
    closed-boundary data.

CORRECTION MODEL
  Two surfaces are computed:
      white_surface(y, x)  — observed brightness of a true-white pixel (poly)
      dark_surface(y, x)   — observed brightness of a true-#525252 pixel (Coons)

  The affine inverse is applied at every pixel:
      gain   = (white_surface − dark_surface) / (255 − 82)
      offset = dark_surface − gain × 82
      corrected = clip( round( (observed − offset) / gain ), 0, 255 )

Input:  <stem>_warp.png  — from the warp step  ((160*scale) × (144*scale) px)
Output: <stem>_correct.png — same dimensions, brightness-normalised grayscale

Standalone usage:
  python gbcam_correct.py warp_file.png [...]  [options]
  python gbcam_correct.py --dir ./warp_outputs [options]

Options:
  --output-dir DIR       Output directory (default: same dir as input)
  --scale N              Pixels per GB pixel — must match warp step (default: 8)
  --poly-degree N        Degree of the polynomial fit for the white surface (default: 2)
  --dark-smooth N        Smoothing window (in GB pixels) applied to each inner
                         border curve before building the Coons dark surface (default: 13)
  --debug                Save correction-map and comparison debug images
"""

import cv2
import numpy as np
import argparse
import sys
import traceback
from pathlib import Path
from scipy.ndimage import uniform_filter1d

from gbcam_common import (
    SCREEN_W, SCREEN_H, FRAME_THICK, CAM_W, CAM_H,
    INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT,
    STEP_SUFFIX,
    log, set_verbose, save_debug, collect_inputs, make_output_path,
)

SUFFIX = STEP_SUFFIX["correct"]

_TRUE_DARK  = 82
_TRUE_WHITE = 255


# ─────────────────────────────────────────────────────────────
# Reference sample collection
# ─────────────────────────────────────────────────────────────

def _gb_block_sample(gray, gy, gx, scale, percentile=50):
    """Return the <percentile>-th brightness value of GB pixel (gy, gx)."""
    y1, y2 = gy * scale, (gy + 1) * scale
    x1, x2 = gx * scale, (gx + 1) * scale
    block = gray[y1:y2, x1:x2]
    return float(np.percentile(block, percentile)) if block.size > 0 else 0.0


def collect_white_samples(gray, scale):
    """
    Collect (y_px, x_px, brightness) white reference samples from all four
    filmstrip frame strips.  y_px / x_px are the image-pixel coordinates of
    the centre of each sampled GB-pixel block.

    Per-block brightness is estimated at the 85th percentile (robust to dark
    sub-pixel gaps without being pulled up by blooming from bright content).
    Blocks whose brightness is below 75 % of the strip median are discarded
    (dash holes, corner ligatures).
    """
    H, W = gray.shape
    raw = []

    # Top strip: GB rows 0 .. INNER_TOP-1, safe cols 10 .. SCREEN_W-10
    for gy in range(INNER_TOP):
        for gx in range(10, SCREEN_W - 10):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    # Bottom strip: GB rows INNER_BOT+1 .. SCREEN_H-1, safe cols
    for gy in range(INNER_BOT + 1, SCREEN_H):
        for gx in range(10, SCREEN_W - 10):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    # Left strip: GB cols 0 .. INNER_LEFT-1, safe rows 10 .. SCREEN_H-10
    for gy in range(10, SCREEN_H - 10):
        for gx in range(INNER_LEFT):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    # Right strip: GB cols INNER_RIGHT+1 .. SCREEN_W-1, safe rows
    for gy in range(10, SCREEN_H - 10):
        for gx in range(INNER_RIGHT + 1, SCREEN_W):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    if not raw:
        return [], [], []

    vals = np.array([v for _, _, v in raw])
    med  = float(np.median(vals))
    kept = [(y, x, v) for y, x, v in raw if v > 0.75 * med]

    ys = [p[0] for p in kept]
    xs = [p[1] for p in kept]
    vs = [p[2] for p in kept]
    log(f"  White samples: {len(kept)}/{len(raw)} blocks kept  "
        f"(median {med:.1f}, range {min(vs):.1f}–{max(vs):.1f})")
    return ys, xs, vs


def collect_dark_samples(gray, scale):
    """
    Collect per-row and per-column dark (#525252) reference profiles from the
    four inner border bands.

    Returns four arrays (left, right, top, bot) each containing the median
    brightness of each GB-pixel block along that border:
      left  — shape (CAM_H+1,)  rows INNER_TOP..INNER_BOT at col INNER_LEFT
      right — shape (CAM_H+1,)  rows INNER_TOP..INNER_BOT at col INNER_RIGHT
      top   — shape (CAM_W+1,)  cols INNER_LEFT..INNER_RIGHT at row INNER_TOP
      bot   — shape (CAM_W+1,)  cols INNER_LEFT..INNER_RIGHT at row INNER_BOT
    """
    def _strip(gy_range, gx_val):
        return np.array([_gb_block_sample(gray, gy, gx_val, scale, 50)
                         for gy in gy_range], dtype=float)

    def _row(gy_val, gx_range):
        return np.array([_gb_block_sample(gray, gy_val, gx, scale, 50)
                         for gx in gx_range], dtype=float)

    gy_range = range(INNER_TOP, INNER_BOT + 1)
    gx_range = range(INNER_LEFT, INNER_RIGHT + 1)

    left  = _strip(gy_range, INNER_LEFT)
    right = _strip(gy_range, INNER_RIGHT)
    top   = _row(INNER_TOP, gx_range)
    bot   = _row(INNER_BOT, gx_range)

    n_left, n_top = len(left), len(top)
    log(f"  Dark  samples: {n_left}×2 + {n_top}×2 border pixels  "
        f"(left range {left.min():.1f}–{left.max():.1f}, "
        f"right {right.min():.1f}–{right.max():.1f})")
    return left, right, top, bot


def build_dark_surface(left, right, top, bot, H, W, scale, smooth_k=13):
    """
    Build a full (H, W) dark-reference surface using a Coons bilinear patch.

    The four input arrays (left, right, top, bot) are the raw per-pixel border
    measurements.  Each is smoothed with a uniform filter of width smooth_k
    to reduce noise before interpolation.

    The Coons patch exactly reproduces the smoothed boundary values along all
    four edges of the camera rectangle and blends them bilinearly across the
    interior.  This is far more accurate than a polynomial fit for this
    closed-boundary problem because the polynomial tends to extrapolate badly
    outside the measured region and cannot capture independent variation on
    each of the four sides.

    y_rows / x_cols are the image-pixel centre coordinates of each border
    sample point.
    """
    # Smooth each border curve independently
    def sm(arr):
        return uniform_filter1d(arr, size=smooth_k, mode='nearest')

    ld = sm(left);  rd = sm(right)
    td = sm(top);   bd = sm(bot)

    # Image-pixel centre positions of each border sample
    gy_range = range(INNER_TOP, INNER_BOT + 1)
    gx_range = range(INNER_LEFT, INNER_RIGHT + 1)
    y_rows = np.array([gy * scale + scale // 2 for gy in gy_range], dtype=float)
    x_cols = np.array([gx * scale + scale // 2 for gx in gx_range], dtype=float)

    y_start, y_end = float(y_rows[0]), float(y_rows[-1])
    x_start, x_end = float(x_cols[0]), float(x_cols[-1])

    # Build full-image coordinate grids
    y_px = np.arange(H, dtype=float)
    x_px = np.arange(W, dtype=float)

    # Interpolate each border curve onto the full pixel axis
    L = np.interp(y_px, y_rows, ld)   # (H,) — left boundary value at each row
    R = np.interp(y_px, y_rows, rd)   # (H,)
    T = np.interp(x_px, x_cols, td)   # (W,) — top boundary value at each col
    B = np.interp(x_px, x_cols, bd)   # (W,)

    # Normalised [0,1] coordinates for the blending weights
    yn = np.clip((y_px - y_start) / (y_end - y_start), 0.0, 1.0)   # (H,)
    xn = np.clip((x_px - x_start) / (x_end - x_start), 0.0, 1.0)   # (W,)
    YN, XN = np.meshgrid(yn, xn, indexing='ij')   # (H, W)

    # Corner values (average of the two meeting boundary curves)
    TL = (float(ld[0]) + float(td[0])) / 2
    TR = (float(rd[0]) + float(td[-1])) / 2
    BL = (float(ld[-1]) + float(bd[0])) / 2
    BR = (float(rd[-1]) + float(bd[-1])) / 2

    # Coons bilinear patch:
    #   horizontal blend of left/right  +  vertical blend of top/bottom
    #   minus bilinear blend of the four corners  (avoids double-counting)
    surface = (
        (1 - XN) * L[:, None] + XN * R[:, None]
        + (1 - YN) * T[None, :] + YN * B[None, :]
        - (1 - XN) * (1 - YN) * TL
        - XN       * (1 - YN) * TR
        - (1 - XN) * YN       * BL
        - XN       * YN       * BR
    )
    return surface.astype(np.float32)


# ─────────────────────────────────────────────────────────────
# 2-D polynomial surface fitting
# ─────────────────────────────────────────────────────────────

def _design_matrix(yn, xn, degree):
    """Build the Vandermonde design matrix for a bivariate polynomial."""
    cols = []
    for dy in range(degree + 1):
        for dx in range(degree + 1 - dy):
            cols.append((yn ** dy) * (xn ** dx))
    return np.column_stack(cols)


def fit_surface(ys, xs, vals, H, W, degree=2):
    """
    Fit a degree-<degree> bivariate polynomial to the given (y, x, value)
    sample points and evaluate it at every pixel of an (H, W) image.

    Returns a float32 array of shape (H, W).
    Coordinates are normalised to [-1, 1] before fitting.
    """
    yn_s = (np.array(ys, dtype=float) / H) * 2 - 1
    xn_s = (np.array(xs, dtype=float) / W) * 2 - 1
    v_s  = np.array(vals, dtype=float)

    A      = _design_matrix(yn_s, xn_s, degree)
    coeffs, _, _, _ = np.linalg.lstsq(A, v_s, rcond=None)

    # Evaluate on the full pixel grid
    all_y  = np.arange(H, dtype=float)
    all_x  = np.arange(W, dtype=float)
    Yn2d, Xn2d = np.meshgrid((all_y / H) * 2 - 1,
                              (all_x / W) * 2 - 1, indexing='ij')
    yn_g = Yn2d.ravel()
    xn_g = Xn2d.ravel()

    A_grid   = _design_matrix(yn_g, xn_g, degree)
    surface  = (A_grid @ coeffs).reshape(H, W)
    return surface.astype(np.float32)


# ─────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────

def process_file(input_path, output_path, scale=8, poly_degree=2,
                 dark_smooth=13, debug=False, debug_dir=None):
    stem = Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[correct] {input_path}", always=True)

    gray = cv2.imread(str(input_path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise RuntimeError(f"Cannot read image: {input_path}")

    expected_w, expected_h = SCREEN_W * scale, SCREEN_H * scale
    if gray.shape != (expected_h, expected_w):
        raise RuntimeError(
            f"Unexpected input size {gray.shape[1]}×{gray.shape[0]}; "
            f"expected {expected_w}×{expected_h}. "
            f"Did you pass a warp-step output with the correct --scale?")
    H, W = gray.shape
    log(f"  Loaded {W}×{H} px (scale={scale})")

    log(f"  Collecting reference samples (white poly degree={poly_degree}, dark smooth_k={dark_smooth})…")
    wy, wx, wv             = collect_white_samples(gray, scale)
    left, right, top, bot  = collect_dark_samples(gray, scale)

    log("  Fitting brightness surfaces…")
    white_surf = fit_surface(wy, wx, wv, H, W, poly_degree)
    dark_surf  = build_dark_surface(left, right, top, bot, H, W, scale, dark_smooth)

    # Log corner values of each surface for sanity
    corners = [(0, 0), (0, W-1), (H-1, 0), (H-1, W-1)]
    for r, c in corners:
        log(f"    ({r:4d},{c:4d}): white={white_surf[r,c]:.1f}  dark={dark_surf[r,c]:.1f}")

    log("  Applying per-pixel affine correction…")
    span   = np.maximum(white_surf - dark_surf, 5.0)
    gain   = (span / (_TRUE_WHITE - _TRUE_DARK)).astype(np.float32)
    offset = (dark_surf - gain * _TRUE_DARK).astype(np.float32)

    img_f     = gray.astype(np.float32)
    corrected = np.clip(np.round((img_f - offset) / gain), 0, 255).astype(np.uint8)

    # Validation: inner border mean after correction should be near 82
    cam_y1 = FRAME_THICK * scale;  cam_y2 = (FRAME_THICK + CAM_H) * scale
    cam_x1 = FRAME_THICK * scale;  cam_x2 = (FRAME_THICK + CAM_W) * scale
    lc1, lc2 = INNER_LEFT * scale, (INNER_LEFT + 1) * scale
    rc1, rc2 = INNER_RIGHT * scale, (INNER_RIGHT + 1) * scale
    tc1, tc2 = INNER_TOP * scale, (INNER_TOP + 1) * scale
    bc1, bc2 = INNER_BOT * scale, (INNER_BOT + 1) * scale

    orig_bdr = np.concatenate([
        gray[cam_y1:cam_y2, lc1:lc2].ravel().astype(float),
        gray[cam_y1:cam_y2, rc1:rc2].ravel().astype(float),
        gray[tc1:tc2, cam_x1:cam_x2].ravel().astype(float),
        gray[bc1:bc2, cam_x1:cam_x2].ravel().astype(float),
    ])
    corr_bdr = np.concatenate([
        corrected[cam_y1:cam_y2, lc1:lc2].ravel().astype(float),
        corrected[cam_y1:cam_y2, rc1:rc2].ravel().astype(float),
        corrected[tc1:tc2, cam_x1:cam_x2].ravel().astype(float),
        corrected[bc1:bc2, cam_x1:cam_x2].ravel().astype(float),
    ])
    log(f"  Inner border (#525252 ref, target=82): "
        f"before mean={orig_bdr.mean():.1f} (err={orig_bdr.mean()-82:.1f}), "
        f"after mean={corr_bdr.mean():.1f} (err={corr_bdr.mean()-82:.1f}) "
        f"({'improved' if abs(corr_bdr.mean()-82) < abs(orig_bdr.mean()-82) else 'check'})")

    cv2.imwrite(str(output_path), corrected)
    log(f"  Saved → {output_path}", always=True)

    if debug and debug_dir and stem:
        # Gain map: normalise to 0–255 for visibility
        g_min, g_max = gain.min(), gain.max()
        gain_vis = ((gain - g_min) / max(g_max - g_min, 1e-6) * 255).astype(np.uint8)
        save_debug(gain_vis, debug_dir, stem, "correct_a_gain_map")

        # Side-by-side camera area: original left, corrected right
        orig_cam = gray[cam_y1:cam_y2, cam_x1:cam_x2]
        corr_cam = corrected[cam_y1:cam_y2, cam_x1:cam_x2]
        save_debug(np.hstack([orig_cam, corr_cam]), debug_dir, stem, "correct_b_before_after")

        # White surface visualised
        ws_vis = np.clip(white_surf, 0, 255).astype(np.uint8)
        save_debug(ws_vis, debug_dir, stem, "correct_c_white_surface")

        # Dark surface visualised
        ds_vis = np.clip(dark_surf, 0, 255).astype(np.uint8)
        save_debug(ds_vis, debug_dir, stem, "correct_d_dark_surface")

        # Full corrected image
        save_debug(corrected, debug_dir, stem, "correct_e_full")


# ─────────────────────────────────────────────────────────────
# Standalone CLI
# ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Correct step: 2-D front-light brightness correction",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    parser.add_argument("inputs", nargs="*",
                        help="Warp-step output files (*_warp.png) to correct.")
    parser.add_argument("--dir", "-d", metavar="DIR",
                        help="Directory of warp-step outputs to glob.")
    parser.add_argument("--output-dir", "-o", metavar="DIR",
                        help="Where to write *_correct.png outputs. Default: same "
                             "directory as each input file.")
    parser.add_argument("--scale", type=int, default=8, metavar="N",
                        help="Working resolution multiplier. Must match the value "
                             "used in the warp step. Default: 8.")
    parser.add_argument("--poly-degree", type=int, default=2, metavar="N",
                        help="Degree of the bivariate polynomial fitted to the "
                             "white brightness reference measurements. Controls how "
                             "complex the fitted front-light gradient surface can be. "
                             "Degree 1 fits a flat affine plane. Degree 2 (default) "
                             "adds curvature. Default: 2.")
    parser.add_argument("--dark-smooth", type=int, default=13, metavar="N",
                        help="Smoothing window size (in GB pixels) applied to each "
                             "of the four inner border curves before building the Coons "
                             "dark reference surface. A larger value averages out more "
                             "noise in the border measurement at the cost of less "
                             "spatial detail. Must be an odd integer ≥ 1. Default: 13.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save diagnostic images: "
                             "correct_a_gain_map, correct_b_before_after, "
                             "correct_c_white_surface, correct_d_dark_surface, "
                             "correct_e_full. All saved to <output-dir>/debug/.")
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
            process_file(f, out, args.scale, args.poly_degree, args.dark_smooth, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
