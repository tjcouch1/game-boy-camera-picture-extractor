#!/usr/bin/env python3
"""
Debug script to analyze border detection accuracy.
Shows what the detection algorithm is finding vs expected.
"""

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from gbcam_common import SCREEN_W, SCREEN_H, INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT

def _first_dark_from_frame(profile, smooth_sigma=1.5):
    """Original detection with diagnostics"""
    p = gaussian_filter1d(profile.astype(float), sigma=smooth_sigma)
    d = np.diff(p)
    k = int(np.argmin(d))
    delta = 0.0
    if 0 < k < len(d) - 1:
        d0, d1, d2 = float(d[k - 1]), float(d[k]), float(d[k + 1])
        denom = d0 - 2.0 * d1 + d2
        if abs(denom) > 1e-10:
            delta = float(np.clip(0.5 * (d0 - d2) / denom, -1.0, 1.0))
    return float(k + 1 + delta), p, d, k

# Load thing-1 warp image
img = cv2.imread('test-output/thing-1-check2/debug/thing-1__warp_b_initial_color.png')
H, W = img.shape[:2]
scale = 8

# Extract the R-B channel
rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
rb_ch = np.clip(rgb[:, :, 0] - rgb[:, :, 2] + 128.0, 0.0, 255.0).astype(np.uint8)

exp_bottom = INNER_BOT * scale
srch = 6 * scale
exp_left = INNER_LEFT * scale
exp_right = INNER_RIGHT * scale

# Sample bottom edge at different columns
print("BOTTOM EDGE DETECTION ANALYSIS FOR THING-1")
print("=" * 100)
print("Examining detection accuracy to identify spurious edge detections\n")
print("col#  | Y-pos  | from_exp | neighbors | neighbor_gap | good?")
print("-" * 70)

bottom_detections = []
for col_idx, col_frac in enumerate(np.linspace(0.0, 1.0, 9)):
    col = int(exp_left + (exp_right - exp_left) * col_frac)
    col = np.clip(col, 0, W - 1)
    
    r1, r2 = max(0, int(exp_bottom - srch)), min(H, int(exp_bottom + srch))
    prof_raw = rb_ch[int(r1):int(r2), col].astype(float)
    
    # Reverse for bottom edge detection
    prof = prof_raw[::-1]
    
    # Run detection
    idx, p_smooth, d, k = _first_dark_from_frame(prof, smooth_sigma=1.5)
    
    # Convert to actual y position
    y_pos = int(r2 - 1) - idx - (scale - 1)
    
    bottom_detections.append(y_pos)
    
    # Compare to expected
    from_expected = y_pos - exp_bottom
    
    # Compare to neighbors
    if col_idx > 0:
        neighbor_gap = abs(y_pos - bottom_detections[-2])
    else:
        neighbor_gap = 0
    
    is_good = neighbor_gap <= 16
    good_marker = "✓" if is_good else "✗ OUTLIER"
    
    print(f"{col_idx:2d}   | {y_pos:6.0f} | {from_expected:+8.1f} | {col_frac:9.2f} | {neighbor_gap:12.1f} | {good_marker}")

print("\n" + "=" * 70)
print(f"\nDetected y-positions:     {[f'{y:.0f}' for y in bottom_detections]}")
print(f"Expected position:        {exp_bottom}")
print(f"Deviations from expected: {[f'{y-exp_bottom:+.0f}' for y in bottom_detections]}")

# Check for gaps between consecutive points
print(f"\nGaps between consecutive points:")
for i in range(1, len(bottom_detections)):
    gap = bottom_detections[i] - bottom_detections[i-1]
    marker = " (OK)" if abs(gap) <= 5 else " (LARGE!)"
    print(f"  Point {i-1} to {i}: {gap:+.1f}px{marker}")

# Summary
outliers = []
for i in range(1, len(bottom_detections)):
    if abs(bottom_detections[i] - bottom_detections[i-1]) > 16:
        outliers.append(i)

if outliers:
    print(f"\n⚠ POTENTIAL OUTLIERS AT INDICES: {outliers}")
    print("These points are >16px different from their neighbors")
    print("This indicates spurious edge detection at those locations")
else:
    print(f"\n✓ No major outliers detected (all neighbor gaps <= 16px)")

