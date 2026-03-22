#!/usr/bin/env python3
"""
gbcam_warp.py — Warp step: perspective correction

Takes a phone photo of a GBA SP screen and outputs a perspective-corrected
image of the full 160x144 GB screen at a fixed pixel scale.

Processing:
  1. Detect the four corners of the white filmstrip frame using brightness
     thresholding and contour analysis.
  2. Apply an initial perspective warp to a (SCREEN_W*scale)x(SCREEN_H*scale)
     rectangle (default 1280x1152 at scale=8).
  3. Refine alignment: detect where the inner border band actually landed in
     the warped image using sub-pixel gradient-peak detection on all four
     sides (always scanning FROM the reliable white-frame side), then
     back-project the corrected corner positions to the original photo and
     re-apply a single-pass perspective warp -- no black bars possible.

Input:  phone photo (.jpg / .png, any size)
Output: <stem>_warp.png -- colour PNG, (160*scale)x(144*scale) px

Standalone usage:
  python gbcam_warp.py photo.jpg [photo2.jpg ...]  [options]
  python gbcam_warp.py --dir ./photos              [options]

Options:
  --output-dir DIR    Where to write output files (default: same dir as input)
  --scale N           Pixels per GB pixel (default: 8)
  --threshold T       Brightness threshold for screen detection (default: 180)
  --debug             Save intermediate debug images
"""

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
import argparse
import sys
import traceback
from pathlib import Path

from gbcam_common import (
    SCREEN_W, SCREEN_H, INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT,
    FRAME_THICK,
    STEP_SUFFIX,
    log, set_verbose, save_debug, collect_inputs, make_output_path,
)

SUFFIX = STEP_SUFFIX["warp"]


# ---------------------------------------------------------------------------
# Corner detection
# ---------------------------------------------------------------------------

def _order_corners(pts):
    pts  = pts.astype(float)
    s    = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(diff)],
                     pts[np.argmax(s)], pts[np.argmax(diff)]], dtype=np.float32)


def _score_quad(ordered, img_w, img_h, target_aspect=160/144):
    TL, TR, BR, BL = ordered
    top   = float(np.linalg.norm(TR - TL))
    bot   = float(np.linalg.norm(BR - BL))
    left  = float(np.linalg.norm(BL - TL))
    right = float(np.linalg.norm(BR - TR))
    w_avg = (top + bot) / 2
    h_avg = (left + right) / 2
    if h_avg < 10:
        return 1e9
    aspect_err   = abs(w_avg / h_avg / target_aspect - 1.0)
    parallel_err = (abs(top - bot) / max(w_avg, 1)
                    + abs(left - right) / max(h_avg, 1))
    margin = 5
    clips = sum([TL[0] < margin, TL[1] < margin,
                 TR[0] > img_w - margin, TR[1] < margin,
                 BR[0] > img_w - margin, BR[1] > img_h - margin,
                 BL[0] < margin, BL[1] > img_h - margin])
    return aspect_err * 2.0 + parallel_err + clips * 0.1


def find_screen_corners(img, thresh_val=180, debug=False, debug_dir=None, stem=None):
    """Locate the four corners of the white GB screen frame."""
    gray         = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    img_h, img_w = gray.shape
    kernel       = np.ones((7, 7), np.uint8)
    best         = None

    for thresh in range(thresh_val, 114, -5):
        _, binary   = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        closed      = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        largest  = contours[0]
        area     = cv2.contourArea(largest)
        if area < 1000:
            continue

        hull = cv2.convexHull(largest)
        peri = cv2.arcLength(hull, True)
        quad = None
        for eps in [0.02, 0.03, 0.05, 0.01, 0.10]:
            approx = cv2.approxPolyDP(hull, eps * peri, True).reshape(-1, 2)
            if len(approx) == 4:
                quad = approx
                break
        if quad is None:
            x, y, w, h = cv2.boundingRect(largest)
            quad = np.array([[x, y], [x+w, y], [x+w, y+h], [x, y+h]])

        ordered = _order_corners(quad.astype(float))
        score   = _score_quad(ordered, img_w, img_h)

        if best is None or score < best[0]:
            x, y, w, h = cv2.boundingRect(largest)
            aspect = w / h if h else 0
            best = (score, ordered, thresh, area, aspect)

        if score < 0.05:
            break

    if best is None:
        raise RuntimeError("No bright contour found -- try adjusting --threshold")

    score, ordered, used_thresh, area, aspect = best
    log(f"  Contour: area={area:.0f}  aspect={aspect:.3f} "
        f"(expected~{SCREEN_W/SCREEN_H:.3f})  thresh={used_thresh}  "
        f"quad_score={score:.4f}")
    if score > 0.15:
        log("  WARNING: quad quality is low -- detection may be unreliable")
    log(f"  Corners (TL TR BR BL): {ordered.astype(int).tolist()}")

    if debug and debug_dir and stem:
        dbg = img.copy()
        for pt in ordered:
            cv2.circle(dbg, tuple(pt.astype(int)), 14, (0, 255, 0), -1)
        cv2.polylines(dbg, [ordered.reshape(-1, 1, 2).astype(int)],
                      True, (0, 255, 0), 3)
        save_debug(dbg, debug_dir, stem, "warp_a_corners")
    return ordered


