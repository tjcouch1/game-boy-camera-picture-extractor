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
    log(f"  Initial verification:")
    _verify_dash_positions(warped, scale, debug_dir, stem)
    if debug and debug_dir and stem:
        save_debug(warped, debug_dir, stem, "warp_b_initial_color")
    return warped, M


# ---------------------------------------------------------------------------
# Sub-pixel inner-border edge detection
# ---------------------------------------------------------------------------

def _first_dark_from_frame(profile, smooth_sigma=1.5):
    """
    Sub-pixel index of the first dark pixel scanning FROM the white frame.
    Profile must start HIGH (white frame) and drop LOW (dark border).
    Returns float index into `profile`.
    
    Uses adaptive smoothing and local curvature for improved robustness in
    low-contrast areas.
    """
    p = gaussian_filter1d(profile.astype(float), sigma=smooth_sigma)
    d = np.diff(p)
    k = int(np.argmin(d))
    delta = 0.0
    if 0 < k < len(d) - 1:
        d0, d1, d2 = float(d[k - 1]), float(d[k]), float(d[k + 1])
        denom = d0 - 2.0 * d1 + d2
        if abs(denom) > 1e-10:
            delta = float(np.clip(0.5 * (d0 - d2) / denom, -1.0, 1.0))
    return float(k + 1 + delta)


