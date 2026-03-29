#!/usr/bin/env python3
"""Diagnose why zelda-poster-3's right edge is getting cut off."""

import cv2
import numpy as np
from pathlib import Path

# Load the warped output and reference
warp_path = Path("test-output/zelda-poster-3/zelda-poster-3_warp.png")
ref_path = Path("test-input/zelda-poster-output-corrected.png")

if not warp_path.exists():
    print(f"ERROR: {warp_path} not found")
    exit(1)

warp = cv2.imread(str(warp_path))
ref = cv2.imread(str(ref_path))

print(f"Warp shape: {warp.shape}")
print(f"Reference shape: {ref.shape}")

if warp.shape != ref.shape:
    print(f"\nERROR: Shapes don't match!")
    print(f"  Warp:      {warp.shape}")
    print(f"  Reference: {ref.shape}")
    print("\nThe warp output might be cut off or padded differently.")

# Analyze the right edge of both images
right_edge_warp = warp[:, -16:, :]  # Last 16 pixels (2 GB pixels at scale 8)
right_edge_ref = ref[:, -16:, :]

print(f"\nRight edge analysis (last 16 pixels):")
print(f"  Warp right edge mean color: {right_edge_warp.mean(axis=(0,1))}")
print(f"  Ref right edge mean color:  {right_edge_ref.mean(axis=(0,1))}")

# Expected white frame color: FFFFA5 = (165, 255, 255) in BGR
expected_white = np.array([165, 255, 255])
warp_white_error = np.linalg.norm(right_edge_warp.mean(axis=(0,1)) - expected_white)
ref_white_error = np.linalg.norm(right_edge_ref.mean(axis=(0,1)) - expected_white)

print(f"\n  Warp right edge distance from white FFFFA5: {warp_white_error:.2f}")
print(f"  Ref right edge distance from white FFFFA5:  {ref_white_error:.2f}")

# Look at the actual pixel columns on the far right
print(f"\nColumn-by-column analysis (last 5 columns):")
for col_idx in range(-5, 0):
    col_warp = warp[:, col_idx, :].mean(axis=0)
    col_ref = ref[:, col_idx, :].mean(axis=0)
    print(f"  Column {col_idx}: warp={col_warp.astype(int)}, ref={col_ref.astype(int)}")

# Check if warp is smaller than reference
if warp.shape[1] < ref.shape[1]:
    print(f"\nWARNING: Warp width ({warp.shape[1]}) < Reference width ({ref.shape[1]})")
    print(f"The right edge is being clipped by {ref.shape[1] - warp.shape[1]} pixels!")