def _initial_warp(img, corners, scale, debug=False, debug_dir=None, stem=None):
    W, H = SCREEN_W * scale, SCREEN_H * scale
    dst  = np.array([[0, 0], [W-1, 0], [W-1, H-1], [0, H-1]], dtype=np.float32)
    M    = cv2.getPerspectiveTransform(corners, dst)
    warped = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_LANCZOS4)
    log(f"  Initial warp -> {W}x{H}  (scale={scale})")
    if debug and debug_dir and stem:
        save_debug(warped, debug_dir, stem, "warp_b_initial_color")
    return warped, M


# ---------------------------------------------------------------------------
# Sub-pixel inner-border edge detection
# ---------------------------------------------------------------------------

def _find_edge_subpix(profile, base, descending, scale):
    """
    Locate the outer (first-dark-pixel) edge of the inner-border band.

    We ALWAYS scan from the white-frame side because the frame is uniformly
    bright and gives a clean, high-contrast gradient signal.

    descending=True  (top and left sides)
        Profile runs from the white frame DOWN/RIGHT into the dark border.
        The derivative dips to its MINIMUM at the last-white/first-dark
        boundary.  First dark pixel = argmin(diff) + 1 in profile coords.

    descending=False  (bottom and right sides)
        Profile still runs in the natural image direction, so the dark border
        appears BEFORE the white frame.  The derivative peaks to its MAXIMUM
        at the last-dark/first-white boundary.  Because the border is
        ``scale`` pixels wide, the first dark pixel = argmax(diff) - scale + 1
        in profile coords.

    Sub-pixel accuracy via parabolic interpolation on the diff extremum.
    Returns a float pixel coordinate in the original image space.
    """
    p = gaussian_filter1d(profile.astype(float), sigma=1.5)
    d = np.diff(p)

    k = int(np.argmin(d) if descending else np.argmax(d))

    # Parabolic sub-pixel refinement
    delta = 0.0
    if 0 < k < len(d) - 1:
        d0, d1, d2 = float(d[k - 1]), float(d[k]), float(d[k + 1])
        denom = d0 - 2.0 * d1 + d2
        if abs(denom) > 1e-10:
            delta = float(np.clip(0.5 * (d0 - d2) / denom, -1.0, 1.0))

    if descending:
        # k is the last-white pixel; first dark pixel is k+1
        return base + (k + 1) + delta
    else:
        # k is the last-dark/first-white boundary; first dark pixel = k - scale + 1
        return base + (k - scale + 1) + delta


def _find_border_outer_edges(channel, scale):
    """
    Detect the outer edge of each inner-border band with sub-pixel accuracy.

    Returns (top_row, bot_row, left_col, right_col) as float pixel coords,
    each being the FIRST DARK PIXEL of the respective border band:

        top_row   ~= INNER_TOP   * scale   (120 at scale=8)
        bot_row   ~= INNER_BOT   * scale   (1024 at scale=8)
        left_col  ~= INNER_LEFT  * scale   (120 at scale=8)
        right_col ~= INNER_RIGHT * scale   (1152 at scale=8)

    ``channel`` is the R-B contrast image (uint8, H x W):
        warm frame  (#FFFFA5)  -> high values
        cool border (#9494FF)  -> low values
    """
    H, W = channel.shape
    srch  = 6 * scale      # search half-window around expected position

    # Averaging bands: stay well clear of corners and frame dash regions
    c_lo = 20 * scale;       c_hi = min(W, 140 * scale)
    r_lo = 20 * scale;       r_hi = min(H, (SCREEN_H - 20) * scale)

    # Top: white frame is ABOVE the border -> scan descends into border
    exp = INNER_TOP * scale
    r1  = max(0, exp - srch);  r2 = min(H, exp + srch)
    top_row = _find_edge_subpix(
        channel[r1:r2, c_lo:c_hi].mean(axis=1), r1,
        descending=True, scale=scale)

    # Bottom: white frame is BELOW the border -> border precedes frame in scan
    # The first dark pixel of the bottom band sits at INNER_BOT * scale.
    exp_end = (INNER_BOT + 1) * scale   # one pixel past the band
    r1 = max(0, exp_end - srch);  r2 = min(H, exp_end + srch)
    bot_row = _find_edge_subpix(
        channel[r1:r2, c_lo:c_hi].mean(axis=1), r1,
        descending=False, scale=scale)

    # Left: white frame is to the LEFT -> scan descends into border
    exp = INNER_LEFT * scale
    c1  = max(0, exp - srch);  c2 = min(W, exp + srch)
    left_col = _find_edge_subpix(
        channel[r_lo:r_hi, c1:c2].mean(axis=0), c1,
        descending=True, scale=scale)

    # Right: white frame is to the RIGHT -> border precedes frame in scan
    exp_end = (INNER_RIGHT + 1) * scale
    c1 = max(0, exp_end - srch);  c2 = min(W, exp_end + srch)
    right_col = _find_edge_subpix(
        channel[r_lo:r_hi, c1:c2].mean(axis=0), c1,
        descending=False, scale=scale)

    return top_row, bot_row, left_col, right_col


