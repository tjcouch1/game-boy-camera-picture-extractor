#!/usr/bin/env python3
"""
Find per-edge calibration parameters to fix specific user-reported issues.
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

def detect_borders_with_per_edge_params(warp_img, scale=8, top_adj=0, bot_adj=0, left_adj=0, right_adj=0):
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
    
    return {
        'top_left': (tl_x, tl_y),
        'top_right': (tr_x, tr_y),
        'bottom_right': (br_x, br_y),
        'bottom_left': (bl_x, bl_y),
        'corners': [(tl_x, tl_y), (tr_x, tr_y), (br_x, br_y), (bl_x, bl_y)],
    }

def measure_edge_alignment(warp_img, borders):
    """
    Measure how well each edge aligns with the expected frame color.
    Returns per-edge quality metrics.
    """
    H, W = warp_img.shape[:2]
    rgb = cv2.cvtColor(warp_img, cv2.COLOR_BGR2RGB).astype(np.float32)
    EXPECTED = np.array([255, 255, 165], dtype=np.float32)
    
    tl, tr, br, bl = borders['corners']
    
    metrics = {}
    
    # Top edge - sample just below the detected top border
    y_top = int(tl[1])
    if 0 <= y_top + 8 < H:
        top_sample = rgb[y_top:y_top + 16, :, :].mean(axis=(0, 1))
        metrics['top'] = np.linalg.norm(top_sample - EXPECTED)
    
    # Bottom edge - sample just above the detected bottom border
    y_bot = int(bl[1])
    if 0 <= y_bot - 8 < H:
        bot_sample = rgb[max(0, y_bot - 16):y_bot, :, :].mean(axis=(0, 1))
        metrics['bottom'] = np.linalg.norm(bot_sample - EXPECTED)
    
    # Left edge - sample just right of the detected left border
    x_left = int(tl[0])
    if 0 <= x_left + 8 < W:
        left_sample = rgb[:, x_left:x_left + 16, :].mean(axis=(0, 1))
        metrics['left'] = np.linalg.norm(left_sample - EXPECTED)
    
    # Right edge - sample just left of the detected right border
    x_right = int(tr[0])
    if 0 <= x_right - 8 < W:
        right_sample = rgb[:, max(0, x_right - 16):x_right, :].mean(axis=(0, 1))
        metrics['right'] = np.linalg.norm(right_sample - EXPECTED)
    
    return metrics

def main():
    print("\n" + "="*90)
    print("PER-EDGE CALIBRATION ANALYSIS")
    print("="*90)
    print()
    
    test_cases = [
        ("thing-1", "bottom", 24),  # 3 source-pixels = 24 image pixels
        ("thing-2", "left", 16),    # 2 source-pixels = 16 image pixels
        ("zelda-poster-2", "top_bottom", 16),  # 2 source-pixels
        ("zelda-poster-3", "right", 16),       # 2 source-pixels
    ]
    
    test_output_dir = Path("test-output")
    
    for test_name, edge_type, expected_offset_px in test_cases:
        test_dir = test_output_dir / test_name
        warp_path = test_dir / f"{test_name}_warp.png"
        
        if not warp_path.exists():
            continue
        
        warp = cv2.imread(str(warp_path))
        if warp is None:
            continue
        
        print(f"\n{test_name} - {edge_type} edge needs ~{expected_offset_px}px adjustment:")
        print("-" * 90)
        
        # Test different adjustments on the specific edge
        best_score = float('inf')
        best_adj = 0
        
        for adj in range(-32, 33, 4):
            if edge_type == "bottom":
                borders = detect_borders_with_per_edge_params(warp, bot_adj=adj)
            elif edge_type == "left":
                borders = detect_borders_with_per_edge_params(warp, left_adj=adj)
            elif edge_type == "right":
                borders = detect_borders_with_per_edge_params(warp, right_adj=adj)
            elif edge_type == "top":
                borders = detect_borders_with_per_edge_params(warp, top_adj=adj)
            elif edge_type == "top_bottom":
                borders = detect_borders_with_per_edge_params(warp, top_adj=adj, bot_adj=adj)
            else:
                continue
            
            metrics = measure_edge_alignment(warp, borders)
            
            # Print this adjustment level
            print(f"  adj={adj:+4d}px: ", end="")
            for edge_name, error in sorted(metrics.items()):
                print(f"{edge_name}={error:6.1f} ", end="")
            print()
            
            # Track best for the specific edge(s) being adjusted
            if edge_type == "bottom" and 'bottom' in metrics:
                score = metrics['bottom']
            elif edge_type == "left" and 'left' in metrics:
                score = metrics['left']
            elif edge_type == "right" and 'right' in metrics:
                score = metrics['right']
            elif edge_type == "top" and 'top' in metrics:
                score = metrics['top']
            elif edge_type == "top_bottom":
                score = (metrics.get('top', 0) + metrics.get('bottom', 0)) / 2
            else:
                continue
            
            if score < best_score:
                best_score = score
                best_adj = adj
        
        print(f"\n  => Best adjustment: {best_adj:+d}px (score={best_score:.1f})")
        print(f"  => User reported need: {expected_offset_px:+d}px")
        print(f"  => Match: {abs(best_adj - expected_offset_px) < 8}")

if __name__ == "__main__":
    main()
