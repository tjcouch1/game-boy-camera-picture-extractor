#!/usr/bin/env python3
"""
Detect actual border positions in warp output and see how far they are from expected.
"""

import os
import sys
import cv2
import numpy as np
from pathlib import Path
from scipy.ndimage import gaussian_filter1d

def _first_dark_from_frame(profile, smooth_sigma=1.5):
    """Sub-pixel index of the first dark pixel scanning FROM the white frame."""
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

def detect_borders(warp_img, scale=8):
    """
    Detect the borders using the same method as gbcam_warp.py
    Returns (tl_y, tr_y, br_y, bl_y, tl_x, bl_x, tr_x, br_x)
    """
    H, W = warp_img.shape[:2]
    
    # Expected frame inner border positions (in GB pixels)
    INNER_TOP, INNER_BOT = 16, 128
    INNER_LEFT, INNER_RIGHT = 16, 143
    
    # Convert to image pixels
    exp_top = INNER_TOP * scale
    exp_bot = (INNER_BOT + 1) * scale
    exp_left = INNER_LEFT * scale
    exp_right = (INNER_RIGHT + 1) * scale
    
    srch = 6 * scale  # 48
    
    # Extract R and B channels
    if len(warp_img.shape) == 3:
        b = warp_img[:, :, 0].astype(np.float32)
        g = warp_img[:, :, 1].astype(np.float32)
        r = warp_img[:, :, 2].astype(np.float32)
        channel = (r - b)  # High for white frame, low for blue border
    else:
        channel = warp_img.astype(np.float32)
    
    # Define bands
    mid_col = (INNER_LEFT + INNER_RIGHT) // 2 * scale
    mid_row = (INNER_TOP + INNER_BOT) // 2 * scale
    
    c_lft = (max(0, 10 * scale), mid_col)
    c_rgt = (mid_col, min(W, 150 * scale))
    r_top = (max(0, 10 * scale), mid_row)
    r_bot = (mid_row, min(H, (144 - 10) * scale))
    
    # Detect borders
    def _top_y(c0, c1):
        exp = INNER_TOP * scale
        r1, r2 = max(0, exp - srch), min(H, exp + srch)
        return r1 + _first_dark_from_frame(channel[int(r1):int(r2), c0:c1].mean(axis=1))
    
    def _bot_y(c0, c1):
        exp_frame = (INNER_BOT + 1) * scale
        r1, r2 = max(0, exp_frame - srch), min(H, exp_frame + srch)
        prof = channel[int(r1):int(r2), c0:c1].mean(axis=1)
        idx = _first_dark_from_frame(prof[::-1])
        return int(r2 - 1) - idx - (scale - 1)
    
    def _left_x(r0, r1_):
        exp = INNER_LEFT * scale
        c1, c2 = max(0, exp - srch), min(W, exp + srch)
        return c1 + _first_dark_from_frame(channel[r0:r1_, int(c1):int(c2)].mean(axis=0))
    
    def _right_x(r0, r1_):
        exp_frame = (INNER_RIGHT + 1) * scale
        c1, c2 = max(0, exp_frame - srch), min(W, exp_frame + srch)
        prof = channel[r0:r1_, int(c1):int(c2)].mean(axis=0)
        idx = _first_dark_from_frame(prof[::-1])
        return int(c2 - 1) - idx - (scale - 1)
    
    tl_y = _top_y(c_lft[0], c_lft[1])
    tr_y = _top_y(c_rgt[0], c_rgt[1])
    bl_y = _bot_y(c_lft[0], c_lft[1])
    br_y = _bot_y(c_rgt[0], c_rgt[1])
    
    tl_x = _left_x(r_top[0], r_top[1])
    bl_x = _left_x(r_bot[0], r_bot[1])
    tr_x = _right_x(r_top[0], r_top[1])
    br_x = _right_x(r_bot[0], r_bot[1])
    
    return {
        'top_left_y': tl_y, 'top_right_y': tr_y,
        'bot_left_y': bl_y, 'bot_right_y': br_y,
        'top_left_x': tl_x, 'top_right_x': tr_x,
        'bot_left_x': bl_x, 'bot_right_x': br_x,
        'expected_top': exp_top,
        'expected_bot': exp_bot,
        'expected_left': exp_left,
        'expected_right': exp_right,
    }

def main():
    test_output_dir = Path("test-output")
    
    print("\n" + "="*80)
    print("DETECTED BORDER POSITIONS (in source-pixels)")
    print("="*80)
    print()
    print(f"{'Test':<20} {'Top':>12} {'Bottom':>12} {'Left':>12} {'Right':>12}")
    print(f"{'':20} {'Avg Diff':>12} {'Avg Diff':>12} {'Avg Diff':>12} {'Avg Diff':>12}")
    print("-" * 80)
    
    results = []
    
    for test_dir in sorted(test_output_dir.iterdir()):
        if not test_dir.is_dir() or test_dir.name.endswith('-debug') or test_dir.name.endswith('-final'):
            continue
        
        test_name = test_dir.name
        warp_path = test_dir / f"{test_name}_warp.png"
        
        if not warp_path.exists():
            continue
        
        warp = cv2.imread(str(warp_path))
        if warp is None:
            print(f"Error loading {warp_path}")
            continue
        
        borders = detect_borders(warp, scale=8)
        
        # Calculate differences from expected (in source-pixels, 1/8 of an image pixel)
        top_diff = (borders['top_left_y'] + borders['top_right_y']) / 2 - borders['expected_top']
        bottom_diff = borders['expected_bot'] - (borders['bot_left_y'] + borders['bot_right_y']) / 2
        left_diff = (borders['top_left_x'] + borders['bot_left_x']) / 2 - borders['expected_left']
        right_diff = borders['expected_right'] - (borders['top_right_x'] + borders['bot_right_x']) / 2
        
        # Convert to source pixels
        top_diff_sp = top_diff / 8
        bottom_diff_sp = bottom_diff / 8
        left_diff_sp = left_diff / 8
        right_diff_sp = right_diff / 8
        
        results.append((test_name, top_diff_sp, bottom_diff_sp, left_diff_sp, right_diff_sp))
        
        print(f"{test_name:<20} "
              f"{top_diff_sp:>12.2f} "
              f"{bottom_diff_sp:>12.2f} "
              f"{left_diff_sp:>12.2f} "
              f"{right_diff_sp:>12.2f}")
    
    print()
    print("="*80)
    print("Interpretation (in source-pixels, where 8 source-pixels = 1 image-pixel):")
    print("  Positive value = border detected too inward (cutting content)")
    print("  Negative value = border detected too outward (including frame)")
    print("="*80)
    print()
    
    # Summary of user-reported issues
    print("\nUSER-REPORTED ISSUES:")
    print("-" * 80)
    for test_name, top, bottom, left, right in results:
        issues = []
        if test_name == "thing-1" and bottom > 3:
            issues.append(f"bottom edge ~{bottom:.1f}px too high (user said ~3px)")
        elif test_name == "thing-2" and left > 2:
            issues.append(f"left edge ~{left:.1f}px too far right (user said ~2px)")
        elif test_name == "zelda-poster-2":
            if top > 2:
                issues.append(f"top edge ~{top:.1f}px too low (user said ~2px)")
            if bottom > 2:
                issues.append(f"bottom edge ~{bottom:.1f}px too high (user said ~2px)")
        elif test_name == "zelda-poster-3":
            if right > 2:
                issues.append(f"right edge ~{right:.1f}px too far left (user said ~2px)")
        
        if issues:
            print(f"{test_name:20} " + " | ".join(issues))

if __name__ == "__main__":
    main()
