#!/usr/bin/env python3
"""Detailed profile analysis for right edge detection."""

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d

scale = 8
img = cv2.imread("test-output/thing-1/thing-1_warp.png")
H, W = img.shape[:2]

b, g, r = cv2.split(img)
rb_ch = np.uint8(np.clip(r.astype(np.float32) - b.astype(np.float32) + 128, 0, 255))

exp_right = 1152
exp_top = 120
exp_bot = 1024

srch = 6 * scale  # 48

print("RIGHT EDGE PROFILE ANALYSIS FOR thing-1")
print("=" * 90)

# Check right edge detection at one row (middle)
row = (exp_top + exp_bot) // 2
c1, c2 = max(0, int(exp_right - srch)), min(W, int(exp_right + srch))

print(f"Analyzing row {row}")
print(f"Search region: x=[{c1}, {c2}) width={c2-c1}")
print()

prof = rb_ch[row, int(c1):int(c2)].astype(float)

print("Profile values (pixel index -> R-B channel value):")
for i in range(min(len(prof), 100)):
    if i % 10 == 0:
        marker = f" <- x={c1+i}"
    else:
        marker = ""
    print(f"  idx {i:2d}: {prof[i]:6.1f}{marker}")

print()
print("Reversed profile (what _first_dark_from_frame sees):")
prof_rev = prof[::-1]
for i in range(min(len(prof_rev), 25)):
    print(f"  idx {i:2d}: {prof_rev[i]:6.1f}")

print()
print("Looking for first dark pixel in reversed profile...")

# Simulate _first_dark_from_frame
p = gaussian_filter1d(prof_rev.astype(float), sigma=1.5)
d = np.diff(p)
k = int(np.argmin(d))

print(f"  Steepest drop at reversed idx {k}: {p[k]:.1f} -> {p[k+1]:.1f} (drop {d[k]:.1f})")
print(f"  Result idx (with sub-pixel refinement): {k + 1:.2f}")
print()

idx = k + 1
x_pos = int(c2 - 1) - idx - (scale - 1)
print(f"Final calculation:")
print(f"  x_pos = int({c2-1}) - {idx:.1f} - {scale-1}")
print(f"  x_pos = {c2-1} - {idx:.1f} - {scale-1} = {x_pos:.1f}")
print(f"  Expected: {exp_right}")
print(f"  Error: {x_pos - exp_right:.1f}")
