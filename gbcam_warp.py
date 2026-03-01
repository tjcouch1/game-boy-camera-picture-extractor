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


def find_screen_corners(img, thresh_val=180, debug=False, debug_dir=None, stem=None):
    """Locate the four corners of the white GB screen frame."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
    kernel = np.ones((7, 7), np.uint8)
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise RuntimeError("No bright contour found — try adjusting --threshold")

    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    largest  = contours[0]
    x, y, w, h = cv2.boundingRect(largest)
    aspect   = w / h if h else 0
    expected = SCREEN_W / SCREEN_H
    log(f"  Contour: area={cv2.contourArea(largest):.0f}  "
        f"bbox=({x},{y},{w}×{h})  aspect={aspect:.3f} (expected≈{expected:.3f})")
    if not (0.85 < aspect / expected < 1.15):
        log("  WARNING: aspect ratio mismatch — detection may be unreliable")

    hull  = cv2.convexHull(largest)
    peri  = cv2.arcLength(hull, True)
    corners = None
    for eps in [0.02, 0.03, 0.05, 0.01, 0.10]:
        approx = cv2.approxPolyDP(hull, eps * peri, True).reshape(-1, 2)
        if len(approx) == 4:
            corners = approx
            break
    if corners is None or len(corners) != 4:
        log("  WARNING: could not fit 4-corner quad; using bounding box")
        corners = np.array([[x, y], [x+w, y], [x+w, y+h], [x, y+h]])

    ordered = _order_corners(corners.astype(float))
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
    log(f"  Initial warp → {W}×{H}  (scale={scale})")
    if debug and debug_dir and stem:
        save_debug(warped, debug_dir, stem, "warp_b_initial_color")
        save_debug(cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY),
                   debug_dir, stem, "warp_c_initial_gray")
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
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY) if warped.ndim == 3 else warped
    top, bot, left, right = _find_border_outer_edges(gray, scale)
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
    gray2 = cv2.cvtColor(refined, cv2.COLOR_BGR2GRAY) if refined.ndim == 3 else refined
    t2, b2, l2, r2 = _find_border_outer_edges(gray2, scale)
    log(f"  After refinement: top={t2}(exp={exp_top}), bot={b2}(exp={exp_bot}), "
        f"left={l2}(exp={exp_left}), right={r2}(exp={exp_right})")
    if debug and debug_dir and stem:
        save_debug(refined if refined.ndim == 3 else
                   cv2.cvtColor(refined, cv2.COLOR_GRAY2BGR),
                   debug_dir, stem, "warp_d_refined_color")
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
    gray   = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    cv2.imwrite(str(output_path), gray)
    log(f"  Saved → {output_path}", always=True)
    if debug and debug_dir and stem:
        save_debug(gray, debug_dir, stem, "warp_e_final_gray")


def main():
    parser = argparse.ArgumentParser(
        description="Warp step: perspective-correct a GBA SP phone photo",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("inputs", nargs="*", help="Input photo files")
    parser.add_argument("--dir", "-d", help="Directory of input photos")
    parser.add_argument("--output-dir", "-o", help="Output directory")
    parser.add_argument("--scale",     type=int, default=8)
    parser.add_argument("--threshold", type=int, default=180)
    parser.add_argument("--debug",     action="store_true")
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
