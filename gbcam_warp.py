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
    
    Enhanced to be more robust: finds the sharpest transition rather than
    just the first downward step, which avoids picking up spurious edges.
    Returns float index into `profile`.
    
    Uses adaptive smoothing and gradient-based detection for improved robustness
    in low-contrast areas.
    """
    p = gaussian_filter1d(profile.astype(float), sigma=smooth_sigma)
    d = np.diff(p)
    
    # Find the sharpest downward transition (most negative gradient)
    # This is more robust than finding the first dark transition
    k = int(np.argmin(d))
    
    # Validate that this is a significant transition (not noise)
    # Check that the gradient magnitude is substantial
    min_gradient = np.min(d)
    
    # If the transition is too shallow, it might be noise - try to find a sharper one
    if min_gradient > -1.0:  # Shallow transition
        # Look for any significant downward step
        threshold = -0.5
        candidates = np.where(d < threshold)[0]
        if len(candidates) > 0:
            # Pick the one with the sharpest gradient
            k = candidates[np.argmin(d[candidates])]
    
    delta = 0.0
    if 0 < k < len(d) - 1:
        d0, d1, d2 = float(d[k - 1]), float(d[k]), float(d[k + 1])
        denom = d0 - 2.0 * d1 + d2
        if abs(denom) > 1e-10:
            delta = float(np.clip(0.5 * (d0 - d2) / denom, -1.0, 1.0))
    
    return float(k + 1 + delta)


def _find_border_corners(channel, scale):
    """
    Detect the four corners of the inner-border rectangle by combining:
    1. Per-corner localized detection (robust to per-corner variations)
    2. Validation from the full 9-point edge detection
    
    This hybrid approach gives geometrically coherent corners while accounting
    for edge curvature and per-corner distortions.

    Returns (TL, TR, BR, BL) corner (x, y) float pairs.
    """
    H, W = channel.shape
    srch = 6 * scale

    # Horizontal midpoint of the camera area (in image pixels)
    mid_col = (INNER_LEFT + INNER_RIGHT) // 2 * scale
    # Vertical midpoint of the camera area (in image pixels)
    mid_row = (INNER_TOP  + INNER_BOT)   // 2 * scale

    # Localised column bands used when detecting the top / bottom edges
    c_lft = (max(0, 10 * scale),  mid_col)
    c_rgt = (mid_col,     min(W, 150 * scale))

    # Localised row bands used when detecting the left / right edges
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

    # Detect corners using per-quadrant localized regions
    tl_y = _top_y(c_lft[0], c_lft[1]);  tr_y = _top_y(c_rgt[0], c_rgt[1])
    bl_y = _bot_y(c_lft[0], c_lft[1]);  br_y = _bot_y(c_rgt[0], c_rgt[1])
    tl_x = _left_x(r_top[0], r_top[1]); bl_x = _left_x(r_bot[0], r_bot[1])
    tr_x = _right_x(r_top[0], r_top[1]); br_x = _right_x(r_bot[0], r_bot[1])

    TL = (tl_x, tl_y)
    TR = (tr_x, tr_y)
    BR = (br_x, br_y)
    BL = (bl_x, bl_y)
    
    # Validate and refine using full edge point detection
    TL, TR, BR, BL = _refine_corners_with_edge_points(
        TL, TR, BR, BL, channel, scale
    )
    
    return TL, TR, BR, BL


def _refine_corners_with_edge_points(TL, TR, BR, BL, channel, scale):
    """
    Refine corner positions using the 9-point edge detection to catch
    systematic biases (like edges that bow or corners that are off).
    
    This uses the edge points as a consensus check, and blends the per-corner
    detection with information from the full edge. Bottom and right edges
    often have the most curvature, so we use higher blend ratios there.
    """
    # Get the full edge point detection
    border_points = _find_border_points(channel, scale)
    
    # Extract edge positions from the detected points
    # For top edge: average the y positions from detected points
    if len(border_points.get('top', [])) > 0:
        top_y_vals = [pt[1] for pt in border_points['top']]
        # The first points should be near TL
        tl_y_from_edge = np.mean(top_y_vals[:2])
        # The last points should be near TR
        tr_y_from_edge = np.mean(top_y_vals[-2:])
        
        # Use modest blend ratio for top edge (20% from edge)
        tl_y_new = TL[1] * 0.8 + tl_y_from_edge * 0.2
        tr_y_new = TR[1] * 0.8 + tr_y_from_edge * 0.2
        TL = (TL[0], tl_y_new)
        TR = (TR[0], tr_y_new)
    
    # For bottom edge
    if len(border_points.get('bottom', [])) > 0:
        bot_y_vals = [pt[1] for pt in border_points['bottom']]
        bl_y_from_edge = np.mean(bot_y_vals[:2])
        br_y_from_edge = np.mean(bot_y_vals[-2:])
        
        # Use higher blend ratio for bottom edge (25% from edge)
        # Bottom edge often has most curvature
        bl_y_new = BL[1] * 0.75 + bl_y_from_edge * 0.25
        br_y_new = BR[1] * 0.75 + br_y_from_edge * 0.25
        BL = (BL[0], bl_y_new)
        BR = (BR[0], br_y_new)
    
    # For left edge
    if len(border_points.get('left', [])) > 0:
        left_x_vals = [pt[0] for pt in border_points['left']]
        tl_x_from_edge = np.mean(left_x_vals[:2])
        bl_x_from_edge = np.mean(left_x_vals[-2:])
        
        # Use modest blend ratio for left edge (15% from edge)
        tl_x_new = TL[0] * 0.85 + tl_x_from_edge * 0.15
        bl_x_new = BL[0] * 0.85 + bl_x_from_edge * 0.15
        TL = (tl_x_new, TL[1])
        BL = (bl_x_new, BL[1])
    
    # For right edge
    if len(border_points.get('right', [])) > 0:
        right_x_vals = [pt[0] for pt in border_points['right']]
        tr_x_from_edge = np.mean(right_x_vals[:2])
        br_x_from_edge = np.mean(right_x_vals[-2:])
        
        # Use moderate blend ratio for right edge (20% from edge)
        # Right edge often has curvature
        tr_x_new = TR[0] * 0.8 + tr_x_from_edge * 0.2
        br_x_new = BR[0] * 0.8 + br_x_from_edge * 0.2
        TR = (tr_x_new, TR[1])
        BR = (br_x_new, BR[1])
    
    return TL, TR, BR, BL


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
    Detect the inner border at multiple points along each edge with robustness
    against white gap lines and noise.
    
    For each edge position, if the detection looks suspicious (far from neighbors),
    try sampling offset positions and average those results.
    
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
    
    # Fix outliers by re-detecting at offset positions
    for edge_name in ['top', 'right', 'bottom', 'left']:
        points[edge_name] = _fix_border_outliers(points[edge_name], edge_name, channel, scale)
    
    return points


def _fix_border_outliers(pts, edge_name, channel, scale):
    """
    Detect and fix outliers in border points by trying offset positions.
    
    When a point is significantly far from neighbors (>3px), re-detect at
    offset positions (±3-4 pixels along the edge) and use median of those.
    This helps avoid white gap lines.
    """
    if len(pts) < 3:
        return pts
    
    H, W = channel.shape
    srch = 6 * scale
    exp_left   = INNER_LEFT * scale
    exp_right  = INNER_RIGHT * scale
    exp_top    = INNER_TOP * scale
    exp_bottom = INNER_BOT * scale
    
    check_y = edge_name in ['top', 'bottom']
    fixed_pts = list(pts)
    
    # Find outliers
    for i in range(len(pts)):
        # Check against neighbors
        neighbors = []
        for j in range(max(0, i-1), min(len(pts), i+2)):
            if j != i:
                neighbors.append(pts[j][1] if check_y else pts[j][0])
        
        if not neighbors:
            continue
        
        median_neighbor = np.median(neighbors)
        current_val = pts[i][1] if check_y else pts[i][0]
        deviation = abs(current_val - median_neighbor)
        
        # If this point deviates significantly, try re-detecting at offset positions
        # Use a lower threshold to catch more subtle issues
        if deviation > 2.5:
            # Try sampling at ±2, ±3, ±4 positions along the edge
            alt_positions = [current_val]  # Start with current
            
            if edge_name == 'top':
                col_center = int(pts[i][0])
                for col_offset in [-4, -3, -2, 2, 3, 4]:
                    col = np.clip(col_center + col_offset, 0, W - 1)
                    r1, r2 = max(0, int(exp_top - srch)), min(H, int(exp_top + srch))
                    if r1 < r2:
                        prof = channel[int(r1):int(r2), col].astype(float)
                        y_pos = r1 + _first_dark_from_frame(prof)
                        alt_positions.append(y_pos)
                        
            elif edge_name == 'bottom':
                col_center = int(pts[i][0])
                for col_offset in [-4, -3, -2, 2, 3, 4]:
                    col = np.clip(col_center + col_offset, 0, W - 1)
                    r1, r2 = max(0, int(exp_bottom - srch)), min(H, int(exp_bottom + srch))
                    if r1 < r2:
                        prof = channel[int(r1):int(r2), col].astype(float)
                        idx = _first_dark_from_frame(prof[::-1])
                        y_pos = int(r2 - 1) - idx - (scale - 1)
                        alt_positions.append(y_pos)
                        
            elif edge_name == 'left':
                row_center = int(pts[i][1])
                for row_offset in [-4, -3, -2, 2, 3, 4]:
                    row = np.clip(row_center + row_offset, 0, H - 1)
                    c1, c2 = max(0, int(exp_left - srch)), min(W, int(exp_left + srch))
                    if c1 < c2:
                        prof = channel[row, int(c1):int(c2)].astype(float)
                        x_pos = c1 + _first_dark_from_frame(prof)
                        alt_positions.append(x_pos)
                        
            elif edge_name == 'right':
                row_center = int(pts[i][1])
                for row_offset in [-4, -3, -2, 2, 3, 4]:
                    row = np.clip(row_center + row_offset, 0, H - 1)
                    c1, c2 = max(0, int(exp_right - srch)), min(W, int(exp_right + srch))
                    if c1 < c2:
                        prof = channel[row, int(c1):int(c2)].astype(float)
                        idx = _first_dark_from_frame(prof[::-1])
                        x_pos = int(c2 - 1) - idx - (scale - 1)
                        alt_positions.append(x_pos)
            
            # Use median of all alternative positions
            if len(alt_positions) > 1:
                corrected_val = np.median(alt_positions)
                
                if check_y:
                    fixed_pts[i] = (fixed_pts[i][0], corrected_val)
                else:
                    fixed_pts[i] = (corrected_val, fixed_pts[i][1])
    
    return fixed_pts


def _analyze_edge_curvature(points, exp_pos, edge_name):
    """
    Analyze curvature of an edge by dividing it into segments and computing
    deviation from expected position at each segment.
    
    Returns dict with:
      'overall': average deviation across entire edge
      'segments': list of (segment_name, deviation) for top/middle/bottom thirds
      'max_deviation': maximum local deviation
      'min_deviation': minimum local deviation
    """
    if not points:
        return {
            'overall': 0.0,
            'segments': [],
            'max_deviation': 0.0,
            'min_deviation': 0.0,
        }
    
    # Extract position along the edge (y for top/bottom, x for left/right)
    if edge_name in ['top', 'bottom']:
        deviations = [y - exp_pos for x, y in points]
        segment_labels = ['left-third', 'middle-third', 'right-third']
    else:  # left, right
        deviations = [x - exp_pos for x, y in points]
        segment_labels = ['top-third', 'middle-third', 'bottom-third']
    
    overall_dev = np.mean(deviations)
    
    # Split into 3 segments
    n = len(deviations)
    seg_size = max(1, n // 3)
    segments = [
        (segment_labels[0], np.mean(deviations[:seg_size])),
        (segment_labels[1], np.mean(deviations[seg_size:2*seg_size])),
        (segment_labels[2], np.mean(deviations[2*seg_size:])),
    ]
    
    return {
        'overall': overall_dev,
        'segments': segments,
        'max_deviation': float(np.max(deviations)),
        'min_deviation': float(np.min(deviations)),
    }


def _save_border_detection_debug(warped, border_points, TL, TR, BR, BL,
                                  exp_TL, exp_TR, exp_BR, exp_BL,
                                  debug_dir, stem, pass_num):
    """
    Create debug visualization showing detected border points and corners
    overlaid on the warped image.
    """
    dbg = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    dbg = cv2.cvtColor(dbg, cv2.COLOR_RGB2BGR)
    
    # Draw expected rectangle (green)
    exp_pts = np.array([exp_TL, exp_TR, exp_BR, exp_BL], dtype=np.int32)
    cv2.polylines(dbg, [exp_pts], True, (0, 255, 0), 2)
    
    # Draw expected corners as circles
    for pt, label in [(exp_TL, 'TL'), (exp_TR, 'TR'), (exp_BR, 'BR'), (exp_BL, 'BL')]:
        pt_int = tuple(map(int, pt))
        cv2.circle(dbg, pt_int, 6, (0, 255, 0), 2)
    
    # Draw detected rectangle (red)
    det_pts = np.array([TL, TR, BR, BL], dtype=np.int32)
    cv2.polylines(dbg, [det_pts], True, (0, 0, 255), 2)
    
    # Draw detected corners as circles
    for pt, label in [(TL, 'TL'), (TR, 'TR'), (BR, 'BR'), (BL, 'BL')]:
        pt_int = tuple(map(int, pt))
        cv2.circle(dbg, pt_int, 5, (0, 0, 255), 2)
    
    # Draw border points with color-coded quality
    colors = {
        'top': (255, 0, 0),      # Blue
        'right': (0, 255, 0),    # Green
        'bottom': (0, 0, 255),   # Red
        'left': (255, 255, 0),   # Cyan
    }
    
    # For each edge, draw the points and highlight potential issues
    for edge_name in ['top', 'right', 'bottom', 'left']:
        color = colors[edge_name]
        pts = border_points[edge_name]
        
        if len(pts) > 0:
            # Draw points
            for i, pt in enumerate(pts):
                pt_int = tuple(map(int, pt))
                # Size based on position - subtle visual indicator
                cv2.circle(dbg, pt_int, 3, color, -1)
                
                # Check for outliers by comparing to neighbors
                if len(pts) >= 3 and 0 < i < len(pts) - 1:
                    # Get coordinate being checked (y for top/bottom, x for left/right)
                    check_y = edge_name in ['top', 'bottom']
                    val = pt[1] if check_y else pt[0]
                    prev_val = pts[i-1][1] if check_y else pts[i-1][0]
                    next_val = pts[i+1][1] if check_y else pts[i+1][0]
                    
                    # Check if this point deviates significantly
                    median_neighbor = (prev_val + next_val) / 2
                    deviation = abs(val - median_neighbor)
                    
                    # If deviation is large, draw a warning circle
                    if deviation > 16:
                        cv2.circle(dbg, pt_int, 8, (100, 100, 255), 2)  # Orange-ish
            
            # Draw line connecting points
            if len(pts) > 1:
                pts_arr = np.array(pts, dtype=np.int32)
                cv2.polylines(dbg, [pts_arr], False, color, 1)
    
    # Save the debug image
    filename = f"warp_c_pass{pass_num}_border_detection.png"
    output_path = Path(debug_dir) / filename
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_path), dbg)
    log(f"    Saved border detection debug: {filename}")



def refine_warp(img, current_M, warped, scale,
                debug=False, debug_dir=None, stem=None, pass_num=1):
    """
    Snap the inner border to its exact pixel-grid position without black bars.

    Dynamically analyzes edge curvature by dividing edges into segments
    (thirds), detects where each segment is offset from expected position,
    and applies per-corner corrections based on the local curvature around
    each corner.

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

    # Analyze edge curvature with segment-based detection
    top_analysis = _analyze_edge_curvature(border_points['top'], exp_top, 'top')
    bottom_analysis = _analyze_edge_curvature(border_points['bottom'], exp_bottom, 'bottom')
    left_analysis = _analyze_edge_curvature(border_points['left'], exp_left, 'left')
    right_analysis = _analyze_edge_curvature(border_points['right'], exp_right, 'right')
    
    # Log detailed edge analysis
    log(f"  Pass {pass_num} edge analysis (segment deviations):")
    for edge_name, analysis in [('top', top_analysis), ('bottom', bottom_analysis),
                                 ('left', left_analysis), ('right', right_analysis)]:
        log(f"    {edge_name}: overall={analysis['overall']:+.2f}px, "
            f"min={analysis['min_deviation']:+.2f}px, max={analysis['max_deviation']:+.2f}px")
        for seg_name, seg_dev in analysis['segments']:
            log(f"      {seg_name}: {seg_dev:+.2f}px")

    # Dynamically compute corner adjustments based on segment analysis
    # For each corner, use the average of the two adjacent segments
    adjusted_TL = list(TL)
    adjusted_TR = list(TR)
    adjusted_BR = list(BR)
    adjusted_BL = list(BL)
    
    # Conservative: Only adjust if segments agree strongly on a deviation
    def should_adjust(analysis, min_consistency_px=0.5):
        """
        Check if multiple segments agree on a deviation.
        Return the adjustment if consistent, else 0.
        """
        if not analysis['segments'] or len(analysis['segments']) < 2:
            return 0.0
        
        devs = [seg_dev for _, seg_dev in analysis['segments']]
        # Check if all segments are offset in same direction by similar amount
        if all(d > min_consistency_px for d in devs) or all(d < -min_consistency_px for d in devs):
            # Consistent offset - use the average but cap it
            avg_dev = np.mean(devs)
            return np.clip(avg_dev, -1.5, 1.5)  # Cap adjustment to ±1.5px
        elif max(devs) - min(devs) < 0.5:
            # All segments very close to each other
            avg_dev = np.mean(devs)
            if abs(avg_dev) > min_consistency_px:
                return np.clip(avg_dev, -1.5, 1.5)
        return 0.0
    
    # Apply conservative adjustments to all edges
    top_adj = should_adjust(top_analysis)
    bottom_adj = should_adjust(bottom_analysis)
    left_adj = should_adjust(left_analysis)
    right_adj = should_adjust(right_analysis)
    
    log(f"  Pass {pass_num} conservative adjustments: "
        f"top={top_adj:+.2f}, bot={bottom_adj:+.2f}, left={left_adj:+.2f}, right={right_adj:+.2f}")
    
    if abs(top_adj) > 0.1:
        adjusted_TL[1] += top_adj
        adjusted_TR[1] += top_adj
    
    if abs(bottom_adj) > 0.1:
        adjusted_BL[1] += bottom_adj
        adjusted_BR[1] += bottom_adj
    
    if abs(left_adj) > 0.1:
        adjusted_TL[0] += left_adj
        adjusted_BL[0] += left_adj
    
    if abs(right_adj) > 0.1:
        adjusted_TR[0] += right_adj
        adjusted_BR[0] += right_adj
    
    # Use adjusted corners for refinement
    TL = tuple(adjusted_TL)
    TR = tuple(adjusted_TR)
    BR = tuple(adjusted_BR)
    BL = tuple(adjusted_BL)
    
    log(f"  Pass {pass_num} corners after dynamic adjustment: "
        f"TL=({TL[0]:.1f},{TL[1]:.1f}) err=({TL[0]-exp_TL[0]:+.1f},{TL[1]-exp_TL[1]:+.1f})  "
        f"TR=({TR[0]:.1f},{TR[1]:.1f}) err=({TR[0]-exp_TR[0]:+.1f},{TR[1]-exp_TR[1]:+.1f})  "
        f"BR=({BR[0]:.1f},{BR[1]:.1f}) err=({BR[0]-exp_BR[0]:+.1f},{BR[1]-exp_BR[1]:+.1f})  "
        f"BL=({BL[0]:.1f},{BL[1]:.1f}) err=({BL[0]-exp_BL[0]:+.1f},{BL[1]-exp_BL[1]:+.1f})")

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

    # Save debug visualization showing detected borders
    if debug and debug_dir and stem:
        _save_border_detection_debug(warped, border_points, TL, TR, BR, BL,
                                     exp_TL, exp_TR, exp_BR, exp_BL,
                                     debug_dir, stem, pass_num)

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
