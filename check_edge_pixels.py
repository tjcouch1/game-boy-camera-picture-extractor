#!/usr/bin/env python3
"""Check pixel values at edges of warp output vs reference."""

import cv2
import numpy as np
from pathlib import Path

def check_edges(test_name):
    warp_path = Path(f"test-output/{test_name}/{test_name}_warp.png")
    if 'zelda' in test_name:
        ref_path = Path("test-input/zelda-poster-output-corrected.png")
    else:
        ref_path = Path("test-input/thing-output-corrected.png")
    
    if not warp_path.exists():
        print(f"SKIP {test_name}: warp output not found")
        return
    
    warp = cv2.imread(str(warp_path))
    ref = cv2.imread(str(ref_path))
    
    if warp is None or ref is None:
        print(f"SKIP {test_name}: could not load images")
        return
    
    print(f"\n{test_name}:")
    print(f"  Warp shape: {warp.shape}")
    print(f"  Ref shape:  {ref.shape}")
    
    # Check right edge - sample middle row
    mid_row = warp.shape[0] // 2
    right_col_warp = warp[mid_row, -1]
    right_col_warp_1 = warp[mid_row, -9]  # One pixel from edge at scale 8
    
    print(f"  Right edge warp[{mid_row}, -1]: {right_col_warp}")
    print(f"  Right edge warp[{mid_row}, -9]: {right_col_warp_1}")
    
    # Check bottom edge - sample middle column
    mid_col = warp.shape[1] // 2
    bottom_row_warp = warp[-1, mid_col]
    bottom_row_warp_1 = warp[-9, mid_col]
    
    print(f"  Bottom edge warp[-1, {mid_col}]: {bottom_row_warp}")
    print(f"  Bottom edge warp[-9, {mid_col}]: {bottom_row_warp_1}")

# Check all tests
for test in ['zelda-poster-3', 'thing-1', 'zelda-poster-1']:
    check_edges(test)
