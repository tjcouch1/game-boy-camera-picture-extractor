#!/usr/bin/env python3
"""
gbcam_warp.py — Warp step: perspective correction

Takes a phone photo of a GBA SP screen and outputs a perspective-corrected
grayscale image of the full 160×144 GB screen at a fixed pixel scale.

Processing:
  1. Detect the four corners of the white filmstrip frame using brightness
     thresholding and contour analysis.
  2. Apply an initial perspective warp to a (SCREEN_W*scale)×(SCREEN_H*scale)
     rectangle (default 1280×1152 at scale=8).
  3. Refine alignment: detect where the inner #525252 border band actually
     landed in the warped image (using gradient edge detection on each side),
     then apply a micro-correction to snap it to the exact expected position.
  4. Convert to grayscale and save.

Input:  phone photo (.jpg / .png, any size)
Output: <stem>_warp.png — grayscale PNG, (160*scale)×(144*scale) px

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


def _order_corners(pts):
    pts  = pts.astype(float)
    s    = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(diff)],
                     pts[np.argmax(s)], pts[np.argmax(diff)]], dtype=np.float32)


def _score_quad(ordered, img_w, img_h, target_aspect=160/144):
    """
    Quality score for a detected 4-corner quad (lower = better).
    Penalises: wrong aspect ratio, non-parallel opposite sides, clipped corners.
    """
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
    """
    Locate the four corners of the white GB screen frame.

    Tries thresholds from ``thresh_val`` down to 120 and picks the candidate
    with the best quad-quality score (closest to the expected 160:144 aspect
    ratio with parallel opposite sides).  This makes detection robust for
    heavily blue-tinted photos where parts of the warm white frame are too dim
    to clear the default threshold.
    """
    gray    = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    img_h, img_w = gray.shape
    kernel  = np.ones((7, 7), np.uint8)
    best    = None   # (score, corners, thresh, area, aspect)

    for thresh in range(thresh_val, 114, -5):
        _, binary  = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        closed     = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        contours, _= cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        largest  = contours[0]
        area     = cv2.contourArea(largest)
        if area < 1000:
            continue

        hull  = cv2.convexHull(largest)
        peri  = cv2.arcLength(hull, True)
        quad  = None
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

        # Good enough — stop early
        if score < 0.05:
            break

    if best is None:
        raise RuntimeError("No bright contour found — try adjusting --threshold")

    score, ordered, used_thresh, area, aspect = best
    expected = SCREEN_W / SCREEN_H
    log(f"  Contour: area={area:.0f}  aspect={aspect:.3f} (expected~{expected:.3f})"
        f"  thresh={used_thresh}  quad_score={score:.4f}")
    if score > 0.15:
        log("  WARNING: quad quality is low — detection may be unreliable")
    log(f"  Corners (TL TR BR BL): {ordered.astype(int).tolist()}")

    if debug and debug_dir and stem:
        dbg = img.copy()
        for pt in ordered:
            cv2.circle(dbg, tuple(pt.astype(int)), 14, (0, 255, 0), -1)
        cv2.polylines(dbg, [ordered.reshape(-1, 1, 2).astype(int)], True, (0, 255, 0), 3)
        save_debug(dbg, debug_dir, stem, "warp_a_corners")
    return ordered


def _initial_warp(img, corners, scale, debug=False, debug_dir=None, stem=None):
    W, H = SCREEN_W * scale, SCREEN_H * scale
    dst  = np.array([[0, 0], [W-1, 0], [W-1, H-1], [0, H-1]], dtype=np.float32)
    M    = cv2.getPerspectiveTransform(corners, dst)
    warped = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_LANCZOS4)
    log(f"  Initial warp -> {W}×{H}  (scale={scale})")
    if debug and debug_dir and stem:
        save_debug(warped, debug_dir, stem, "warp_b_initial_color")
        save_debug(warped, debug_dir, stem, "warp_c_initial_color")
    return warped


def _find_border_outer_edges(gray, scale):
    """Detect actual pixel position of each inner-border band's outer edge."""
    H, W   = gray.shape
    search = 4 * scale
    mid_c1, mid_c2 = 25 * scale, 135 * scale
    mid_r1, mid_r2 = 25 * scale, (SCREEN_H - 25) * scale

    def _desc(profile, base):
        return base + int(np.argmin(np.diff(profile.astype(float))))

    def _asc_from_end(profile, base, band_px):
        end_idx = base + int(np.argmax(np.diff(profile.astype(float))))
        return end_idx - band_px + 1

    exp = INNER_TOP * scale
    r1, r2 = max(0, exp - search), min(H, exp + search)
    top_row = _desc(gray[r1:r2, mid_c1:mid_c2].mean(axis=1), r1)

    exp_end = INNER_BOT * scale + scale
    r1, r2  = max(0, exp_end - search), min(H, exp_end + search)
    bot_row = _asc_from_end(gray[r1:r2, mid_c1:mid_c2].mean(axis=1), r1, scale)

    exp = INNER_LEFT * scale
    c1, c2 = max(0, exp - search), min(W, exp + search)
    left_col = _desc(gray[mid_r1:mid_r2, c1:c2].mean(axis=0), c1)

    exp_end = INNER_RIGHT * scale + scale
    c1, c2  = max(0, exp_end - search), min(W, exp_end + search)
    right_col = _asc_from_end(gray[mid_r1:mid_r2, c1:c2].mean(axis=0), c1, scale)

    return top_row, bot_row, left_col, right_col


