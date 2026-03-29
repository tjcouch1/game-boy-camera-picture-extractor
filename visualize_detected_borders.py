#!/usr/bin/env python3
"""
Create side-by-side visualizations showing detected borders on warp output.
"""

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
    """Detect borders and return coordinates."""
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
    
    tl_y = int(_top_y(c_lft[0], c_lft[1]))
    tr_y = int(_top_y(c_rgt[0], c_rgt[1]))
    bl_y = int(_bot_y(c_lft[0], c_lft[1]))
    br_y = int(_bot_y(c_rgt[0], c_rgt[1]))
    
    tl_x = int(_left_x(r_top[0], r_top[1]))
    bl_x = int(_left_x(r_bot[0], r_bot[1]))
    tr_x = int(_right_x(r_top[0], r_top[1]))
    br_x = int(_right_x(r_bot[0], r_bot[1]))
    
    return (tl_x, tl_y), (tr_x, tr_y), (br_x, br_y), (bl_x, bl_y)

def main():
    test_output_dir = Path("test-output")
    
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
        
        # Create visualization
        vis = warp.copy()
        
        # Detect borders
        tl, tr, br, bl = detect_borders(warp)
        
        # Draw border rectangles
        pts = np.array([tl, tr, br, bl], dtype=np.int32)
        cv2.polylines(vis, [pts], True, (0, 255, 0), 2)
        
        # Draw corner circles
        for pt in pts:
            cv2.circle(vis, tuple(pt), 5, (255, 0, 0), -1)
        
        # Save visualization
        out_path = test_dir / f"{test_name}_border_visualization.png"
        cv2.imwrite(str(out_path), vis)
        print(f"Wrote {out_path}")

if __name__ == "__main__":
    main()