def _find_border_corners(channel, scale):
    """
    Detect the four corners of the inner-border rectangle independently.

    Enhanced version: Each corner uses its own dedicated detection region
    and tries multiple strategies to find the border edge, with fallback
    to midpoint detection if initial edge detection fails.

    All four sides still scan FROM the white-frame side for reliability.

    Returns (TL, TR, BR, BL) corner (x, y) float pairs.
    """
    H, W = channel.shape
    srch = 6 * scale

    # Expected positions
    exp_TL = (float(INNER_LEFT  * scale), float(INNER_TOP * scale))
    exp_TR = (float(INNER_RIGHT * scale), float(INNER_TOP * scale))
    exp_BR = (float(INNER_RIGHT * scale), float(INNER_BOT * scale))
    exp_BL = (float(INNER_LEFT  * scale), float(INNER_BOT * scale))
    
    # Define corner-specific detection bands with extra margin for robustness
    # Top-left: scan left half of top edge
    c_tl_x = (max(0, int(exp_TL[0] - srch * 2)), int(exp_TL[0] + srch))
    r_tl_y = (max(0, int(exp_TL[1] - srch * 2)), int(exp_TL[1] + srch))
    
    # Top-right: scan right half of top edge
    c_tr_x = (int(exp_TR[0] - srch), min(W, int(exp_TR[0] + srch * 2)))
    r_tr_y = (max(0, int(exp_TR[1] - srch * 2)), int(exp_TR[1] + srch))
    
    # Bottom-left: scan left half of bottom edge
    c_bl_x = (max(0, int(exp_BL[0] - srch * 2)), int(exp_BL[0] + srch))
    r_bl_y = (int(exp_BL[1] - srch), min(H, int(exp_BL[1] + srch * 2)))
    
    # Bottom-right: scan right half of bottom edge
    c_br_x = (int(exp_BR[0] - srch), min(W, int(exp_BR[0] + srch * 2)))
    r_br_y = (int(exp_BR[1] - srch), min(H, int(exp_BR[1] + srch * 2)))
    
    def _detect_y(r0, r1, c0, c1, is_bottom=False):
        """Detect Y position of horizontal edge with fallback strategy."""
        if r1 <= r0 or c1 <= c0:
            return None
        prof = channel[r0:r1, c0:c1].mean(axis=1)
        
        try:
            if is_bottom:
                # For bottom edge, flip profile so frame comes first
                idx = _first_dark_from_frame(prof[::-1])
                return (r1 - 1) - idx - (scale - 1)
            else:
                # For top edge, scan from top
                return r0 + _first_dark_from_frame(prof)
        except Exception:
            # Fallback: use simple threshold
            threshold = (prof.max() + prof.min()) / 2
            if is_bottom:
                for i in range(len(prof) - 1, -1, -1):
                    if prof[i] < threshold:
                        return r0 + i
            else:
                for i in range(len(prof)):
                    if prof[i] < threshold:
                        return r0 + i
            return None
    
    def _detect_x(r0, r1, c0, c1, is_right=False):
        """Detect X position of vertical edge with fallback strategy."""
        if r1 <= r0 or c1 <= c0:
            return None
        prof = channel[r0:r1, c0:c1].mean(axis=0)
        
        try:
            if is_right:
                # For right edge, flip profile so frame comes first
                idx = _first_dark_from_frame(prof[::-1])
                return (c1 - 1) - idx - (scale - 1)
            else:
                # For left edge, scan from left
                return c0 + _first_dark_from_frame(prof)
        except Exception:
            # Fallback: use simple threshold
            threshold = (prof.max() + prof.min()) / 2
            if is_right:
                for i in range(len(prof) - 1, -1, -1):
                    if prof[i] < threshold:
                        return c0 + i
            else:
                for i in range(len(prof)):
                    if prof[i] < threshold:
                        return c0 + i
            return None
    
    # Detect each corner independently using corner-specific bands
    tl_y = _detect_y(r_tl_y[0], r_tl_y[1], c_tl_x[0], c_tl_x[1], is_bottom=False)
    tr_y = _detect_y(r_tr_y[0], r_tr_y[1], c_tr_x[0], c_tr_x[1], is_bottom=False)
    bl_y = _detect_y(r_bl_y[0], r_bl_y[1], c_bl_x[0], c_bl_x[1], is_bottom=True)
    br_y = _detect_y(r_br_y[0], r_br_y[1], c_br_x[0], c_br_x[1], is_bottom=True)
    
    tl_x = _detect_x(r_tl_y[0], r_tl_y[1], c_tl_x[0], c_tl_x[1], is_right=False)
    tr_x = _detect_x(r_tr_y[0], r_tr_y[1], c_tr_x[0], c_tr_x[1], is_right=True)
    bl_x = _detect_x(r_bl_y[0], r_bl_y[1], c_bl_x[0], c_bl_x[1], is_right=False)
    br_x = _detect_x(r_br_y[0], r_br_y[1], c_br_x[0], c_br_x[1], is_right=True)
    
    # Check for None values (detection failures)
    for val, corner_name in [(tl_y, "TL_y"), (tr_y, "TR_y"), (bl_y, "BL_y"), (br_y, "BR_y"),
                             (tl_x, "TL_x"), (tr_x, "TR_x"), (bl_x, "BL_x"), (br_x, "BR_x")]:
        if val is None:
            raise RuntimeError(f"Failed to detect border corner {corner_name}")
    
    return (tl_x, tl_y), (tr_x, tr_y), (br_x, br_y), (bl_x, bl_y)


# ---------------------------------------------------------------------------
# Dash-position verification diagnostics
# ---------------------------------------------------------------------------

