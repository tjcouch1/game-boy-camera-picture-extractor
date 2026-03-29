#!/usr/bin/env python3
"""Analyze the warp corner detection for zelda-poster-3."""

import sys
sys.path.insert(0, '.')

from gbcam_warp import find_screen_corners, _find_border_corners
import cv2
import numpy as np
from pathlib import Path

# Load input
input_path = Path("test-input/zelda-poster-3.jpg")
img = cv2.imread(str(input_path))
print(f"Input shape: {img.shape}")

# Detect initial screen corners
print("\n=== INITIAL SCREEN CORNER DETECTION ===")
try:
    corners = find_screen_corners(img, thresh_val=180, debug=False)
    print(f"Screen corners (TL, TR, BR, BL):")
    for i, corner in enumerate(corners):
        print(f"  {['TL', 'TR', 'BR', 'BL'][i]}: {corner}")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
