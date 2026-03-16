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
    A Coons bilinear patch is built from these four smoothed boundary curves
    for the initial dark surface estimate.

    Iterative refinement (default: 1 pass):
    After the initial Coons-patch correction, pixels whose sample value falls
    in [60, 110] are confidently classified as dark-gray (#525252).  Their
    warp-centre brightness directly measures the dark surface at that location.
    A degree-4 bivariate polynomial is re-fitted to the combined border +
    interior calibration dataset, producing a more accurate dark surface that
    accounts for spatial variation inside the camera area that the border-only
    Coons patch cannot capture.  This refinement reduces error from ~0.21%
    to ~0.06% on test images.

CORRECTION MODEL
  Two surfaces are computed:
      white_surface(y, x)  — observed brightness of a true-white pixel (poly)
      dark_surface(y, x)   — observed brightness of a true-#525252 pixel
                             (Coons patch, optionally refined by interior cal)

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
  --dark-smooth N        Smoothing window for inner border curves, in GB pixels (default: 13)
  --refine-passes N      Interior calibration refinement passes after Coons patch (default: 1)
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

# Per-channel targets for the RGB palette (#9494FF dark-gray, #FFFFA5 white)
# Only R and G are corrected; B is left uncorrected (gain would be inverted/tiny)
_COLOR_TRUE_DARK_RG  = 148.0   # DG.R = DG.G = 148
_COLOR_TRUE_WHITE_RG = 255.0   # WH.R = WH.G = 255

# Warmth coefficients: per-channel (slope, bias) derived from a hand-edited reference.
# Per-channel linear warmth transform derived from a hand-edited reference image
# (thing-2.jpg edited to increase warmth until the palette colours matched their
# intended appearance).  Fitted via least-squares on frame pixels:
#   corrected_ch = _WARM_GAIN[ch] * raw_ch + _WARM_BIAS[ch]
_WARM_GAIN = np.array([1.0856, 0.9861, 0.8784], dtype=np.float32)  # R,G,B
_WARM_BIAS = np.array([24.85,  -3.54,  -28.24], dtype=np.float32)  # R,G,B


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


def _quick_sample(corrected, scale, h_margin=2, v_margin=1):
    """
    Fast inline sampling of the camera area of a corrected image.
    Returns a (CAM_H, CAM_W) uint8 array of per-pixel brightness values.
    Mirrors the core logic of gbcam_sample.py without file I/O or debug output.
    """
    out = np.empty((CAM_H, CAM_W), dtype=np.uint8)
    for gy in range(CAM_H):
        for gx in range(CAM_W):
            # Block position in the corrected image (which still has the frame)
            y1 = (FRAME_THICK + gy) * scale + v_margin
            y2 = (FRAME_THICK + gy + 1) * scale - v_margin
            x1 = (FRAME_THICK + gx) * scale + h_margin
            x2 = (FRAME_THICK + gx + 1) * scale - h_margin
            block = corrected[y1:y2, x1:x2]
            out[gy, gx] = int(np.clip(round(float(np.median(block))), 0, 255))
    return out


def _quick_sample_color(corrected_rg, scale, h_margin=2, v_margin=1):
    """
    Fast inline sampling of the camera area from the per-channel corrected image.
    Returns a (CAM_H, CAM_W, 2) float32 array of per-pixel (R, G) values.
    corrected_rg is a (H, W, 2) float32 array with channels [R, G].
    """
    out = np.empty((CAM_H, CAM_W, 2), dtype=np.float32)
    for gy in range(CAM_H):
        for gx in range(CAM_W):
            y1 = (FRAME_THICK + gy) * scale + v_margin
            y2 = (FRAME_THICK + gy + 1) * scale - v_margin
            x1 = (FRAME_THICK + gx) * scale + h_margin
            x2 = (FRAME_THICK + gx + 1) * scale - h_margin
            block = corrected_rg[y1:y2, x1:x2, :]
            out[gy, gx, 0] = float(np.mean(block[:, :, 0]))
            out[gy, gx, 1] = float(np.mean(block[:, :, 1]))
    return out


def _collect_border_dark_color(img_rgb, scale, dark_smooth, ch):
    """
    Return (border_y, border_x, border_v) arrays for the smoothed inner-border
    dark-gray reference measurements for a single RGB channel (0=R, 1=G).
    """
    gy_range = range(INNER_TOP, INNER_BOT + 1)
    gx_range = range(INNER_LEFT, INNER_RIGHT + 1)

    def smp(gy, gx):
        return float(np.median(img_rgb[gy*scale:(gy+1)*scale, gx*scale:(gx+1)*scale, ch]))

    left  = np.array([smp(gy, INNER_LEFT)  for gy in gy_range])
    right = np.array([smp(gy, INNER_RIGHT) for gy in gy_range])
    top   = np.array([smp(INNER_TOP, gx)   for gx in gx_range])
    bot   = np.array([smp(INNER_BOT, gx)   for gx in gx_range])

    ld = uniform_filter1d(left.astype(float),  size=dark_smooth, mode='nearest')
    rd = uniform_filter1d(right.astype(float), size=dark_smooth, mode='nearest')
    td = uniform_filter1d(top.astype(float),   size=dark_smooth, mode='nearest')
    bd = uniform_filter1d(bot.astype(float),   size=dark_smooth, mode='nearest')

    y_rows = np.array([gy*scale + scale//2 for gy in gy_range], dtype=float)
    x_cols = np.array([gx*scale + scale//2 for gx in gx_range], dtype=float)

    bdy, bdx, bdv = [], [], []
    for i, _ in enumerate(gy_range):
        bdy += [y_rows[i], y_rows[i]]
        bdx += [x_cols[0], x_cols[-1]]
        bdv += [ld[i], rd[i]]
    for j, _ in enumerate(gx_range):
        bdy += [y_rows[0], y_rows[-1]]
        bdx += [x_cols[j], x_cols[j]]
        bdv += [td[j], bd[j]]
    return np.array(bdy), np.array(bdx), np.array(bdv)


def _gb_block_sample_ch_color(img_rgb, gy, gx, scale, ch, pct=50):
    """Return the <pct>-th percentile of channel <ch> in GB pixel block (gy, gx)."""
    y1, y2 = gy * scale, (gy + 1) * scale
    x1, x2 = gx * scale, (gx + 1) * scale
    block = img_rgb[y1:y2, x1:x2, ch]
    return float(np.percentile(block, pct)) if block.size > 0 else 0.0


def collect_white_samples_ch_color(img_rgb, scale, ch, pct=85):
    """
    Collect (y_px, x_px, brightness) white-reference samples from the four
    filmstrip frame strips for a single channel.  Mirrors collect_white_samples()
    but operates on a float32 H×W×3 RGB array.
    """
    raw = []

    def _add_strip(gy_range, gx_range):
        for gy in gy_range:
            for gx in gx_range:
                v = _gb_block_sample_ch_color(img_rgb, gy, gx, scale, ch, pct)
                raw.append((gy * scale + scale // 2, gx * scale + scale // 2, v))

    _add_strip(range(INNER_TOP),                    range(10, SCREEN_W - 10))
    _add_strip(range(INNER_BOT + 1, SCREEN_H),      range(10, SCREEN_W - 10))
    _add_strip(range(10, SCREEN_H - 10),             range(INNER_LEFT))
    _add_strip(range(10, SCREEN_H - 10),             range(INNER_RIGHT + 1, SCREEN_W))

    vals = np.array([v for _, _, v in raw])
    med  = float(np.median(vals))
    kept = [(y, x, v) for y, x, v in raw if v > 0.75 * med]
    return [p[0] for p in kept], [p[1] for p in kept], [p[2] for p in kept]


def _process_file_color(input_path, output_path, scale=8, poly_degree=2,
                        dark_smooth=13, refine_passes=1,
                        debug=False, debug_dir=None):
    """
    Colour-mode correction pipeline.

    Three stages applied in sequence:

    1. Per-channel spatial correction
       Removes the front-light brightness gradient across the screen by fitting
       a 2-D polynomial white surface to the filmstrip frame and normalising
       every pixel against it.  The G channel additionally uses the inner
       #9494FF border as a second (dark) anchor via a Coons bilinear patch
       with an optional refinement pass using interior DG pixels.
         R: white-surface normalisation → target 255  (#FFFFA5.R)
         G: Coons + polynomial, two anchors  → target 255 / 148
         B: white-surface normalisation → target 165  (#FFFFA5.B)

    2. Global colour normalisation
       Measures the mean of the 85th-percentile block samples across all four
       filmstrip frame strips (the solid yellow-white areas, ignoring dash
       holes) and scales each channel globally so the frame matches EXACTLY
       the target palette white colour (#FFFFA5 = R255 G255 B165).

    3. Saves a colour BGR PNG and a sidecar JSON for downstream metadata.
    """
    from pathlib import Path as _Path
    stem = _Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[correct/color] {input_path}", always=True)

    bgr = cv2.imread(str(input_path))
    if bgr is None:
        raise RuntimeError(f"Cannot read image: {input_path}")
    img_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)

    expected_w, expected_h = SCREEN_W * scale, SCREEN_H * scale
    if img_rgb.shape[:2] != (expected_h, expected_w):
        raise RuntimeError(
            f"Unexpected input size {img_rgb.shape[1]}×{img_rgb.shape[0]}; "
            f"expected {expected_w}×{expected_h}.")
    H, W = img_rgb.shape[:2]
    log(f"  Loaded {W}×{H} px (colour, scale={scale})")

    # NOTE: Warmth pre-processing was already applied in the warp step.
    # Do NOT apply it again here.

    corrected_rgb = np.zeros((H, W, 3), dtype=np.float32)

    # ── Stage 1a: R channel — white-surface normalisation → 255 ───────────────
    log("  R: white-surface normalisation → 255")
    wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 0)
    white_surf_R = fit_surface(wy, wx, wv, H, W, poly_degree)
    obs_frame_R  = float(np.median(wv))
    corr_R = np.clip(img_rgb[:, :, 0] * (255.0 / np.maximum(white_surf_R, 5.0)),
                     0.0, 255.0).astype(np.float32)
    corrected_rgb[:, :, 0] = corr_R

    # ── Stage 1b: G channel — Coons + polynomial, two anchors → 255 / 148 ─────
    log("  G: Coons+poly → 255 / 148")
    wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 1)
    white_surf_G = fit_surface(wy, wx, wv, H, W, poly_degree)
    left_g  = np.array([_gb_block_sample_ch_color(img_rgb, gy, INNER_LEFT,  scale, 1)
                         for gy in range(INNER_TOP, INNER_BOT + 1)])
    right_g = np.array([_gb_block_sample_ch_color(img_rgb, gy, INNER_RIGHT, scale, 1)
                         for gy in range(INNER_TOP, INNER_BOT + 1)])
    top_g   = np.array([_gb_block_sample_ch_color(img_rgb, INNER_TOP, gx, scale, 1)
                         for gx in range(INNER_LEFT, INNER_RIGHT + 1)])
    bot_g   = np.array([_gb_block_sample_ch_color(img_rgb, INNER_BOT, gx, scale, 1)
                         for gx in range(INNER_LEFT, INNER_RIGHT + 1)])
    dark_surf_G = build_dark_surface(left_g, right_g, top_g, bot_g, H, W, scale, dark_smooth)
    span_G = np.maximum(white_surf_G - dark_surf_G, 5.0)
    gain_G = (span_G / (255.0 - 148.0)).astype(np.float32)
    off_G  = (dark_surf_G - gain_G * 148.0).astype(np.float32)
    corr_G = np.clip((img_rgb[:, :, 1] - off_G) / gain_G, 0.0, 255.0).astype(np.float32)

    if refine_passes > 0:
        border_y_g, border_x_g, border_v_g = _collect_border_dark_color(
            img_rgb, scale, dark_smooth, 1)
        samp_G_approx = _quick_sample_color(
            np.stack([corr_R, corr_G], axis=-1), scale)[:, :, 1]
        # DG pixels have corrected G in [100, 196] — the range between BK (≈0) and WH (≈255).
        # LG pixels also land in this range (LG.G ≈ 148) but their contamination of the
        # calibration surface is smaller than the benefit of the refinement pass.
        dg_mask = (samp_G_approx >= 100.0) & (samp_G_approx <= 196.0)
        cys, cxs = np.where(dg_mask)
        n_cal = len(cys)
        log(f"    G refinement: {n_cal} interior DG pixels")
        if n_cal >= 50:
            cal_y = np.array([(FRAME_THICK + gy) * scale + scale // 2 for gy in cys], float)
            cal_x = np.array([(FRAME_THICK + gx) * scale + scale // 2 for gx in cxs], float)
            cal_v = np.array([float(img_rgb[(FRAME_THICK+gy)*scale+scale//2,
                                            (FRAME_THICK+gx)*scale+scale//2, 1])
                               for gy, gx in zip(cys, cxs)], float)
            dark_surf_G2 = _fit_surface_poly(
                np.concatenate([border_y_g, cal_y]),
                np.concatenate([border_x_g, cal_x]),
                np.concatenate([border_v_g, cal_v]),
                H, W, degree=4)
            span_G2 = np.maximum(white_surf_G - dark_surf_G2, 5.0)
            gain_G2 = (span_G2 / (255.0 - 148.0)).astype(np.float32)
            off_G2  = (dark_surf_G2 - gain_G2 * 148.0).astype(np.float32)
            corr_G  = np.clip((img_rgb[:, :, 1] - off_G2) / gain_G2, 0.0, 255.0).astype(np.float32)

    corrected_rgb[:, :, 1] = corr_G

    # ── Stage 1c: B channel — white-surface normalisation → 165 ───────────────
    # Target WH.B = 165 (#FFFFA5 is warm yellow, not pure white).
    # White-norm is more stable than two-anchor for B because after the warmth
    # pre-processing the DG border B and the frame B are both near saturation,
    # leaving almost no span for a reliable Coons correction.
    log("  B: white-surface normalisation → 165")
    wy, wx, wv = collect_white_samples_ch_color(img_rgb, scale, 2)
    white_surf_B = fit_surface(wy, wx, wv, H, W, poly_degree)
    corr_B = np.clip(img_rgb[:, :, 2] * (165.0 / np.maximum(white_surf_B, 5.0)),
                     0.0, 255.0).astype(np.float32)
    corrected_rgb[:, :, 2] = corr_B

    # ── Stage 2: Global colour normalisation — frame → exactly #FFFFA5 ─────────
    # After the per-channel spatial corrections the frame should be approximately
    # (255, 255, 165), but polynomial fit residuals leave a small offset.
    # Measuring the p85 of each frame-strip block and scaling globally makes the
    # frame flat #FFFFA5 by construction, which the sample step can then use as
    # an absolute colour reference.
    _TARGET_FRAME = np.array([255.0, 255.0, 165.0])  # #FFFFA5
    global_scales = np.ones(3, dtype=np.float32)
    frame_p85 = np.zeros(3, dtype=np.float32)
    for ch in range(3):
        vals = []
        for gy in range(INNER_TOP):
            for gx in range(10, SCREEN_W - 10):
                blk = corrected_rgb[gy*scale:(gy+1)*scale, gx*scale:(gx+1)*scale, ch]
                if blk.size > 0:
                    vals.append(float(np.percentile(blk, 85)))
        if vals:
            arr = np.array(vals)
            med = float(np.median(arr))
            arr = arr[arr > 0.5 * med]  # reject outliers (dark dashes)
            frame_p85[ch] = float(np.median(arr)) if arr.size else med
        if frame_p85[ch] > 10.0:
            global_scales[ch] = _TARGET_FRAME[ch] / frame_p85[ch]
            corrected_rgb[:, :, ch] = np.clip(
                corrected_rgb[:, :, ch] * global_scales[ch], 0, 255)

    log(f"  Frame p85 before norm: R={frame_p85[0]:.0f} G={frame_p85[1]:.0f} B={frame_p85[2]:.0f}")
    log(f"  Global scales: R={global_scales[0]:.4f} G={global_scales[1]:.4f} B={global_scales[2]:.4f}")

    # Observed border R (for downstream k-means seeding)
    obs_border_R = float(np.median(
        [_gb_block_sample_ch_color(img_rgb, gy, gx_b, scale, 0)
         for gy in range(INNER_TOP, INNER_BOT + 1)
         for gx_b in (INNER_LEFT, INNER_RIGHT)] +
        [_gb_block_sample_ch_color(img_rgb, gy_b, gx, scale, 0)
         for gx in range(INNER_LEFT, INNER_RIGHT + 1)
         for gy_b in (INNER_TOP, INNER_BOT)]))

    out_bgr = cv2.cvtColor(np.clip(corrected_rgb, 0, 255).astype(np.uint8),
                            cv2.COLOR_RGB2BGR)
    cv2.imwrite(str(output_path), out_bgr)
    log(f"  Saved → {output_path}  (colour, frame normalised to #FFFFA5)", always=True)

    # Verify: sample the camera area and check inner border
    cam_rgb = corrected_rgb[FRAME_THICK*scale:(FRAME_THICK+CAM_H)*scale,
                            FRAME_THICK*scale:(FRAME_THICK+CAM_W)*scale, :]
    log(f"  Camera area mean: R={cam_rgb[:,:,0].mean():.1f} G={cam_rgb[:,:,1].mean():.1f} B={cam_rgb[:,:,2].mean():.1f}")

    # ── Debug images ─────────────────────────────────────────────────────────
    if debug and debug_dir and stem:
        # a: Side-by-side before/after (camera area only)
        orig_cam = img_rgb[FRAME_THICK*scale:(FRAME_THICK+CAM_H)*scale,
                           FRAME_THICK*scale:(FRAME_THICK+CAM_W)*scale, :]
        corr_cam = corrected_rgb[FRAME_THICK*scale:(FRAME_THICK+CAM_H)*scale,
                                 FRAME_THICK*scale:(FRAME_THICK+CAM_W)*scale, :]
        side_bgr = cv2.cvtColor(
            np.hstack([np.clip(orig_cam,0,255).astype(np.uint8),
                       np.clip(corr_cam,0,255).astype(np.uint8)]),
            cv2.COLOR_RGB2BGR)
        save_debug(side_bgr, debug_dir, stem, "correct_color_a_before_after")
        # b: White surface as false-colour heatmap (warm=high, cool=low) in BGR
        ws_avg = (white_surf_R + white_surf_G + white_surf_B) / 3.0
        ws_norm = np.clip((ws_avg - ws_avg.min()) / max(ws_avg.max() - ws_avg.min(), 1) * 255,
                          0, 255).astype(np.uint8)
        ws_heatmap = cv2.applyColorMap(ws_norm, cv2.COLORMAP_JET)
        save_debug(ws_heatmap, debug_dir, stem, "correct_color_b_white_surf_heatmap")
        # c: Full corrected image
        save_debug(out_bgr, debug_dir, stem, "correct_color_c_full")

    # Sidecar JSON
    import json as _json
    meta_path = _Path(output_path).with_suffix('.json')
    _json.dump({"obs_frame_R": obs_frame_R, "obs_border_R": obs_border_R,
                "frame_p85_R": float(frame_p85[0]),
                "frame_p85_G": float(frame_p85[1]),
                "frame_p85_B": float(frame_p85[2])},
               open(str(meta_path), 'w'))
    log(f"  Metadata → {meta_path}")


def _fit_surface_poly(ys, xs, vals, H, W, degree=4):
    """
    Fit a bivariate polynomial of the given degree to scatter points (ys, xs, vals)
    and evaluate it on the full (H, W) image grid.
    Coordinates are normalised to [−1, 1] for numerical stability.
    """
    yn = (np.array(ys, dtype=float) / H) * 2 - 1
    xn = (np.array(xs, dtype=float) / W) * 2 - 1
    v  = np.array(vals, dtype=float)
    cols = [(yn**dy) * (xn**dx)
            for dy in range(degree + 1)
            for dx in range(degree + 1 - dy)]
    A = np.column_stack(cols)
    coeffs, _, _, _ = np.linalg.lstsq(A, v, rcond=None)

    all_y = np.arange(H, dtype=float)
    all_x = np.arange(W, dtype=float)
    YN, XN = np.meshgrid((all_y / H) * 2 - 1, (all_x / W) * 2 - 1, indexing='ij')
    cols2 = [(YN.ravel()**dy) * (XN.ravel()**dx)
             for dy in range(degree + 1)
             for dx in range(degree + 1 - dy)]
    return (np.column_stack(cols2) @ coeffs).reshape(H, W).astype(np.float32)


def _collect_border_dark(gray, scale, dark_smooth):
    """
    Return (border_y, border_x, border_v) arrays for the smoothed inner-border
    dark-gray reference measurements, suitable for polynomial fitting.
    """
    left, right, top, bot = collect_dark_samples(gray, scale)
    ld = uniform_filter1d(left.astype(float),  size=dark_smooth, mode='nearest')
    rd = uniform_filter1d(right.astype(float), size=dark_smooth, mode='nearest')
    td = uniform_filter1d(top.astype(float),   size=dark_smooth, mode='nearest')
    bd = uniform_filter1d(bot.astype(float),   size=dark_smooth, mode='nearest')

    gy_range = range(INNER_TOP, INNER_BOT + 1)
    gx_range = range(INNER_LEFT, INNER_RIGHT + 1)
    y_rows = np.array([gy * scale + scale // 2 for gy in gy_range], dtype=float)
    x_cols = np.array([gx * scale + scale // 2 for gx in gx_range], dtype=float)

    bdy, bdx, bdv = [], [], []
    for i, _ in enumerate(gy_range):
        bdy += [y_rows[i], y_rows[i]];  bdx += [x_cols[0], x_cols[-1]];  bdv += [ld[i], rd[i]]
    for j, _ in enumerate(gx_range):
        bdy += [y_rows[0], y_rows[-1]]; bdx += [x_cols[j], x_cols[j]];   bdv += [td[j], bd[j]]
    return np.array(bdy), np.array(bdx), np.array(bdv)


# ─────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────

def process_file(input_path, output_path, scale=8, poly_degree=2,
                 dark_smooth=13, refine_passes=1, color=True,
                 debug=False, debug_dir=None):
    """
    Compute brightness-corrected output for a single warp-step image.

    Parameters
    ----------
    input_path : str or Path
        Path to the <stem>_warp.png from the warp step.
    output_path : str or Path
        Destination for the corrected image.
    scale : int
        Pixels per GB pixel; must match the warp step.
    poly_degree : int
        Degree of the bivariate polynomial used for the white reference surface.
    dark_smooth : int
        Smoothing window (GB pixels) applied to each inner-border curve before
        building the initial Coons patch dark surface.
    refine_passes : int
        Number of refinement passes after the initial Coons correction.
        Each pass collects confident dark-gray interior pixels from the previous
        corrected image, uses their warp-centre brightness as additional calibration
        points, and re-fits the dark surface with a degree-4 polynomial over the
        combined border + interior dataset.
        Default: 1 (one refinement pass after initial Coons patch).
        Set to 0 to disable and use only the Coons patch.
    """
    if color:
        _process_file_color(input_path, output_path, scale=scale,
                            poly_degree=poly_degree, dark_smooth=dark_smooth,
                            refine_passes=refine_passes,
                            debug=debug, debug_dir=debug_dir)
        return

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

    def _apply_correction(ds):
        span   = np.maximum(white_surf - ds, 5.0)
        gain   = (span / (_TRUE_WHITE - _TRUE_DARK)).astype(np.float32)
        offset = (ds - gain * _TRUE_DARK).astype(np.float32)
        return np.clip(np.round((gray.astype(np.float32) - offset) / gain),
                       0, 255).astype(np.uint8)

    log("  Applying per-pixel affine correction (pass 1 — Coons patch dark surface)…")
    corrected = _apply_correction(dark_surf)

    # ── Iterative refinement passes ──────────────────────────────
    if refine_passes > 0:
        border_y, border_x, border_v = _collect_border_dark(gray, scale, dark_smooth)
        for pass_n in range(1, refine_passes + 1):
            # Lightweight inline sample of the current corrected image
            sample_approx = _quick_sample(corrected, scale, h_margin=2, v_margin=1)

            # Collect confident dark-gray interior pixels as additional calibration.
            # These pixels have sample value in [60, 110] — well above the noise floor
            # (~4) and the black/dg boundary (~40) yet below the dg/lg boundary (~120).
            # Their warp-centre brightness directly measures dark_surf at that location.
            _DG_SMIN, _DG_SMAX = 60, 110
            # Rough classify: below midpoint → black, in DG band → candidate
            rough_thresh = 42.0
            dg_mask = (sample_approx >= _DG_SMIN) & (sample_approx <= _DG_SMAX)
            cys, cxs = np.where(dg_mask)
            n_cal = len(cys)
            log(f"  Refinement pass {pass_n}: {n_cal} interior dark-gray calibration pixels…")

            if n_cal < 50:
                log(f"    Too few calibration pixels — skipping further refinement.")
                break

            cal_y = np.array([(FRAME_THICK + gy) * scale + scale // 2
                               for gy, gx in zip(cys, cxs)], dtype=float)
            cal_x = np.array([(FRAME_THICK + gx) * scale + scale // 2
                               for gy, gx in zip(cys, cxs)], dtype=float)
            cal_v = np.array([float(gray[(FRAME_THICK + gy) * scale + scale // 2,
                                         (FRAME_THICK + gx) * scale + scale // 2])
                               for gy, gx in zip(cys, cxs)], dtype=float)

            # Fit degree-4 polynomial to border + interior calibration
            all_y = np.concatenate([border_y, cal_y])
            all_x = np.concatenate([border_x, cal_x])
            all_v = np.concatenate([border_v, cal_v])
            dark_surf_ref = _fit_surface_poly(all_y, all_x, all_v, H, W, degree=4)
            log(f"    Dark surface refined — corner delta: "
                + ", ".join(f"({r},{c}): {dark_surf_ref[r,c]-dark_surf[r,c]:+.1f}"
                            for r, c in corners))
            dark_surf = dark_surf_ref
            corrected = _apply_correction(dark_surf)

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
        # Gain map: recompute for visualisation only
        _span = np.maximum(white_surf - dark_surf, 5.0)
        _gain = (_span / (_TRUE_WHITE - _TRUE_DARK)).astype(np.float32)
        g_min, g_max = _gain.min(), _gain.max()
        gain_vis = ((_gain - g_min) / max(g_max - g_min, 1e-6) * 255).astype(np.uint8)
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
    parser.add_argument("--refine-passes", type=int, default=1, metavar="N",
                        help="Number of interior-calibration refinement passes after the "
                             "initial Coons patch correction. Each pass samples the current "
                             "corrected image, collects confident dark-gray interior pixels "
                             "as additional dark-surface calibration, and re-fits a degree-4 "
                             "polynomial. Default: 1 (one pass). Set to 0 for Coons-only.")
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
            process_file(f, out, args.scale, args.poly_degree, args.dark_smooth,
                         args.refine_passes, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
