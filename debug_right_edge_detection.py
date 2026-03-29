#!/usr/bin/env python3
"""Debug right edge detection for zelda-poster-3."""

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from pathlib import Path
import sys

# Load the original input image
input_path = Path("test-input/zelda-poster-3.jpg")
img = cv2.imread(str(input_path))
print(f"Input image shape: {img.shape}")

# From the warp step - extract the warped intermediate
warp_inter_path = Path("test-output/zelda-poster-3/debug/zelda-poster-3_warp_intermediate.png")
if warp_inter_path.exists():
    warp_inter = cv2.imread(str(warp_inter_path))
    print(f"Warp intermediate shape: {warp_inter.shape}")
    
    # Extract R-B channel like the warp code does
    b, g, r = cv2.split(warp_inter)
    rb_ch = r.astype(np.float32) - b.astype(np.float32) + 128
    
    # Constants from gbcam_common
    SCREEN_W, SCREEN_H = 160, 144
    INNER_TOP, INNER_BOT = 15, 128
    INNER_LEFT, INNER_RIGHT = 15, 143
    scale = 8
    
    H, W = rb_ch.shape
    print(f"R-B channel shape: {H}x{W}")
    
    # Simulate the _right_x detection
    srch = 6 * scale
    mid_row = (INNER_TOP + INNER_BOT) // 2 * scale
    r_top = (max(0, 10 * scale), mid_row)
    r_bot = (mid_row, min(H, (SCREEN_H - 10) * scale))
    
    exp_frame = (INNER_RIGHT + 1) * scale
    c1, c2 = max(0, exp_frame - srch), min(W, exp_frame + srch)
    
    print(f"\nRight edge detection parameters:")
    print(f"  INNER_RIGHT = {INNER_RIGHT}, so exp_frame = ({INNER_RIGHT}+1)*{scale} = {exp_frame}")
    print(f"  Search range: c1={c1}, c2={c2} (width={c2-c1})")
    print(f"  Row ranges: r_top={r_top}, r_bot={r_bot}")
    
    # Check what the profile looks like
    for row_name, (r0, r1_) in [("top", r_top), ("bottom", r_bot)]:
        prof = rb_ch[r0:r1_, int(c1):int(c2)].mean(axis=0)
        print(f"\n{row_name.upper()} edge profile ({row_name} rows {r0}-{r1_}):")
        print(f"  Profile length: {len(prof)}")
        print(f"  Profile min/max/mean: {prof.min():.1f}/{prof.max():.1f}/{prof.mean():.1f}")
        
        # Apply Gaussian smoothing like _first_dark_from_frame does
        p = gaussian_filter1d(prof.astype(float), sigma=1.5)
        d = np.diff(p)
        k = int(np.argmin(d))
        print(f"  Steepest drop at index {k} (value diff={d[k]:.2f})")
        print(f"  Reversed: steepest drop at index {k} in reversed profile")
        
        idx = k + 1  # simplified, without sub-pixel delta
        detected_x = int(c2 - 1) - idx - (scale - 1)
        expected_x = INNER_RIGHT * scale
        
        print(f"  Detected right-x = c2-1 - idx - (scale-1) = {int(c2-1)} - {idx} - {scale-1} = {detected_x}")
        print(f"  Expected right-x = {expected_x}")
        print(f"  Error: {detected_x - expected_x} pixels")

else:
    print(f"ERROR: Intermediate warp not found at {warp_inter_path}")
    print("Running test first...")
    import subprocess
    subprocess.run([
        "python", "test_pipeline.py",
        "--input", "test-input/zelda-poster-3.jpg",
        "--reference", "test-input/zelda-poster-output-corrected.png",
        "--output-dir", "test-output/zelda-poster-3-debug",
        "--keep-intermediates"
    ], cwd=".")