def refine_warp(warped, scale, debug=False, debug_dir=None, stem=None):
    """Micro-correct the warp so the inner border sits exactly on the pixel grid."""
    H, W = warped.shape[:2]
    # The R−B difference gives maximum contrast between:
    #   frame  (#FFFFA5): R=255, B=165 -> R−B = +90  (warm, positive)
    #   border (#9494FF): R=148, B=255 -> R−B = −107 (cool, negative)
    rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB).astype(np.float32)
    rb_diff = np.clip(rgb[:, :, 0] - rgb[:, :, 2] + 128, 0, 255).astype(np.uint8)
    top, bot, left, right = _find_border_outer_edges(rb_diff, scale)
    exp_top, exp_bot = INNER_TOP * scale, INNER_BOT * scale
    exp_left, exp_right = INNER_LEFT * scale, INNER_RIGHT * scale
    log(f"  Border edges: "
        f"top={top}(exp={exp_top},err={top-exp_top}), "
        f"bot={bot}(exp={exp_bot},err={bot-exp_bot}), "
        f"left={left}(exp={exp_left},err={left-exp_left}), "
        f"right={right}(exp={exp_right},err={right-exp_right})")
    src = np.float32([[left, top], [right, top], [right, bot], [left, bot]])
    dst = np.float32([[exp_left, exp_top], [exp_right, exp_top],
                      [exp_right, exp_bot], [exp_left, exp_bot]])
    M       = cv2.getPerspectiveTransform(src, dst)
    refined = cv2.warpPerspective(warped, M, (W, H), flags=cv2.INTER_LANCZOS4)
    rgb2 = cv2.cvtColor(refined, cv2.COLOR_BGR2RGB).astype(np.float32)
    channel2 = np.clip(rgb2[:, :, 0] - rgb2[:, :, 2] + 128, 0, 255).astype(np.uint8)
    t2, b2, l2, r2 = _find_border_outer_edges(channel2, scale)
    log(f"  After refinement: top={t2}(exp={exp_top}), bot={b2}(exp={exp_bot}), "
        f"left={l2}(exp={exp_left}), right={r2}(exp={exp_right})")
    if debug and debug_dir and stem:
        save_debug(refined, debug_dir, stem, "warp_d_refined_color")
    return refined


