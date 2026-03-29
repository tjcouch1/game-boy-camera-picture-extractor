#!/usr/bin/env python3
"""
Analyze the actual border positions in the warp output vs reference images.
This helps us understand how much the edge detection is off per image.
"""

import os
import sys
import cv2
import numpy as np
from pathlib import Path

def analyze_border_match(warp_img, ref_img, scale=8):
    """
    Compare the borders of the warp output with the reference image.
    Find where they differ horizontally and vertically.
    
    Returns (top_diff, bottom_diff, left_diff, right_diff) in source-pixels
    where positive means warp is too far inward.
    """
    H, W = warp_img.shape[:2]
    ref_H, ref_W = ref_img.shape[:2]
    
    assert H == ref_H and W == ref_W, f"Size mismatch: {H}x{W} vs {ref_H}x{ref_W}"
    
    # For Game Boy Camera images:
    # - Outer edge is white frame (#FFFFA5)
    # - Then 1px blue border (#9494FF) 
    # - Then actual camera content
    # The reference has it correctly positioned.
    
    # Convert to RGB for easier color checking
    warp_rgb = cv2.cvtColor(warp_img, cv2.COLOR_BGR2RGB).astype(np.float32)
    ref_rgb = cv2.cvtColor(ref_img, cv2.COLOR_BGR2RGB).astype(np.float32)
    
    # Expected frame color: white #FFFFA5 = (165, 255, 255) in BGR or (255, 255, 165) in RGB
    FRAME_COLOR = np.array([255, 255, 165], dtype=np.float32)
    TOLERANCE = 30
    
    def find_first_non_frame_row(img, start_row, direction=1):
        """Find first row that's not mostly frame color."""
        for row in range(start_row, img.shape[0], direction):
            row_color = img[row, :, :].mean(axis=0)
            if np.linalg.norm(row_color - FRAME_COLOR) > TOLERANCE:
                return row
        return start_row
    
    def find_first_non_frame_col(img, start_col, direction=1):
        """Find first col that's not mostly frame color."""
        for col in range(start_col, img.shape[1], direction):
            col_color = img[:, col, :].mean(axis=0)
            if np.linalg.norm(col_color - FRAME_COLOR) > TOLERANCE:
                return col
        return start_col
    
    # Find frame edges in reference (this should be ground truth)
    ref_top = find_first_non_frame_row(ref_rgb, 0, direction=1)
    ref_bottom = find_first_non_frame_row(ref_rgb, ref_H - 1, direction=-1)
    ref_left = find_first_non_frame_col(ref_rgb, 0, direction=1)
    ref_right = find_first_non_frame_col(ref_rgb, ref_W - 1, direction=-1)
    
    # Find frame edges in warp output
    warp_top = find_first_non_frame_row(warp_rgb, 0, direction=1)
    warp_bottom = find_first_non_frame_row(warp_rgb, H - 1, direction=-1)
    warp_left = find_first_non_frame_col(warp_rgb, 0, direction=1)
    warp_right = find_first_non_frame_col(warp_rgb, W - 1, direction=-1)
    
    # Convert pixel differences to source-pixels (1/scale units)
    top_diff = (warp_top - ref_top) / scale
    bottom_diff = (ref_bottom - warp_bottom) / scale  # Inverted: positive = too high
    left_diff = (warp_left - ref_left) / scale
    right_diff = (ref_right - warp_right) / scale      # Inverted: positive = too far left
    
    return {
        'top': top_diff,
        'bottom': bottom_diff,
        'left': left_diff,
        'right': right_diff,
        'warp_coords': (warp_top, warp_bottom, warp_left, warp_right),
        'ref_coords': (ref_top, ref_bottom, ref_left, ref_right),
    }


def main():
    test_output_dir = Path("test-output")
    test_input_dir = Path("test-input")
    
    # Find all test cases
    test_cases = []
    for test_dir in test_output_dir.iterdir():
        if not test_dir.is_dir():
            continue
        test_name = test_dir.name
        
        # Find corresponding warp and reference image
        warp_path = test_dir / f"{test_name}_warp.png"
        if not warp_path.exists():
            continue
        
        # Reference should be in test-input
        # thing-1, thing-2, thing-3 all use thing-output-corrected.png
        # zelda-poster-1, zelda-poster-2, zelda-poster-3 all use zelda-poster-output-corrected.png
        if test_name.startswith("thing"):
            ref_path = test_input_dir / "thing-output-corrected.png"
        elif test_name.startswith("zelda"):
            ref_path = test_input_dir / "zelda-poster-output-corrected.png"
        else:
            print(f"Unknown test prefix: {test_name}")
            continue
        
        if not ref_path.exists():
            print(f"Warning: No reference found for {test_name}: {ref_path}")
            continue
        
        test_cases.append((test_name, warp_path, ref_path))
    
    print("\n" + "="*70)
    print("EDGE POSITION ANALYSIS")
    print("="*70)
    print()
    print(f"{'Test Case':<20} {'Top':>10} {'Bottom':>10} {'Left':>10} {'Right':>10}")
    print(f"{'':20} {'(px)':>10} {'(px)':>10} {'(px)':>10} {'(px)':>10}")
    print("-" * 70)
    
    for test_name, warp_path, ref_path in sorted(test_cases):
        warp = cv2.imread(str(warp_path))
        ref = cv2.imread(str(ref_path))
        
        if warp is None or ref is None:
            print(f"Error loading {test_name}")
            continue
        
        result = analyze_border_match(warp, ref, scale=8)
        
        print(f"{test_name:<20} "
              f"{result['top']:>10.2f} "
              f"{result['bottom']:>10.2f} "
              f"{result['left']:>10.2f} "
              f"{result['right']:>10.2f}")
    
    print()
    print("="*70)
    print("Interpretation:")
    print("  Positive values = border is too inward (missing content)")
    print("  Negative values = border is too outward (including frame)")
    print("="*70)


if __name__ == "__main__":
    main()
