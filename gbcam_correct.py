#!/usr/bin/env python3
"""
gbcam_correct.py — Correct step: compensate for front-light brightness gradient

The GBA SP uses a side-mounted front-light that creates a smooth 2D brightness
gradient across the screen — both horizontally and vertically. The effect is
affine per pixel: both the black floor and white ceiling shift together, so a
single global multiplicative correction is wrong.

This step fits a degree-2 bivariate polynomial to observed brightness
measurements taken from the screen's own built-in reference regions, then
inverts the model pixel-by-pixel.

REFERENCE REGIONS USED
  White reference (true value = 255):
    All four filmstrip frame strips — top (GB rows 0–14), bottom (GB rows
    129–143), left (GB cols 0–14), right (GB cols 145–159).  For each GB-pixel
    block the 85th-percentile brightness is used; blocks below 75% of the
    median are dropped (excludes dashes and corner artifacts).

  Dark reference (true value = 82 = #525252):
    All four inner border bands — left side (GB col 15), right side (GB
    col 144), top (GB row 15), bottom (GB row 128).  Each band is 1 GB pixel
    wide and runs the full length of the corresponding camera edge, giving
    dense sampling along all four sides of the camera area.

CORRECTION MODEL
  A degree-2 bivariate polynomial is fit independently to the white and dark
  reference points using least-squares.  Coordinates are normalised to [-1, 1]
  for numerical stability.  This produces two smooth surfaces:

      white_surface(y, x)  — observed brightness of a true-white pixel
      dark_surface(y, x)   — observed brightness of a true-#525252 pixel

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
  --output-dir DIR    Output directory (default: same dir as input)
  --scale N           Pixels per GB pixel — must match warp step (default: 8)
  --poly-degree N     Degree of the bivariate polynomial fit (default: 2)
  --debug             Save correction-map and comparison debug images
"""

import cv2
import numpy as np
import argparse
import sys
import traceback
from pathlib import Path

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
    Collect (y_px, x_px, brightness) dark (#525252) reference samples from
    all four inner border bands.

    Left / right borders span the full height of the camera area.
    Top / bottom borders span the full width of the camera area.
    """
    raw = []

    # Left border: GB col INNER_LEFT
    for gy in range(FRAME_THICK, FRAME_THICK + CAM_H):
        v = _gb_block_sample(gray, gy, INNER_LEFT, scale, 50)
        raw.append((gy * scale + scale // 2,
                     INNER_LEFT * scale + scale // 2, v))

    # Right border: GB col INNER_RIGHT
    for gy in range(FRAME_THICK, FRAME_THICK + CAM_H):
        v = _gb_block_sample(gray, gy, INNER_RIGHT, scale, 50)
        raw.append((gy * scale + scale // 2,
                     INNER_RIGHT * scale + scale // 2, v))

    # Top inner border: GB row INNER_TOP
    for gx in range(FRAME_THICK, FRAME_THICK + CAM_W):
        v = _gb_block_sample(gray, INNER_TOP, gx, scale, 50)
        raw.append((INNER_TOP * scale + scale // 2,
                     gx * scale + scale // 2, v))

    # Bottom inner border: GB row INNER_BOT
    for gx in range(FRAME_THICK, FRAME_THICK + CAM_W):
        v = _gb_block_sample(gray, INNER_BOT, gx, scale, 50)
        raw.append((INNER_BOT * scale + scale // 2,
                     gx * scale + scale // 2, v))

    ys = [p[0] for p in raw]
    xs = [p[1] for p in raw]
    vs = [p[2] for p in raw]
    log(f"  Dark  samples: {len(raw)} blocks  "
        f"(range {min(vs):.1f}–{max(vs):.1f})")
    return ys, xs, vs


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
                 debug=False, debug_dir=None):
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

    log(f"  Collecting reference samples (poly degree={poly_degree})…")
    wy, wx, wv = collect_white_samples(gray, scale)
    dy, dx, dv = collect_dark_samples(gray, scale)

    log("  Fitting 2-D brightness surfaces…")
    white_surf = fit_surface(wy, wx, wv, H, W, poly_degree)
    dark_surf  = fit_surface(dy, dx, dv, H, W, poly_degree)

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
                             "brightness reference measurements. Controls how complex "
                             "the fitted front-light gradient surface can be. Degree 1 "
                             "fits a flat affine plane (linear in both x and y). "
                             "Degree 2 (default) adds curvature, which handles the "
                             "typical GBA SP front-light falloff more accurately. "
                             "Degree 3 or higher can fit more complex gradients but "
                             "risks overfitting to noise, especially near corners "
                             "where reference data is sparse. Default: 2.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save diagnostic images: "
                             "correct_a_gain_map (the per-pixel gain surface, brighter "
                             "= more correction needed), correct_b_before_after "
                             "(camera area side-by-side before and after correction), "
                             "correct_c_white_surface and correct_d_dark_surface "
                             "(the fitted reference surfaces), correct_e_full (the "
                             "complete corrected image). All saved to <output-dir>/debug/.")
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
            process_file(f, out, args.scale, args.poly_degree, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