def process_file(input_path, output_path, scale=8, thresh_val=180,
                 debug=False, debug_dir=None):
    stem = Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[warp] {input_path}", always=True)
    img = cv2.imread(str(input_path))
    if img is None:
        raise RuntimeError(f"Cannot read image: {input_path}")
    log(f"  Loaded {img.shape[1]}×{img.shape[0]} px")
    log("  a — Detecting screen corners")
    corners = find_screen_corners(img, thresh_val, debug, debug_dir, stem)
    log("  b — Initial perspective warp")
    warped = _initial_warp(img, corners, scale, debug, debug_dir, stem)
    log("  c — Refining alignment from inner border")
    warped = refine_warp(warped, scale, debug, debug_dir, stem)

    # ── Warmth pre-processing ─────────────────────────────────────────────────
    # The GBA SP front-light over-saturates the blue sub-pixel, shifting the
    # whole screen toward cyan/blue.  Applying a fixed-coefficient warmth
    # transform on the warped image before the correction step:
    #   • brings the filmstrip frame closer to target #FFFFA5 (warm yellow),
    #   • boosts the R channel, improving BK/DG/LG/WH separation,
    #   • reduces the B channel, moving toward the palette's warm colours.
    #
    # Coefficients are measured from a hand-warmed reference photo of a
    # real GBA SP screen in colour-palette mode (BGR convention):
    #   R_out = 1.073·R_in + 26.5,  G = 0.983·G_in − 2.9,  B = 0.925·B_in − 32.6
    # Applied at 75 % strength — calibrated to maximise accuracy across both
    # well-exposed and heavily blue-tinted shots.
    _WARMTH_STRENGTH = 0.75
    _W_MAT_FULL = np.array([           # full-strength (BGR rows)
        [0.925, 0.0,   0.0  ],         # B_out = 0.925·B_in
        [0.0,   0.983, 0.0  ],         # G_out = 0.983·G_in
        [0.0,   0.0,   1.073],         # R_out = 1.073·R_in
    ], dtype=np.float32)
    _W_OFF_FULL = np.array([-32.58, -2.92, 26.53], dtype=np.float32)
    _W_MAT = (np.eye(3, dtype=np.float32)
              + _WARMTH_STRENGTH * (_W_MAT_FULL - np.eye(3, dtype=np.float32)))
    _W_OFF = _W_OFF_FULL * _WARMTH_STRENGTH
    warped = np.clip(warped.astype(np.float32) @ _W_MAT.T + _W_OFF,
                     0, 255).astype(np.uint8)

    log(f"  d — Warmth ({_WARMTH_STRENGTH:.0%}): "
        f"R×{_W_MAT[2,2]:.3f}{_W_OFF[2]:+.1f}  "
        f"G×{_W_MAT[1,1]:.3f}{_W_OFF[1]:+.1f}  "
        f"B×{_W_MAT[0,0]:.3f}{_W_OFF[0]:+.1f}")

    cv2.imwrite(str(output_path), warped)
    log(f"  Saved -> {output_path}  (colour BGR, warmth-corrected)", always=True)


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
                        help="Working resolution multiplier: how many image pixels "
                             "represent each Game Boy pixel in the output. At the "
                             "default of 8 the output is 1280x1152 (160x8 by 144x8). "
                             "Must be kept consistent with all subsequent steps. "
                             "Default: 8.")
    parser.add_argument("--threshold", type=int, default=180, metavar="T",
                        help="Brightness threshold (0-255) for separating the screen "
                             "from the background before corner detection. Pixels "
                             "brighter than this are treated as screen. Lower this if "
                             "the screen is dim and not being detected; raise it if "
                             "bright background objects are being mistaken for the "
                             "screen. Default: 180.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save diagnostic images: "
                             "warp_a_corners (detected corners overlaid on the "
                             "photo), warp_b_initial_color and warp_c_initial_color "
                             "(result after the first perspective transform), "
                             "warp_d_refined_color (after snapping to the inner "
                             "border). All saved to <output-dir>/debug/.")
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
            process_file(f, out, args.scale, args.threshold, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
