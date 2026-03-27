#!/usr/bin/env python3
"""
Test whether uniform global color correction helps.
Instead of spatial polynomial, just apply mean delta to camera area.
"""
import sys
import numpy as np
import cv2
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gbcam_common import INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT, SCREEN_H, SCREEN_W

def test_uniform_delta():
    """Test if uniform global color correction works better."""
    
    # Load warped image
    input_path = "test-output/zelda-poster-3/zelda-poster-3_warp.png"
    img_bgr = cv2.imread(input_path)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    H, W = img_rgb.shape[:2]
    scale = 8
    
    # Load frame_ascii
    frame_ascii_path = "supporting-materials/frame_ascii.txt"
    with open(frame_ascii_path, 'r', encoding='utf-8') as f:
        frame_lines = f.readlines()
    
    frame = []
    for line in frame_lines:
        row = []
        for ch in line.rstrip('\n'):
            if ch == ' ':
                row.append(0)  # yellow
            elif ch == '·':
                row.append(1)  # red
            elif ch == '▓':
                row.append(2)  # blue
            elif ch == '█':
                row.append(3)  # black
        if len(row) > 0:
            frame.append(row)
    
    print(f"Frame shape: {len(frame)} x {len(frame[0])}")
    
    # Target colors
    FRAME_TARGETS = {
        0: np.array([255., 255., 165.]),  # yellow
        1: np.array([255., 148., 148.]),  # red
        2: np.array([148., 148., 255.]),  # blue
        3: np.array([0., 0., 0.]),        # black
    }
    
    # Compute mean delta for yellow pixels only
    deltas = []
    for gy in range(SCREEN_H):
        for gx in range(SCREEN_W):
            if frame[gy][gx] == 0:  # yellow
                y_center = gy * scale + scale // 2
                x_center = gx * scale + scale // 2
                
                if 0 <= y_center < H and 0 <= x_center < W:
                    current = img_rgb[y_center, x_center, :]
                    target = FRAME_TARGETS[0]  # yellow
                    delta = target - current
                    deltas.append(delta)
    
    deltas = np.array(deltas)
    mean_delta = deltas.mean(axis=0)
    
    print(f"\nYellow pixel deltas:")
    print(f"  Mean delta: {mean_delta}")
    print(f"  Std:  {deltas.std(axis=0)}")
    print(f"  Min:  {deltas.min(axis=0)}")
    print(f"  Max:  {deltas.max(axis=0)}")
    
    # Apply uniform delta to camera area
    img_corrected = img_rgb.copy()
    
    cam_y_start = INNER_TOP * scale
    cam_y_end = (INNER_BOT + 1) * scale
    cam_x_start = INNER_LEFT * scale
    cam_x_end = (INNER_RIGHT + 1) * scale
    
    print(f"\nCamera area: y=[{cam_y_start}, {cam_y_end}), x=[{cam_x_start}, {cam_x_end})")
    
    # Apply mean delta to camera area
    img_corrected[cam_y_start:cam_y_end, cam_x_start:cam_x_end, :] = np.clip(
        img_corrected[cam_y_start:cam_y_end, cam_x_start:cam_x_end, :] + mean_delta[None, None, :],
        0, 255
    )
    
    # Save output
    output_path = "test-output/zelda-poster-3-uniform-delta.png"
    img_corrected_uint8 = img_corrected.astype(np.uint8)
    img_corrected_bgr = cv2.cvtColor(img_corrected_uint8, cv2.COLOR_RGB2BGR)
    cv2.imwrite(output_path, img_corrected_bgr)
    
    print(f"\nSaved corrected image to {output_path}")
    
    # Show some samples before/after
    print(f"\nSample camera pixels before/after:")
    test_coords = [(80, 80), (80, 90), (90, 80), (90, 90)]
    for gy, gx in test_coords:
        y_px = gy * scale + scale // 2
        x_px = gx * scale + scale // 2
        before = img_rgb[y_px, x_px, :].astype(np.uint8)
        after = img_corrected[y_px, x_px, :].astype(np.uint8)
        print(f"  ({gy:3d}, {gx:3d}): {tuple(before)} -> {tuple(after)}")

if __name__ == '__main__':
    test_uniform_delta()
