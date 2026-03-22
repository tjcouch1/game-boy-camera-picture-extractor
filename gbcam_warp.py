#!/usr/bin/env python3
"""
gbcam_warp.py — Warp step: perspective correction

Takes a phone photo of a GBA SP screen and outputs a perspective-corrected
image of the full 160x144 GB screen at a fixed pixel scale.

Processing:
  1. Detect the four corners of the white filmstrip frame using brightness
     thresholding and contour analysis.
  2. Apply an initial perspective warp to (SCREEN_W*scale) x (SCREEN_H*scale).
  3. Two-pass inner-border refinement:
       All four edges scan FROM the white-frame side for maximum reliability.
       Top/left scan directly; bottom/right flip the profile so the frame
       comes first, find the frame->border drop, subtract (scale-1) for the
       outer edge.  Back-project corrected corners to the original photo and
       re-warp in a single pass -- no black bars possible.

Input:  phone photo (.jpg / .png, any size)
Output: <stem>_warp.png -- colour PNG, (160*scale) x (144*scale) px

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
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL,
                                        cv2.CHAIN_APPROX_SIMPLE)
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
    W, H   = SCREEN_W * scale, SCREEN_H * scale
    dst    = np.array([[0, 0], [W-1, 0], [W-1, H-1], [0, H-1]], dtype=np.float32)
    M      = cv2.getPerspectiveTransform(corners, dst)
    warped = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_LANCZOS4)
    log(f"  Initial warp -> {W}x{H}  (scale={scale})")
    if debug and debug_dir and stem:
        save_debug(warped, debug_dir, stem, "warp_b_initial_color")
    return warped, M


# ---------------------------------------------------------------------------
# Sub-pixel inner-border edge detection
# ---------------------------------------------------------------------------

def _first_dark_from_frame(profile):
    """
    Sub-pixel index of the first dark pixel scanning FROM the white frame.
    Profile must start HIGH (white frame) and drop LOW (dark border).
    Returns float index into `profile`.
    """
    p = gaussian_filter1d(profile.astype(float), sigma=1.5)
    d = np.diff(p)
    k = int(np.argmin(d))
    delta = 0.0
    if 0 < k < len(d) - 1:
        d0, d1, d2 = float(d[k - 1]), float(d[k]), float(d[k + 1])
        denom = d0 - 2.0 * d1 + d2
        if abs(denom) > 1e-10:
            delta = float(np.clip(0.5 * (d0 - d2) / denom, -1.0, 1.0))
    return float(k + 1 + delta)


def _find_border_outer_edges(channel, scale):
    """
    Detect the outer (camera-facing) edge of each inner-border band.
    All four sides scan FROM the white frame for maximum reliability.

    TOP / LEFT : profile starts at the frame, drops into border -- direct scan.
    BOT / RIGHT: frame is on the far side, so the profile is FLIPPED before
                 calling _first_dark_from_frame, giving the INNER (frame-facing)
                 edge; subtracting (scale-1) gives the OUTER edge.

    Returns (top_row, bot_row, left_col, right_col) as float pixel coords.
    """
    H, W = channel.shape
    srch = 6 * scale
    c_lo = 20 * scale;  c_hi = min(W, 140 * scale)
    r_lo = 20 * scale;  r_hi = min(H, (SCREEN_H - 20) * scale)

    # TOP
    exp_top = INNER_TOP * scale
    r1 = max(0, exp_top - srch);  r2 = min(H, exp_top + srch)
    top_row = r1 + _first_dark_from_frame(
        channel[r1:r2, c_lo:c_hi].mean(axis=1))

    # BOTTOM (flipped -- frame side is at higher row indices)
    exp_bot_frame = (INNER_BOT + 1) * scale
    r1b = max(0, exp_bot_frame - srch);  r2b = min(H, exp_bot_frame + srch)
    prof_b      = channel[r1b:r2b, c_lo:c_hi].mean(axis=1)
    inner_idx_b = _first_dark_from_frame(prof_b[::-1])
    bot_row     = (r2b - 1) - inner_idx_b - (scale - 1)

    # LEFT
    exp_left = INNER_LEFT * scale
    c1 = max(0, exp_left - srch);  c2 = min(W, exp_left + srch)
    left_col = c1 + _first_dark_from_frame(
        channel[r_lo:r_hi, c1:c2].mean(axis=0))

    # RIGHT (flipped -- frame side is at higher col indices)
    exp_right_frame = (INNER_RIGHT + 1) * scale
    c1r = max(0, exp_right_frame - srch);  c2r = min(W, exp_right_frame + srch)
    prof_r      = channel[r_lo:r_hi, c1r:c2r].mean(axis=0)
    inner_idx_r = _first_dark_from_frame(prof_r[::-1])
    right_col   = (c2r - 1) - inner_idx_r - (scale - 1)

    return top_row, bot_row, left_col, right_col


# ---------------------------------------------------------------------------
# Back-projection refinement
# ---------------------------------------------------------------------------

def refine_warp(img, current_M, warped, scale,
                debug=False, debug_dir=None, stem=None, pass_num=1):
    """
    Snap the inner border to its exact pixel-grid position without black bars.

    Detects where the inner border landed in the warped image, computes a
    correction homography H_corr (detected -> expected border rectangle),
    back-projects the output canvas corners through H_corr^-1 and current_M^-1
    to the original photo, then re-warps in a single fresh pass.

    Returns (refined_image, new_M).
    """
    H, W = warped.shape[:2]

    # R-B channel: warm frame (#FFFFA5) -> HIGH; cool border (#9494FF) -> LOW
    rgb   = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB).astype(np.float32)
    rb_ch = np.clip(rgb[:, :, 0] - rgb[:, :, 2] + 128.0, 0.0, 255.0).astype(np.uint8)

    top, bot, left, right = _find_border_outer_edges(rb_ch, scale)

    exp_top   = float(INNER_TOP   * scale)
    exp_bot   = float(INNER_BOT   * scale)
    exp_left  = float(INNER_LEFT  * scale)
    exp_right = float(INNER_RIGHT * scale)

    log(f"  Pass {pass_num} border edges: "
        f"top={top:.2f}(exp={exp_top:.0f},err={top-exp_top:+.2f}), "
        f"bot={bot:.2f}(exp={exp_bot:.0f},err={bot-exp_bot:+.2f}), "
        f"left={left:.2f}(exp={exp_left:.0f},err={left-exp_left:+.2f}), "
        f"right={right:.2f}(exp={exp_right:.0f},err={right-exp_right:+.2f})")

    max_err = (16 // 2) * scale   # FRAME_THICK / 2 * scale
    if (abs(top   - exp_top)   > max_err or abs(bot   - exp_bot)   > max_err or
            abs(left  - exp_left)  > max_err or abs(right - exp_right) > max_err):
        log(f"  WARNING: pass {pass_num} border error too large -- skipping")
        if debug and debug_dir and stem and pass_num >= 2:
            save_debug(warped, debug_dir, stem, "warp_d_refined_color")
        return warped, current_M

    src_brd = np.float32([[left,  top], [right, top],
                           [right, bot], [left,  bot]])
    dst_brd = np.float32([[exp_left,  exp_top], [exp_right, exp_top],
                           [exp_right, exp_bot], [exp_left,  exp_bot]])
    H_corr = cv2.getPerspectiveTransform(src_brd, dst_brd)

    canvas = np.float32([[[0,   0  ],
                           [W-1, 0  ],
                           [W-1, H-1],
                           [0,   H-1]]])
    corners_in_warped = cv2.perspectiveTransform(
        canvas, np.linalg.inv(H_corr)).reshape(-1, 2)
    corners_in_src = cv2.perspectiveTransform(
        corners_in_warped.reshape(1, -1, 2),
        np.linalg.inv(current_M)).reshape(-1, 2)

    log(f"  Pass {pass_num} src corners: {corners_in_src.astype(int).tolist()}")

    dst_corners = np.float32([[0,   0  ],
                               [W-1, 0  ],
                               [W-1, H-1],
                               [0,   H-1]])
    M_new   = cv2.getPerspectiveTransform(corners_in_src, dst_corners)
    refined = cv2.warpPerspective(img, M_new, (W, H), flags=cv2.INTER_LANCZOS4)

    if debug and debug_dir and stem and pass_num >= 2:
        save_debug(refined, debug_dir, stem, "warp_d_refined_color")

    return refined, M_new


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
    warped, M = _initial_warp(img, corners, scale, debug, debug_dir, stem)

    log("  c -- Refining (pass 1)")
    warped, M = refine_warp(img, M, warped, scale, debug, debug_dir, stem, pass_num=1)

    log("  c -- Refining (pass 2)")
    warped, M = refine_warp(img, M, warped, scale, debug, debug_dir, stem, pass_num=2)

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