def _verify_dash_positions(warped, scale, debug_dir=None, stem=None):
    """
    Verify that the frame edges have the expected white color.
    
    This diagnostic function checks that the frame border edges are predominantly
    white (#FFFFA5), which validates that the perspective correction is accurate
    and the border wasn't clipped or misaligned.
    
    Returns True if verification passes, False otherwise.
    """
    H, W = warped.shape[:2]
    rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB).astype(np.float32)
    
    # Check top edge (should be mostly white FFFFA5)
    top_region = rgb[0:2*scale, :, :].mean(axis=(0, 1))
    # Check bottom edge
    bottom_region = rgb[-2*scale:, :, :].mean(axis=(0, 1))
    # Check left edge
    left_region = rgb[:, 0:2*scale, :].mean(axis=(0, 1))
    # Check right edge
    right_region = rgb[:, -2*scale:, :].mean(axis=(0, 1))
    
    # FFFFA5 = (165, 255, 255) in BGR
    expected = np.array([165, 255, 255], dtype=np.float32)
    
    tolerance = 20  # Allow 20-point deviation
    
    checks = [
        ("top", top_region, expected),
        ("bottom", bottom_region, expected),
        ("left", left_region, expected),
        ("right", right_region, expected),
    ]
    
    all_ok = True
    for name, actual, expect in checks:
        error = np.linalg.norm(actual - expect)
        is_ok = error < tolerance
        all_ok = all_ok and is_ok
        status = "OK" if is_ok else "WARN"
        log(f"    [verify] {name:8} edge: error={error:.1f} (expect~{expect.astype(int).tolist()}, "
            f"actual~{actual.astype(int).tolist()}) [{status}]")
    
    return all_ok


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

    TL, TR, BR, BL = _find_border_corners(rb_ch, scale)

    exp_TL = (float(INNER_LEFT  * scale), float(INNER_TOP * scale))
    exp_TR = (float(INNER_RIGHT * scale), float(INNER_TOP * scale))
    exp_BR = (float(INNER_RIGHT * scale), float(INNER_BOT * scale))
    exp_BL = (float(INNER_LEFT  * scale), float(INNER_BOT * scale))

    # Averaged edges for logging (compatible with previous log format)
    top   = (TL[1] + TR[1]) / 2;  bot   = (BL[1] + BR[1]) / 2
    left  = (TL[0] + BL[0]) / 2;  right = (TR[0] + BR[0]) / 2
    exp_top, exp_bot   = exp_TL[1], exp_BL[1]
    exp_left, exp_right = exp_TL[0], exp_TR[0]
    log(f"  Pass {pass_num} corners: "
        f"TL=({TL[0]:.1f},{TL[1]:.1f}) err=({TL[0]-exp_TL[0]:+.1f},{TL[1]-exp_TL[1]:+.1f})  "
        f"TR=({TR[0]:.1f},{TR[1]:.1f}) err=({TR[0]-exp_TR[0]:+.1f},{TR[1]-exp_TR[1]:+.1f})  "
        f"BR=({BR[0]:.1f},{BR[1]:.1f}) err=({BR[0]-exp_BR[0]:+.1f},{BR[1]-exp_BR[1]:+.1f})  "
        f"BL=({BL[0]:.1f},{BL[1]:.1f}) err=({BL[0]-exp_BL[0]:+.1f},{BL[1]-exp_BL[1]:+.1f})")
    log(f"  Pass {pass_num} border edges (avg): "
        f"top={top:.2f}(exp={exp_top:.0f},err={top-exp_top:+.2f}), "
        f"bot={bot:.2f}(exp={exp_bot:.0f},err={bot-exp_bot:+.2f}), "
        f"left={left:.2f}(exp={exp_left:.0f},err={left-exp_left:+.2f}), "
        f"right={right:.2f}(exp={exp_right:.0f},err={right-exp_right:+.2f})")

    max_err = (16 // 2) * scale   # FRAME_THICK / 2 * scale
    corners_ok = all(
        abs(cx - ex) <= max_err and abs(cy - ey) <= max_err
        for (cx, cy), (ex, ey) in zip(
            [TL, TR, BR, BL], [exp_TL, exp_TR, exp_BR, exp_BL])
    )
    if not corners_ok:
        log(f"  WARNING: pass {pass_num} border error too large -- skipping")
        if debug and debug_dir and stem and pass_num >= 2:
            save_debug(warped, debug_dir, stem, "warp_d_refined_color")
        return warped, current_M

    src_brd = np.float32([list(TL), list(TR), list(BR), list(BL)])
    dst_brd = np.float32([list(exp_TL), list(exp_TR), list(exp_BR), list(exp_BL)])
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

    # Verify frame edge colors to validate correction
    log(f"  Pass {pass_num} verification:")
    _verify_dash_positions(refined, scale, debug_dir, stem)

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
