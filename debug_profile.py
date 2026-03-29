#!/usr/bin/env python3
"""Debug what _first_dark_from_frame is doing on a profile."""

import sys
import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from gbcam_common import INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT, SCREEN_W, SCREEN_H
from gbcam_warp import _first_dark_from_frame

def debug_profile(input_path, scale=8):
    """Debug profile extraction for border detection."""
    
    print(f"Analyzing: {input_path}\n")
    
    img = cv2.imread(input_path)
    if img is None:
        print(f"ERROR: Could not read {input_path}")
        return
    
    H, W = img.shape[:2]
    
    # Convert to R-B difference channel
    b, g, r = cv2.split(img)
    rb_ch = np.uint8(np.clip(r.astype(np.float32) - b.astype(np.float32) + 128, 0, 255))
    
    # Extract a sample profile from the TOP edge (left quadrant)
    exp_top = INNER_TOP * scale  # 120
    srch = 6 * scale  # 48
    r1, r2 = max(0, exp_top - srch), min(H, exp_top + srch)
    
    # Left quadrant column band
    c_lft_0 = max(0, 10 * scale)
    c_lft_1 = (INNER_LEFT + INNER_RIGHT) // 2 * scale
    
    print(f"TOP edge profile (left quadrant):")
    print(f"  Row range: [{r1}, {r2})")
    print(f"  Col range: [{c_lft_0}, {c_lft_1})")
    print(f"  Expected border at row {exp_top}")
    print()
    
    prof = rb_ch[int(r1):int(r2), c_lft_0:c_lft_1].mean(axis=1)
    
    print(f"Profile values (averaged across {c_lft_1 - c_lft_0} columns):")
    for i, val in enumerate(prof):
        row_num = r1 + i
        marker = " <-- expected border" if row_num == exp_top else ""
        print(f"  Row {row_num:4d}: {val:6.1f}{marker}")
    
    print()
    detected = _first_dark_from_frame(prof)
    detected_row = r1 + detected
    print(f"Detected position: {detected:.2f} pixels from start of profile")
    print(f"Detected row: {detected_row:.1f}")
    print(f"Error from expected: {detected_row - exp_top:.1f} pixels")
    print()
    
    # Try to understand what the algorithm is seeing
    print("Manual gradient analysis:")
    print(f"  Profile min: {prof.min():.1f}")
    print(f"  Profile max: {prof.max():.1f}")
    
    # Smooth the profile
    prof_smooth = gaussian_filter1d(prof.astype(np.float32), sigma=1.0)
    
    # Find gradients
    grads = np.abs(np.diff(prof_smooth))
    print(f"  Gradient max: {grads.max():.1f}")
    print(f"  Gradient at position around {exp_top - r1}: {grads[max(0, int(exp_top - r1 - 1))]:.1f}")
    print()
    
    # Show where _first_dark_from_frame typically looks
    print("Profile transitions (where value drops significantly):")
    for i in range(1, len(prof)):
        drop = prof[i-1] - prof[i]
        if drop > 5:
            print(f"  Position {i}: drops from {prof[i-1]:.1f} to {prof[i]:.1f} (drop {drop:.1f})")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        debug_profile(sys.argv[1])
    else:
        debug_profile("test-input/thing-1.jpg")
