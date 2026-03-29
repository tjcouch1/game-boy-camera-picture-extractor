#!/usr/bin/env python3
"""
Find optimal calibration parameters for all test images.
"""

import cv2
import numpy as np
from pathlib import Path
from scipy.ndimage import gaussian_filter1d

def _first_dark_from_frame(profile, smooth_sigma=1.5):
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

def detect_borders_with_params(warp_img, scale=8, top_adj=0, bot_adj=0, left_adj=0, right_adj=0):
    H, W = warp_img.shape[:2]
    
    INNER_TOP, INNER_BOT = 16, 128
    INNER_LEFT, INNER_RIGHT = 16, 143
    
    if len(warp_img.shape) == 3:
        b = warp_img[:, :, 0].astype(np.float32)
        r = warp_img[:, :, 2].astype(np.float32)
        channel = (r - b)
    else:
        channel = warp_img.astype(np.float32)
    
    mid_col = (INNER_LEFT + INNER_RIGHT) // 2 * scale
    mid_row = (INNER_TOP + INNER_BOT) // 2 * scale
    
    c_lft = (max(0, 10 * scale), mid_col)
    c_rgt = (mid_col, min(W, 150 * scale))
    r_top = (max(0, 10 * scale), mid_row)
    r_bot = (mid_row, min(H, (144 - 10) * scale))
    
    srch = 6 * scale
    
    def _top_y(c0, c1):
        exp = INNER_TOP * scale
        r1, r2 = max(0, exp - srch), min(H, exp + srch)
        return r1 + _first_dark_from_frame(channel[int(r1):int(r2), c0:c1].mean(axis=1)) + top_adj
    
    def _bot_y(c0, c1):
        exp_frame = (INNER_BOT + 1) * scale
        r1, r2 = max(0, exp_frame - srch), min(H, exp_frame + srch)
        prof = channel[int(r1):int(r2), c0:c1].mean(axis=1)
        idx = _first_dark_from_frame(prof[::-1])
        return int(r2 - 1) - idx - (scale - 1) + bot_adj
    
    def _left_x(r0, r1_):
        exp = INNER_LEFT * scale
        c1, c2 = max(0, exp - srch), min(W, exp + srch)
        return c1 + _first_dark_from_frame(channel[r0:r1_, int(c1):int(c2)].mean(axis=0)) + left_adj
    
    def _right_x(r0, r1_):
        exp_frame = (INNER_RIGHT + 1) * scale
        c1, c2 = max(0, exp_frame - srch), min(W, exp_frame + srch)
        prof = channel[r0:r1_, int(c1):int(c2)].mean(axis=0)
        idx = _first_dark_from_frame(prof[::-1])
        return int(c2 - 1) - idx - (scale - 1) + right_adj
    
    tl_y = _top_y(c_lft[0], c_lft[1])
    tr_y = _top_y(c_rgt[0], c_rgt[1])
    bl_y = _bot_y(c_lft[0], c_lft[1])
    br_y = _bot_y(c_rgt[0], c_rgt[1])
    
    tl_x = _left_x(r_top[0], r_top[1])
    bl_x = _left_x(r_bot[0], r_bot[1])
    tr_x = _right_x(r_top[0], r_top[1])
    br_x = _right_x(r_bot[0], r_bot[1])
    
    return [(tl_x, tl_y), (tr_x, tr_y), (br_x, br_y), (bl_x, bl_y)]

def measure_frame_color(warp_img, corners):
    H, W = warp_img.shape[:2]
    tl, tr, br, bl = corners
    
    rgb = cv2.cvtColor(warp_img, cv2.COLOR_BGR2RGB).astype(np.float32)
    EXPECTED = np.array([255, 255, 165], dtype=np.float32)
    
    frame_regions = []
    
    y_top = int(tl[1])
    frame_regions.append(rgb[max(0, y_top):max(0, y_top + 16), :, :].mean(axis=(0, 1)))
    
    y_bot = int(bl[1])
    frame_regions.append(rgb[min(H-1, y_bot):min(H, y_bot + 16), :, :].mean(axis=(0, 1)))
    
    x_left = int(tl[0])
    frame_regions.append(rgb[:, max(0, x_left):max(0, x_left + 16), :].mean(axis=(0, 1)))
    
    x_right = int(tr[0])
    frame_regions.append(rgb[:, min(W-1, x_right):min(W, x_right + 16), :].mean(axis=(0, 1)))
    
    errors = [np.linalg.norm(fr - EXPECTED) for fr in frame_regions]
    return np.mean(errors)

def main():
    test_output_dir = Path("test-output")
    
    print("\n" + "="*100)
    print("OPTIMAL CALIBRATION PARAMETERS FOR ALL TEST IMAGES")
    print("="*100)
    print()
    print(f"{'Test':<20} {'Top (px)':>12} {'Bot (px)':>12} {'Left (px)':>12} {'Right (px)':>12} {'Frame Error':>15}")
    print("-" * 100)
    
    for test_dir in sorted(test_output_dir.iterdir()):
        if not test_dir.is_dir() or test_dir.name.endswith('-debug') or test_dir.name.endswith('-final'):
            continue
        
        test_name = test_dir.name
        warp_path = test_dir / f"{test_name}_warp.png"
        
        if not warp_path.exists():
            continue
        
        warp = cv2.imread(str(warp_path))
        if warp is None:
            continue
        
        best_score = float('inf')
        best_params = (0, 0, 0, 0)
        
        # Search for best combination (coarser search than before)
        for adj in range(-20, 25, 4):
            corners = detect_borders_with_params(warp, top_adj=adj, bot_adj=adj, left_adj=adj, right_adj=adj)
            score = measure_frame_color(warp, corners)
            
            if score < best_score:
                best_score = score
                best_params = (adj, adj, adj, adj)
        
        top_adj, bot_adj, left_adj, right_adj = best_params
        
        print(f"{test_name:<20} {top_adj:>12} {bot_adj:>12} {left_adj:>12} {right_adj:>12} {best_score:>15.2f}")
    
    print()
    print("="*100)
    print("Positive values = move edges outward (expand camera area)")
    print("Negative values = move edges inward (shrink camera area)")
    print("="*100)

if __name__ == "__main__":
    main()