# ---------------------------------------------------------------------------
# Refinement via back-projection to the original photo
# ---------------------------------------------------------------------------

def refine_warp(img, initial_M, warped, scale, debug=False, debug_dir=None, stem=None):
    """
    Snap the inner border to its exact pixel-grid position without black bars.

    Warping the already-warped image a second time would produce black bars
    whenever the correction needs to expand the content outward (the output
    corners would need to sample beyond the warped image boundary).

    Instead this function:
      1. Builds the R-B contrast channel from the warped image.
      2. Detects the inner border position with sub-pixel accuracy.
      3. Computes H_corr: 4-point homography, detected -> expected border.
      4. Applies H_corr^-1 to the four output canvas corners to find which
         positions in the warped image they correspond to.
      5. Applies initial_M^-1 to back-project those positions to the original
         phone photo (which always has dark margin outside the screen).
      6. Computes a new single-pass perspective warp from those source corners
         and warps the original image directly -- canvas always fully filled.
    """
    H, W = warped.shape[:2]

    # R-B channel: warm frame (#FFFFA5) -> high; cool border (#9494FF) -> low
    rgb   = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB).astype(np.float32)
    rb_ch = np.clip(rgb[:, :, 0] - rgb[:, :, 2] + 128.0, 0.0, 255.0).astype(np.uint8)

    top, bot, left, right = _find_border_outer_edges(rb_ch, scale)

    exp_top   = float(INNER_TOP   * scale)
    exp_bot   = float(INNER_BOT   * scale)
    exp_left  = float(INNER_LEFT  * scale)
    exp_right = float(INNER_RIGHT * scale)

    log(f"  Border edges (sub-pixel): "
        f"top={top:.2f}(exp={exp_top:.0f},err={top-exp_top:+.2f}), "
        f"bot={bot:.2f}(exp={exp_bot:.0f},err={bot-exp_bot:+.2f}), "
        f"left={left:.2f}(exp={exp_left:.0f},err={left-exp_left:+.2f}), "
        f"right={right:.2f}(exp={exp_right:.0f},err={right-exp_right:+.2f})")

    # Sanity check: skip if any measurement is wildly off
    max_err = (FRAME_THICK // 2) * scale
    if (abs(top   - exp_top)   > max_err or abs(bot   - exp_bot)   > max_err or
            abs(left  - exp_left)  > max_err or abs(right - exp_right) > max_err):
        log("  WARNING: border error too large -- skipping refinement")
        if debug and debug_dir and stem:
            save_debug(warped, debug_dir, stem, "warp_d_refined_color")
        return warped

    # Step 1: H_corr maps detected border rectangle -> expected rectangle
    src_brd = np.float32([[left,  top], [right, top],
                           [right, bot], [left,  bot]])
    dst_brd = np.float32([[exp_left,  exp_top], [exp_right, exp_top],
                           [exp_right, exp_bot], [exp_left,  exp_bot]])
    H_corr = cv2.getPerspectiveTransform(src_brd, dst_brd)

    # Step 2: find where the output canvas corners map to in warped-image space
    # H_corr:    warped-space -> corrected-space
    # H_corr^-1: corrected-space -> warped-space
    canvas_corners = np.float32([[[0,   0  ],
                                   [W-1, 0  ],
                                   [W-1, H-1],
                                   [0,   H-1]]])
    H_corr_inv        = np.linalg.inv(H_corr)
    corners_in_warped = cv2.perspectiveTransform(
        canvas_corners, H_corr_inv).reshape(-1, 2)

    # Step 3: back-project those warped-space positions to the original photo
    M1_inv         = np.linalg.inv(initial_M)
    corners_in_src = cv2.perspectiveTransform(
        corners_in_warped.reshape(1, -1, 2), M1_inv).reshape(-1, 2)

    log(f"  Corrected src corners: {corners_in_src.astype(int).tolist()}")

    # Step 4: single-pass warp from corrected source corners
    dst_corners = np.float32([[0,   0  ],
                               [W-1, 0  ],
                               [W-1, H-1],
                               [0,   H-1]])
    M_new   = cv2.getPerspectiveTransform(corners_in_src, dst_corners)
    refined = cv2.warpPerspective(img, M_new, (W, H), flags=cv2.INTER_LANCZOS4)

    # Verify post-refinement border positions
    rgb2   = cv2.cvtColor(refined, cv2.COLOR_BGR2RGB).astype(np.float32)
    rb_ch2 = np.clip(rgb2[:, :, 0] - rgb2[:, :, 2] + 128.0, 0.0, 255.0).astype(np.uint8)
    t2, b2, l2, r2 = _find_border_outer_edges(rb_ch2, scale)
    log(f"  After refinement: "
        f"top={t2:.2f}(exp={exp_top:.0f},err={t2-exp_top:+.2f}), "
        f"bot={b2:.2f}(exp={exp_bot:.0f},err={b2-exp_bot:+.2f}), "
        f"left={l2:.2f}(exp={exp_left:.0f},err={l2-exp_left:+.2f}), "
        f"right={r2:.2f}(exp={exp_right:.0f},err={r2-exp_right:+.2f})")

    if debug and debug_dir and stem:
        save_debug(refined, debug_dir, stem, "warp_d_refined_color")

    return refined


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def process_file(input_path, output_path, scale=8, thresh_val=180,
                 debug=False, debug_dir=None):
    stem = Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[warp] {input_path}", always=True)

    img = cv2.imread(str(input_path))
    if img is None:
        raise RuntimeError(f"Cannot read image: {input_path}")
    log(f"  Loaded {img.shape[1]}x{img.shape[0]} px")

    log("  a -- Detecting screen corners")
    corners = find_screen_corners(img, thresh_val, debug, debug_dir, stem)

    log("  b -- Initial perspective warp")
    warped, initial_M = _initial_warp(img, corners, scale, debug, debug_dir, stem)

    log("  c -- Refining alignment (sub-pixel border detection, back-projection)")
    warped = refine_warp(img, initial_M, warped, scale, debug, debug_dir, stem)

    # Warmth pre-processing (disabled -- B channel preserved for correction step)
    _WARMTH_STRENGTH = 0.0
    _W_MAT_FULL = np.array([
        [0.925, 0.0,   0.0  ],
        [0.0,   0.983, 0.0  ],
        [0.0,   0.0,   1.073],
    ], dtype=np.float32)
    _W_OFF_FULL = np.array([-32.58, -2.92, 26.53], dtype=np.float32)
    _W_MAT = (np.eye(3, dtype=np.float32)
              + _WARMTH_STRENGTH * (_W_MAT_FULL - np.eye(3, dtype=np.float32)))
    _W_OFF = _W_OFF_FULL * _WARMTH_STRENGTH
    warped = np.clip(warped.astype(np.float32) @ _W_MAT.T + _W_OFF,
                     0, 255).astype(np.uint8)

    log(f"  d -- Warmth ({_WARMTH_STRENGTH:.0%}): "
        f"R x{_W_MAT[2,2]:.3f}{_W_OFF[2]:+.1f}  "
        f"G x{_W_MAT[1,1]:.3f}{_W_OFF[1]:+.1f}  "
        f"B x{_W_MAT[0,0]:.3f}{_W_OFF[0]:+.1f}")

    cv2.imwrite(str(output_path), warped)
    log(f"  Saved -> {output_path}  (colour BGR)", always=True)


# ---------------------------------------------------------------------------
# Standalone CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Warp step: perspective-correct a GBA SP phone photo",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("inputs", nargs="*",
                        help="Phone photo files to warp (.jpg or .png).")
    parser.add_argument("--dir", "-d", metavar="DIR",
                        help="Directory of phone photos to glob.")
    parser.add_argument("--output-dir", "-o", metavar="DIR",
                        help="Where to write *_warp.png outputs. Default: same "
                             "directory as each input file.")
    parser.add_argument("--scale", type=int, default=8, metavar="N",
                        help="Working resolution multiplier. Default: 8.")
    parser.add_argument("--threshold", type=int, default=180, metavar="T",
                        help="Brightness threshold (0-255) for screen detection. "
                             "Default: 180.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save diagnostic images "
                             "to <output-dir>/debug/.")
    args = parser.parse_args()
    set_verbose(args.debug)
    files = collect_inputs(args.inputs, args.dir)
    if not files:
        parser.print_help()
        print("\nError: no input files.", file=sys.stderr)
        sys.exit(1)
    debug_dir = (args.output_dir or ".") + "/debug" if args.debug else None
    errors = []
    for f in files:
        out = make_output_path(f, args.output_dir, SUFFIX)
        try:
            process_file(f, out, args.scale, args.threshold, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR -- {f}: {e}", file=sys.stderr)
            if args.debug:
                traceback.print_exc()
            errors.append(f)
    print(f"\nDone -- {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
