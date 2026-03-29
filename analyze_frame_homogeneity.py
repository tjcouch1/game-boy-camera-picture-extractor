#!/usr/bin/env python3
"""
Create a calibration function that measures frame color homogeneity to detect border position errors.

The frame should be uniformly #FFFFA5 (white) except for the dashes. If the detected borders
are wrong, the frame will have color variations or the dashes will be misaligned.
"""

import cv2
import numpy as np
from pathlib import Path

def analyze_frame_homogeneity(warp_img, scale=8):
    """
    Analyze the frame appearance to detect if borders are positioned correctly.
    
    The frame should be approximately uniform #FFFFA5 (white) except for dashes.
    If borders are off, the frame will show:
    - Incorrect colors at edges
    - Dashes that aren't straight/aligned
    
    Returns a dict with measurements of frame quality.
    """
    H, W = warp_img.shape[:2]
    rgb = cv2.cvtColor(warp_img, cv2.COLOR_BGR2RGB).astype(np.float32)
    
    # Expected white frame color: #FFFFA5
    EXPECTED = np.array([255, 255, 165], dtype=np.float32)
    
    # Sample frame regions (1 scale unit = 8 pixels, frame is 1-2 scale units wide)
    frame_thickness = 2 * scale  # 16 pixels
    
    # Top frame
    top_frame = rgb[:frame_thickness, :, :]
    top_avg = top_frame.mean(axis=(0, 1))
    top_error = np.linalg.norm(top_avg - EXPECTED)
    
    # Bottom frame
    bot_frame = rgb[-frame_thickness:, :, :]
    bot_avg = bot_frame.mean(axis=(0, 1))
    bot_error = np.linalg.norm(bot_avg - EXPECTED)
    
    # Left frame
    left_frame = rgb[:, :frame_thickness, :]
    left_avg = left_frame.mean(axis=(0, 1))
    left_error = np.linalg.norm(left_avg - EXPECTED)
    
    # Right frame
    right_frame = rgb[:, -frame_thickness:, :]
    right_avg = right_frame.mean(axis=(0, 1))
    right_error = np.linalg.norm(right_avg - EXPECTED)
    
    # Check line straightness - look at where dashes should be
    # Dashes are horizontal on top/bottom edges, ~4 scale units (32px) from top/bottom
    dash_offset = 4 * scale  # 32 pixels
    
    # Look for vertical variation in the dash row (should be minimal)
    dash_row_top = int(dash_offset)
    if dash_row_top < H:
        top_dash_row = rgb[dash_row_top, :, :].mean(axis=1)
        top_dash_variation = np.std(top_dash_row)
    else:
        top_dash_variation = 0
    
    dash_row_bot = int(H - dash_offset)
    if dash_row_bot >= 0:
        bot_dash_row = rgb[dash_row_bot, :, :].mean(axis=1)
        bot_dash_variation = np.std(bot_dash_row)
    else:
        bot_dash_variation = 0
    
    return {
        'top_frame_error': top_error,
        'bottom_frame_error': bot_error,
        'left_frame_error': left_error,
        'right_frame_error': right_error,
        'top_dash_variation': top_dash_variation,
        'bottom_dash_variation': bot_dash_variation,
        'top_frame_avg': top_avg,
        'bottom_frame_avg': bot_avg,
    }

def main():
    test_output_dir = Path("test-output")
    
    print("\n" + "="*90)
    print("FRAME HOMOGENEITY ANALYSIS (Lower is better)")
    print("="*90)
    print()
    print(f"{'Test':<20} {'Top Frame':>15} {'Bot Frame':>15} {'Left Frame':>15} {'Right Frame':>15}")
    print(f"{'':20} {'Error':>15} {'Error':>15} {'Error':>15} {'Error':>15}")
    print("-" * 90)
    
    for test_dir in sorted(test_output_dir.iterdir()):
        if not test_dir.is_dir() or test_dir.name.endswith('-debug') or test_dir.name.endswith('-final'):
            continue
        
        test_name = test_dir.name
        warp_path = test_dir / f"{test_name}_warp.png"
        
        if not warp_path.exists():
            continue
        
        warp = cv2.imread(str(warp_path))
        if warp is None:
            continue
        
        analysis = analyze_frame_homogeneity(warp, scale=8)
        
        print(f"{test_name:<20} "
              f"{analysis['top_frame_error']:>15.2f} "
              f"{analysis['bottom_frame_error']:>15.2f} "
              f"{analysis['left_frame_error']:>15.2f} "
              f"{analysis['right_frame_error']:>15.2f}")
    
    print()
    print("="*90)
    print("Analysis: Frame color errors indicate border position accuracy.")
    print("Frame colors should be close to white #FFFFA5 if borders are correctly placed.")
    print("="*90)

if __name__ == "__main__":
    main()
