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
    log, set_verbose, save_debug, collect_inputs, make_output_path, _rel,
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
    log(f"  Initial border validation:")
    _validate_inner_border(warped, scale, pass_num=0)
    log(f"  Initial frame edge verification:")
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

    Each corner is located using a localised profile in its own quadrant of the
    image (top-half vs bottom-half rows; left-half vs right-half columns).
    This captures per-corner residual perspective errors that a single averaged
    edge measurement misses -- for example when low contrast in one corner causes
    the border to sit noticeably off from what the global average would imply.

    All four sides still scan FROM the white-frame side for reliability.

    Returns (TL, TR, BR, BL) corner (x, y) float pairs.
    """
    H, W = channel.shape
    srch = 6 * scale

    # Horizontal midpoint of the camera area (in image pixels)
    mid_col = (INNER_LEFT + INNER_RIGHT) // 2 * scale   # ≈79*scale
    # Vertical midpoint of the camera area (in image pixels)
    mid_row = (INNER_TOP  + INNER_BOT)   // 2 * scale   # ≈71*scale

    # Localised column bands used when detecting the top / bottom edges
    # Use wider bands (10-150 instead of 20-140) for better sub-pixel detection
    c_lft = (max(0, 10 * scale),  mid_col)
    c_rgt = (mid_col,     min(W, 150 * scale))

    # Localised row bands used when detecting the left / right edges
    # Use wider bands (10-SCREEN_H-10 instead of 20-SCREEN_H-20) for better sub-pixel detection
    r_top = (max(0, 10 * scale),  mid_row)
    r_bot = (mid_row,     min(H, (SCREEN_H - 10) * scale))

    def _top_y(c0, c1):
        exp = INNER_TOP * scale
        r1, r2 = max(0, exp - srch), min(H, exp + srch)
        return r1 + _first_dark_from_frame(channel[int(r1):int(r2), c0:c1].mean(axis=1))

    def _bot_y(c0, c1):
        exp_frame = (INNER_BOT + 1) * scale
        r1, r2 = max(0, exp_frame - srch), min(H, exp_frame + srch)
        prof = channel[int(r1):int(r2), c0:c1].mean(axis=1)
        idx  = _first_dark_from_frame(prof[::-1])
        return int(r2 - 1) - idx - (scale - 1)

    def _left_x(r0, r1_):
        exp = INNER_LEFT * scale
        c1, c2 = max(0, exp - srch), min(W, exp + srch)
        return c1 + _first_dark_from_frame(channel[r0:r1_, int(c1):int(c2)].mean(axis=0))

    def _right_x(r0, r1_):
        exp_frame = (INNER_RIGHT + 1) * scale
        c1, c2 = max(0, exp_frame - srch), min(W, exp_frame + srch)
        prof = channel[r0:r1_, int(c1):int(c2)].mean(axis=0)
        idx  = _first_dark_from_frame(prof[::-1])
        return int(c2 - 1) - idx - (scale - 1)

    tl_y = _top_y(c_lft[0], c_lft[1]);  tr_y = _top_y(c_rgt[0], c_rgt[1])
    bl_y = _bot_y(c_lft[0], c_lft[1]);  br_y = _bot_y(c_rgt[0], c_rgt[1])
    tl_x = _left_x(r_top[0], r_top[1]); bl_x = _left_x(r_bot[0], r_bot[1])
    tr_x = _right_x(r_top[0], r_top[1]); br_x = _right_x(r_bot[0], r_bot[1])

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


def _validate_inner_border(warped, scale, pass_num=1):
    """
    Detailed validation of the inner border positioning and colors.
    
    Scans for the actual position of the inner #9494FF border and verifies:
    1. Border pixels are correctly colored (#9494FF = BGR 255,148,148)
    2. Outside pixels are correctly colored (#FFFFA5 = BGR 165,255,255)
    3. Border edges are straight on all four sides
    4. Corners are positioned correctly (16 pixels from edges)
    
    Returns a dict with detailed information about border accuracy.
    """
    H, W = warped.shape[:2]
    rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB).astype(np.float32)
    
    # Expected inner border positions (in image pixels)
    exp_left   = INNER_LEFT * scale      # Should be at column 120 (15*8)
    exp_right  = INNER_RIGHT * scale     # Should be at column 1152 (144*8)
    exp_top    = INNER_TOP * scale       # Should be at row 120 (15*8)
    exp_bottom = INNER_BOT * scale       # Should be at row 1024 (128*8)
    
    # Target colors
    blue_border = np.array([148, 148, 255], dtype=np.float32)  # #9494FF in RGB
    yellow_frame = np.array([255, 165, 165], dtype=np.float32)  # #FFFFA5 in RGB
    
    results = {
        'pass': pass_num,
        'corners': {},
        'edges': {},
        'color_checks': {},
        'straightness': {}
    }
    
    # Scan for actual border positions by looking for color transitions
    def find_edge_position(profile, is_dark_to_light=True):
        """Find where the color transition happens in a profile."""
        diffs = np.diff(profile)
        if is_dark_to_light:
            idx = np.argmax(diffs)  # Find biggest positive jump
        else:
            idx = np.argmin(diffs)  # Find biggest negative jump
        return float(idx)
    
    # Check each corner by sampling from expected positions
    margin = 4 * scale  # Search within ±4 pixels of expected position
    
    # Top-left corner
    sample_region_tl = rgb[int(exp_top-margin):int(exp_top+margin), 
                           int(exp_left-margin):int(exp_left+margin), :]
    if sample_region_tl.size > 0:
        # Find blue border within region
        blue_diff = np.linalg.norm(sample_region_tl - blue_border[np.newaxis, np.newaxis, :], axis=2)
        blue_pos = np.where(blue_diff < 30)  # Within threshold of blue
        if len(blue_pos[0]) > 0:
            tl_y = int(exp_top - margin + blue_pos[0].min())
            tl_x = int(exp_left - margin + blue_pos[1].min())
        else:
            tl_x, tl_y = exp_left, exp_top
    else:
        tl_x, tl_y = exp_left, exp_top
    
    # Top-right corner
    sample_region_tr = rgb[int(exp_top-margin):int(exp_top+margin), 
                           int(exp_right-margin):int(exp_right+margin), :]
    if sample_region_tr.size > 0:
        blue_diff = np.linalg.norm(sample_region_tr - blue_border[np.newaxis, np.newaxis, :], axis=2)
        blue_pos = np.where(blue_diff < 30)
        if len(blue_pos[0]) > 0:
            tr_y = int(exp_top - margin + blue_pos[0].min())
            tr_x = int(exp_right - margin + blue_pos[1].max())
        else:
            tr_x, tr_y = exp_right, exp_top
    else:
        tr_x, tr_y = exp_right, exp_top
    
    # Bottom-left corner
    sample_region_bl = rgb[int(exp_bottom-margin):int(exp_bottom+margin), 
                           int(exp_left-margin):int(exp_left+margin), :]
    if sample_region_bl.size > 0:
        blue_diff = np.linalg.norm(sample_region_bl - blue_border[np.newaxis, np.newaxis, :], axis=2)
        blue_pos = np.where(blue_diff < 30)
        if len(blue_pos[0]) > 0:
            bl_y = int(exp_bottom - margin + blue_pos[0].max())
            bl_x = int(exp_left - margin + blue_pos[1].min())
        else:
            bl_x, bl_y = exp_left, exp_bottom
    else:
        bl_x, bl_y = exp_left, exp_bottom
    
    # Bottom-right corner
    sample_region_br = rgb[int(exp_bottom-margin):int(exp_bottom+margin), 
                           int(exp_right-margin):int(exp_right+margin), :]
    if sample_region_br.size > 0:
        blue_diff = np.linalg.norm(sample_region_br - blue_border[np.newaxis, np.newaxis, :], axis=2)
        blue_pos = np.where(blue_diff < 30)
        if len(blue_pos[0]) > 0:
            br_y = int(exp_bottom - margin + blue_pos[0].max())
            br_x = int(exp_right - margin + blue_pos[1].max())
        else:
            br_x, br_y = exp_right, exp_bottom
    else:
        br_x, br_y = exp_right, exp_bottom
    
    # Record corner positions and errors
    results['corners'] = {
        'TL': {'detected': (tl_x, tl_y), 'expected': (exp_left, exp_top), 
               'error': (tl_x - exp_left, tl_y - exp_top)},
        'TR': {'detected': (tr_x, tr_y), 'expected': (exp_right, exp_top), 
               'error': (tr_x - exp_right, tr_y - exp_top)},
        'BL': {'detected': (bl_x, bl_y), 'expected': (exp_left, exp_bottom), 
               'error': (bl_x - exp_left, bl_y - exp_bottom)},
        'BR': {'detected': (br_x, br_y), 'expected': (exp_right, exp_bottom), 
               'error': (br_x - exp_right, br_y - exp_bottom)},
    }
    
    # Check that border edges are straight
    # Top edge: sample along the top border
    if exp_top >= 0 and exp_top < H:
        top_row = rgb[int(exp_top), :, :]
        top_blue_cols = np.where(np.linalg.norm(top_row - blue_border, axis=1) < 30)[0]
        if len(top_blue_cols) > 1:
            results['straightness']['top'] = {
                'range': (top_blue_cols.min(), top_blue_cols.max()),
                'variance': float(np.var(top_blue_cols))
            }
    
    # Bottom edge
    if exp_bottom >= 0 and exp_bottom < H:
        bot_row = rgb[int(exp_bottom), :, :]
        bot_blue_cols = np.where(np.linalg.norm(bot_row - blue_border, axis=1) < 30)[0]
        if len(bot_blue_cols) > 1:
            results['straightness']['bottom'] = {
                'range': (bot_blue_cols.min(), bot_blue_cols.max()),
                'variance': float(np.var(bot_blue_cols))
            }
    
    # Left edge
    if exp_left >= 0 and exp_left < W:
        left_col = rgb[:, int(exp_left), :]
        left_blue_rows = np.where(np.linalg.norm(left_col - blue_border, axis=1) < 30)[0]
        if len(left_blue_rows) > 1:
            results['straightness']['left'] = {
                'range': (left_blue_rows.min(), left_blue_rows.max()),
                'variance': float(np.var(left_blue_rows))
            }
    
    # Right edge
    if exp_right >= 0 and exp_right < W:
        right_col = rgb[:, int(exp_right), :]
        right_blue_rows = np.where(np.linalg.norm(right_col - blue_border, axis=1) < 30)[0]
        if len(right_blue_rows) > 1:
            results['straightness']['right'] = {
                'range': (right_blue_rows.min(), right_blue_rows.max()),
                'variance': float(np.var(right_blue_rows))
            }
    
    # Log the detailed results
    log(f"  Pass {pass_num} inner border validation:")
    for corner_name in ['TL', 'TR', 'BL', 'BR']:
        corner_data = results['corners'][corner_name]
        dx, dy = corner_data['error']
        exp_x, exp_y = corner_data['expected']
        det_x, det_y = corner_data['detected']
        log(f"    {corner_name}: expected=({exp_x},{exp_y}) detected=({det_x},{det_y}) "
            f"error=({dx:+.1f},{dy:+.1f}) pixels")
    
    for edge_name in ['top', 'bottom', 'left', 'right']:
        if edge_name in results['straightness']:
            edge_data = results['straightness'][edge_name]
            log(f"    {edge_name} edge straight: {edge_data}")
    
    return results


# ---------------------------------------------------------------------------
# Back-projection refinement
# ---------------------------------------------------------------------------

def _find_border_points(channel, scale):
    """
    Detect the inner border not just at the four corners, but at multiple points
    along each edge. This allows detection of edge curvature/lens distortion.
    
    Returns a dict with:
      'top': list of (x, y) points along top edge
      'right': list of (x, y) points along right edge  
      'bottom': list of (x, y) points along bottom edge
      'left': list of (x, y) points along left edge
    """
    H, W = channel.shape
    srch = 6 * scale
    
    points = {
        'top': [],
        'right': [],
        'bottom': [],
        'left': []
    }
    
    exp_left   = INNER_LEFT * scale
    exp_right  = INNER_RIGHT * scale
    exp_top    = INNER_TOP * scale
    exp_bottom = INNER_BOT * scale
    
    # Sample top edge at 9 points along the width
    for col_frac in np.linspace(0.0, 1.0, 9):
        col = int(exp_left + (exp_right - exp_left) * col_frac)
        col = np.clip(col, 0, W - 1)
        r1, r2 = max(0, int(exp_top - srch)), min(H, int(exp_top + srch))
        if r1 < r2:
            profile = channel[int(r1):int(r2), col].astype(float)
            y_pos = r1 + _first_dark_from_frame(profile)
            points['top'].append((float(col), y_pos))
    
    # Sample bottom edge
    for col_frac in np.linspace(0.0, 1.0, 9):
        col = int(exp_left + (exp_right - exp_left) * col_frac)
        col = np.clip(col, 0, W - 1)
        r1, r2 = max(0, int(exp_bottom - srch)), min(H, int(exp_bottom + srch))
        if r1 < r2:
            prof = channel[int(r1):int(r2), col].astype(float)
            idx = _first_dark_from_frame(prof[::-1])
            y_pos = int(r2 - 1) - idx - (scale - 1)
            points['bottom'].append((float(col), y_pos))
    
    # Sample left edge at 9 points along the height
    for row_frac in np.linspace(0.0, 1.0, 9):
        row = int(exp_top + (exp_bottom - exp_top) * row_frac)
        row = np.clip(row, 0, H - 1)
        c1, c2 = max(0, int(exp_left - srch)), min(W, int(exp_left + srch))
        if c1 < c2:
            profile = channel[row, int(c1):int(c2)].astype(float)
            x_pos = c1 + _first_dark_from_frame(profile)
            points['left'].append((x_pos, float(row)))
    
    # Sample right edge
    for row_frac in np.linspace(0.0, 1.0, 9):
        row = int(exp_top + (exp_bottom - exp_top) * row_frac)
        row = np.clip(row, 0, H - 1)
        c1, c2 = max(0, int(exp_right - srch)), min(W, int(exp_right + srch))
        if c1 < c2:
            prof = channel[row, int(c1):int(c2)].astype(float)
            idx = _first_dark_from_frame(prof[::-1])
            x_pos = int(c2 - 1) - idx - (scale - 1)
            points['right'].append((x_pos, float(row)))
    
    return points


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

    # Get multi-point border detection (for edge curvature analysis)
    border_points = _find_border_points(rb_ch, scale)
    
    # Get corner detection  
    TL, TR, BR, BL = _find_border_corners(rb_ch, scale)

    exp_TL = (float(INNER_LEFT  * scale), float(INNER_TOP * scale))
    exp_TR = (float(INNER_RIGHT * scale), float(INNER_TOP * scale))
    exp_BR = (float(INNER_RIGHT * scale), float(INNER_BOT * scale))
    exp_BL = (float(INNER_LEFT  * scale), float(INNER_BOT * scale))
    
    # Expected edge positions
    exp_top = INNER_TOP * scale
    exp_bottom = INNER_BOT * scale
    exp_left = INNER_LEFT * scale
    exp_right = INNER_RIGHT * scale

    # Averaged edges for logging (compatible with previous log format)
    top   = (TL[1] + TR[1]) / 2;  bot   = (BL[1] + BR[1]) / 2
    left  = (TL[0] + BL[0]) / 2;  right = (TR[0] + BR[0]) / 2
    exp_top_avg = exp_TL[1]
    exp_bottom_avg = exp_BL[1]
    exp_left_avg = exp_TL[0]
    exp_right_avg = exp_TR[0]
    
    # Analyze edge curvature from the multipoint detection
    # If edges are bowing outward, we need to correct for that in the source
    edge_curvatures = {
        'top': np.mean([y - exp_top for x, y in border_points['top']]) if border_points['top'] else 0,
        'bottom': np.mean([y - exp_bottom for x, y in border_points['bottom']]) if border_points['bottom'] else 0,
        'left': np.mean([x - exp_left for x, y in border_points['left']]) if border_points['left'] else 0,
        'right': np.mean([x - exp_right for x, y in border_points['right']]) if border_points['right'] else 0,
    }
    
    # If the middle of an edge is significantly offset from expected, it indicates lens distortion
    # Adjust the corner positions proportionally to compensate
    adjusted_TL = list(TL)
    adjusted_TR = list(TR)
    adjusted_BR = list(BR)
    adjusted_BL = list(BL)
    
    # Scale factor for edge curvature compensation
    # Higher values (closer to 1.0) give stronger correction
    corr_scale = 0.45
    
    # Adjust top corners if top edge is bowed
    if abs(edge_curvatures['top']) > 0.5:
        # Top edge is bowed - shift top corners inward/outward to compensate
        adjusted_TL[1] -= edge_curvatures['top'] * corr_scale
        adjusted_TR[1] -= edge_curvatures['top'] * corr_scale
    
    # Adjust bottom corners if bottom edge is bowed
    if abs(edge_curvatures['bottom']) > 0.5:
        adjusted_BL[1] -= edge_curvatures['bottom'] * corr_scale
        adjusted_BR[1] -= edge_curvatures['bottom'] * corr_scale
    
    # Adjust left corners if left edge is bowed
    if abs(edge_curvatures['left']) > 0.5:
        adjusted_TL[0] -= edge_curvatures['left'] * corr_scale
        adjusted_BL[0] -= edge_curvatures['left'] * corr_scale
    
    # Adjust right corners if right edge is bowed (this is the primary issue)
    if abs(edge_curvatures['right']) > 0.5:
        adjusted_TR[0] -= edge_curvatures['right'] * corr_scale
        adjusted_BR[0] -= edge_curvatures['right'] * corr_scale
    
    # Use adjusted corners for refinement
    TL = tuple(adjusted_TL)
    TR = tuple(adjusted_TR)
    BR = tuple(adjusted_BR)
    BL = tuple(adjusted_BL)
    
    log(f"  Pass {pass_num} edge curvatures: "
        f"top={edge_curvatures['top']:+.2f}, bot={edge_curvatures['bottom']:+.2f}, "
        f"left={edge_curvatures['left']:+.2f}, right={edge_curvatures['right']:+.2f}")
    log(f"  Pass {pass_num} corners: "
        f"TL=({TL[0]:.1f},{TL[1]:.1f}) err=({TL[0]-exp_TL[0]:+.1f},{TL[1]-exp_TL[1]:+.1f})  "
        f"TR=({TR[0]:.1f},{TR[1]:.1f}) err=({TR[0]-exp_TR[0]:+.1f},{TR[1]-exp_TR[1]:+.1f})  "
        f"BR=({BR[0]:.1f},{BR[1]:.1f}) err=({BR[0]-exp_BR[0]:+.1f},{BR[1]-exp_BR[1]:+.1f})  "
        f"BL=({BL[0]:.1f},{BL[1]:.1f}) err=({BL[0]-exp_BL[0]:+.1f},{BL[1]-exp_BL[1]:+.1f})")
    log(f"  Pass {pass_num} border edges (avg): "
        f"top={top:.2f}(exp={exp_top_avg:.0f},err={top-exp_top_avg:+.2f}), "
        f"bot={bot:.2f}(exp={exp_bottom_avg:.0f},err={bot-exp_bottom_avg:+.2f}), "
        f"left={left:.2f}(exp={exp_left_avg:.0f},err={left-exp_left_avg:+.2f}), "
        f"right={right:.2f}(exp={exp_right_avg:.0f},err={right-exp_right_avg:+.2f})")

    # Try refinement even for large errors - it will fail gracefully if homography is degenerate
    try:
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
    except Exception as e:
        log(f"  Pass {pass_num} refinement failed ({type(e).__name__}), using current warp")
        M_new = current_M
        refined = warped

    # Detailed border validation
    border_validation = _validate_inner_border(refined, scale, pass_num)
    
    # Also run frame edge verification
    log(f"  Pass {pass_num} frame edge verification:")
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
    log(f"[warp] {_rel(input_path)}", always=True)

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
    log(f"  Saved -> {_rel(output_path)}  (colour BGR)", always=True)


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
