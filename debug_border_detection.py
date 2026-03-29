#!/usr/bin/env python3
"""Debug script to visualize what _find_border_corners is detecting."""

import sys
import cv2
import numpy as np
from gbcam_common import INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT, SCREEN_W, SCREEN_H
from gbcam_warp import _first_dark_from_frame

def analyze_border_detection(input_path, scale=8):
    """Analyze what borders are detected for a specific input."""
    
    print(f"Analyzing: {input_path}")
    print("=" * 70)
    
    img = cv2.imread(input_path)
    if img is None:
        print(f"ERROR: Could not read {input_path}")
        return
    
    H, W = img.shape[:2]
    print(f"Image size: {W}x{H}")
    
    # Convert to R-B difference channel
    b, g, r = cv2.split(img)
    rb_ch = np.uint8(np.clip(r.astype(np.float32) - b.astype(np.float32) + 128, 0, 255))
    
    print(f"\nR-B channel range: {rb_ch.min()}-{rb_ch.max()}")
    
    # Expected positions in image pixels
    exp_top = INNER_TOP * scale      # 120
    exp_bot = INNER_BOT * scale      # 1024
    exp_left = INNER_LEFT * scale    # 120
    exp_right = INNER_RIGHT * scale  # 1152
    
    print(f"\nEXPECTED border positions:")
    print(f"  Top:    {exp_top} px from top")
    print(f"  Bottom: {exp_bot} px from top")
    print(f"  Left:   {exp_left} px from left")
    print(f"  Right:  {exp_right} px from left")
    print()
    
    # Simulate what _find_border_corners does
    srch = 6 * scale  # 48 pixels
    
    mid_col = (INNER_LEFT + INNER_RIGHT) // 2 * scale   # ~79*scale = 632
    mid_row = (INNER_TOP  + INNER_BOT)   // 2 * scale   # ~71*scale = 568
    
    c_lft = (max(0, 10 * scale),  mid_col)
    c_rgt = (mid_col,     min(W, 150 * scale))
    r_top = (max(0, 10 * scale),  mid_row)
    r_bot = (mid_row,     min(H, (SCREEN_H - 10) * scale))
    
    print(f"Search band definitions:")
    print(f"  Column left:  [{c_lft[0]}, {c_lft[1]})")
    print(f"  Column right: [{c_rgt[0]}, {c_rgt[1]})")
    print(f"  Row top:      [{r_top[0]}, {r_top[1]})")
    print(f"  Row bottom:   [{r_bot[0]}, {r_bot[1]})")
    print()
    
    # Top edge detection (left and right quadrants)
    def _top_y(c0, c1):
        exp = INNER_TOP * scale
        r1, r2 = max(0, exp - srch), min(H, exp + srch)
        prof = rb_ch[int(r1):int(r2), c0:c1].mean(axis=1)
        result = r1 + _first_dark_from_frame(prof)
        return result, r1, r2, prof
    
    # Bottom edge detection (left and right quadrants)
    def _bot_y(c0, c1):
        exp_frame = (INNER_BOT + 1) * scale
        r1, r2 = max(0, int(exp_frame - srch)), min(H, int(exp_frame + srch))
        if r1 >= r2:
            return float(INNER_BOT * scale), r1, r2, np.array([])
        prof = rb_ch[r1:r2, c0:c1].mean(axis=1)
        idx = _first_dark_from_frame(prof[::-1])
        y_pos = int(r2) - 1.0 - idx
        return y_pos, r1, r2, prof
    
    # Left edge detection (top and bottom quadrants)
    def _left_x(r0, r1_):
        exp = INNER_LEFT * scale
        c1, c2 = max(0, exp - srch), min(W, exp + srch)
        prof = rb_ch[r0:r1_, int(c1):int(c2)].mean(axis=0)
        result = c1 + _first_dark_from_frame(prof)
        return result, c1, c2, prof
    
    # Right edge detection (top and bottom quadrants)
    def _right_x(r0, r1_):
        exp_frame = (INNER_RIGHT + 1) * scale
        c1, c2 = max(0, int(exp_frame - srch)), min(W, int(exp_frame + srch))
        if c1 >= c2:
            return float(INNER_RIGHT * scale), c1, c2, np.array([])
        prof = rb_ch[r0:r1_, c1:c2].mean(axis=0)
        idx = _first_dark_from_frame(prof[::-1])
        x_pos = int(c2) - 1.0 - idx
        return x_pos, c1, c2, prof
    
    # Detect all 8 measurements
    tl_y, r1_t, r2_t, prof_tl_y = _top_y(c_lft[0], c_lft[1])
    tr_y, r1_t2, r2_t2, prof_tr_y = _top_y(c_rgt[0], c_rgt[1])
    bl_y, r1_b, r2_b, prof_bl_y = _bot_y(c_lft[0], c_lft[1])
    br_y, r1_b2, r2_b2, prof_br_y = _bot_y(c_rgt[0], c_rgt[1])
    tl_x, c1_l, c2_l, prof_tl_x = _left_x(r_top[0], r_top[1])
    bl_x, c1_l2, c2_l2, prof_bl_x = _left_x(r_bot[0], r_bot[1])
    tr_x, c1_r, c2_r, prof_tr_x = _right_x(r_top[0], r_top[1])
    br_x, c1_r2, c2_r2, prof_br_x = _right_x(r_bot[0], r_bot[1])
    
    print("DETECTED positions:")
    print(f"\nTOP edge:")
    print(f"  Left quadrant:  {tl_y:.1f} px (expected {exp_top}, error {abs(tl_y - exp_top):.1f})")
    print(f"  Right quadrant: {tr_y:.1f} px (expected {exp_top}, error {abs(tr_y - exp_top):.1f})")
    
    print(f"\nBOTTOM edge:")
    print(f"  Left quadrant:  {bl_y:.1f} px (expected {exp_bot}, error {abs(bl_y - exp_bot):.1f})")
    print(f"  Right quadrant: {br_y:.1f} px (expected {exp_bot}, error {abs(br_y - exp_bot):.1f})")
    
    print(f"\nLEFT edge:")
    print(f"  Top quadrant:    {tl_x:.1f} px (expected {exp_left}, error {abs(tl_x - exp_left):.1f})")
    print(f"  Bottom quadrant: {bl_x:.1f} px (expected {exp_left}, error {abs(bl_x - exp_left):.1f})")
    
    print(f"\nRIGHT edge:")
    print(f"  Top quadrant:    {tr_x:.1f} px (expected {exp_right}, error {abs(tr_x - exp_right):.1f})")
    print(f"  Bottom quadrant: {br_x:.1f} px (expected {exp_right}, error {abs(br_x - exp_right):.1f})")
    
    # Compute means for each edge
    top_mean = (tl_y + tr_y) / 2
    bot_mean = (bl_y + br_y) / 2
    left_mean = (tl_x + bl_x) / 2
    right_mean = (tr_x + br_x) / 2
    
    print(f"\nAVERAGED positions:")
    print(f"  Top:    {top_mean:.1f} px (expected {exp_top}, error {abs(top_mean - exp_top):.1f})")
    print(f"  Bottom: {bot_mean:.1f} px (expected {exp_bot}, error {abs(bot_mean - exp_bot):.1f})")
    print(f"  Left:   {left_mean:.1f} px (expected {exp_left}, error {abs(left_mean - exp_left):.1f})")
    print(f"  Right:  {right_mean:.1f} px (expected {exp_right}, error {abs(right_mean - exp_right):.1f})")
    
    # Identify which quadrants are outliers
    print(f"\nOUTLIER ANALYSIS:")
    top_vals = [tl_y, tr_y]
    top_outliers = [abs(v - np.median(top_vals)) > 3 for v in top_vals]
    if any(top_outliers):
        print(f"  Top has outlier(s): {top_outliers}")
    
    bot_vals = [bl_y, br_y]
    bot_outliers = [abs(v - np.median(bot_vals)) > 3 for v in bot_vals]
    if any(bot_outliers):
        print(f"  Bottom has outlier(s): {bot_outliers}")
    
    left_vals = [tl_x, bl_x]
    left_outliers = [abs(v - np.median(left_vals)) > 3 for v in left_vals]
    if any(left_outliers):
        print(f"  Left has outlier(s): {left_outliers}")
    
    right_vals = [tr_x, br_x]
    right_outliers = [abs(v - np.median(right_vals)) > 3 for v in right_vals]
    if any(right_outliers):
        print(f"  Right has outlier(s): {right_outliers}")
    

if __name__ == "__main__":
    if len(sys.argv) > 1:
        analyze_border_detection(sys.argv[1])
    else:
        # Analyze test images
        for img in ["test-input/thing-1.jpg", "test-input/zelda-poster-1.jpg"]:
            try:
                analyze_border_detection(img)
                print()
            except Exception as e:
                print(f"Error analyzing {img}: {e}")
                print()
