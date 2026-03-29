#!/usr/bin/env python3
"""Debug right edge detection for thing-1."""

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from gbcam_common import INNER_RIGHT, INNER_BOT, INNER_TOP, SCREEN_H
from gbcam_warp import _first_dark_from_frame

scale = 8
img = cv2.imread("test-output/thing-1/thing-1_warp.png")
H, W = img.shape[:2]

# Convert to R-B channel
b, g, r = cv2.split(img)
rb_ch = np.uint8(np.clip(r.astype(np.float32) - b.astype(np.float32) + 128, 0, 255))

# Expected position for right edge
exp_right = INNER_RIGHT * scale  # 1152
exp_top = INNER_TOP * scale      # 120
exp_bot = INNER_BOT * scale      # 1024

print(f"RIGHT EDGE DETECTION ANALYSIS")
print("=" * 70)
print(f"Expected right edge at x={exp_right}")
print()

srch = 6 * scale  # 48 pixels
mid_row = (INNER_TOP + INNER_BOT) // 2 * scale  # ~568

# Sample right edge detection at multiple rows
print(f"{'Row':<6} {'Search Region':<20} {'Profile Min/Max':<15} {'Detected X':<12} {'Error':<10}")
print("-" * 70)

sample_rows = [exp_top, mid_row, exp_bot, exp_top + 100, mid_row + 100, exp_bot - 100]

for row_idx in range(9):
    row = int(exp_top + (exp_bot - exp_top) * row_idx / 8)
    
    c1, c2 = max(0, int(exp_right + 1) * scale - srch), min(W, int(exp_right + 1) * scale + srch)
    
    if c1 >= c2 or row < 0 or row >= H:
        continue
    
    prof = rb_ch[int(row), int(c1):int(c2)].astype(float)
    idx = _first_dark_from_frame(prof[::-1])
    x_pos = int(c2) - 1 - idx - (scale - 1)
    error = x_pos - exp_right
    
    prof_min, prof_max = prof.min(), prof.max()
    print(f"{row:<6} [{int(c1):4d}, {int(c2):4d}] {prof_min:6.1f}-{prof_max:6.1f}    {x_pos:<12.1f} {error:+6.1f}")

print()
print("ANALYSIS:")
print(f"  If detected X is consistently << {exp_right}, right edge is detected too far left")
print(f"  This would create large errors in right edge curvature calculation")
