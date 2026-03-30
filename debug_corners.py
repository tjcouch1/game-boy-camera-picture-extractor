#!/usr/bin/env python3

import numpy as np
import cv2
from pathlib import Path
import sys

# Add current dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from gbcam_warp import find_screen_corners, _initial_warp, _find_border_corners, refine_warp
from gbcam_common import SCREEN_W, SCREEN_H, log

test_images = [
    "test-input/thing-1.jpg",
    "test-input/thing-2.jpg",
    "test-input/zelda-poster-3.jpg",
]

for img_path in test_images:
    img = cv2.imread(img_path)
    if img is None:
        print(f"Could not load {img_path}")
        continue
    
    print(f"\n{Path(img_path).stem}:")
    
    # Find initial screen corners
    corners_rgb = find_screen_corners(img, debug=False)
    corners = corners_rgb[:, ::-1]  # BGR
    
    # Compute initial warp
    warped, M = _initial_warp(img, corners, scale=1)
    
    # Extract B-R channel
    b, g, r = cv2.split(warped)
    rb_ch = b - r
    rb_ch = np.clip(rb_ch, 0, 255).astype(np.uint8)
    
    # Find border corners
    TL, TR, BR, BL = _find_border_corners(rb_ch, scale=1)
    
    # Print corner positions
    print(f"  TL: {TL}")
    print(f"  TR: {TR}")
    print(f"  BR: {BR}")
    print(f"  BL: {BL}")
    
    # Expected corners (in warped GB pixel space)
    exp_TL = (15, 15)
    exp_TR = (145, 15)
    exp_BR = (145, 129)
    exp_BL = (15, 129)
    
    print(f"  Expected TL: {exp_TL}, diff: ({TL[0] - exp_TL[0]:.1f}, {TL[1] - exp_TL[1]:.1f})")
    print(f"  Expected TR: {exp_TR}, diff: ({TR[0] - exp_TR[0]:.1f}, {TR[1] - exp_TR[1]:.1f})")
    print(f"  Expected BR: {exp_BR}, diff: ({BR[0] - exp_BR[0]:.1f}, {BR[1] - exp_BR[1]:.1f})")
    print(f"  Expected BL: {exp_BL}, diff: ({BL[0] - exp_BL[0]:.1f}, {BL[1] - exp_BL[1]:.1f})")
