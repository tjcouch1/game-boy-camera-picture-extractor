#!/usr/bin/env python3
"""
Analyze specific WH vs LG pixels to understand why they're being confused.
Look at actual RGB colors in the corrected image to see if the colors are close to expected.
"""
import sys
import numpy as np
import cv2
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gbcam_common import INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT, SCREEN_H, SCREEN_W

def analyze_wh_lg_confusion(corrected_png_path, reference_png_path, scale=8):
    """Analyze WH vs LG pixel color values."""
    
    print(f"\n{'='*70}")
    print(f"ANALYZING WH/LG CONFUSION")
    print(f"{'='*70}\n")
    
    # Load images
    img_corrected_bgr = cv2.imread(str(corrected_png_path))
    img_reference_bgr = cv2.imread(str(reference_png_path))
    
    if img_corrected_bgr is None:
        print(f"ERROR: Could not load {corrected_png_path}")
        return
    if img_reference_bgr is None:
        print(f"ERROR: Could not load {reference_png_path}")
        return
    
    img_corrected_rgb = cv2.cvtColor(img_corrected_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    img_reference_rgb = cv2.cvtColor(img_reference_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    
    # Color definitions
    WH_target = np.array([255, 255, 165], dtype=np.uint8)
    LG_target = np.array([255, 148, 148], dtype=np.uint8)
    
    # Find which pixels are being classified as WH vs LG in corrected image
    print(f"\nTarget colors:")
    print(f"  WH (white): {WH_target}")
    print(f"  LG (light red): {LG_target}")
    
    # Sample some pixels from the corrected image and see their actual RGB values
    print(f"\nSampling pixels from corrected image (GB coordinates):")
    
    test_coords = [
        (15, 30), (15, 80), (50, 30), (50, 80), (100, 30), (100, 80),  # Frame area
        (80, 80), (80, 90), (90, 80), (90, 90),  # Camera area
    ]
    
    for gy, gx in test_coords:
        if 0 <= gy < SCREEN_H and 0 <= gx < SCREEN_W:
            # Get GB pixel (center)
            y_center = gy * scale + scale // 2
            x_center = gx * scale + scale // 2
            
            # Reference is already at 1:1 scale
            ref_y = gy
            ref_x = gx
            
            if y_center < img_corrected_rgb.shape[0] and x_center < img_corrected_rgb.shape[1]:
                corrected_rgb = img_corrected_rgb[y_center, x_center, :].astype(np.uint8)
            else:
                corrected_rgb = np.array([0, 0, 0], dtype=np.uint8)
            
            if ref_y < img_reference_rgb.shape[0] and ref_x < img_reference_rgb.shape[1]:
                reference_rgb = img_reference_rgb[ref_y, ref_x, :].astype(np.uint8)
            else:
                reference_rgb = np.array([0, 0, 0], dtype=np.uint8)
            
            # Compute distances to WH and LG
            dist_to_wh = np.linalg.norm(corrected_rgb.astype(float) - WH_target.astype(float))
            dist_to_lg = np.linalg.norm(corrected_rgb.astype(float) - LG_target.astype(float))
            
            classified = "WH" if dist_to_wh < dist_to_lg else "LG"
            
            print(f"  ({gy:3d}, {gx:3d}): RGB={tuple(corrected_rgb)}, "
                  f"d_to_WH={dist_to_wh:.1f}, d_to_LG={dist_to_lg:.1f} -> {classified} "
                  f"(ref: {tuple(reference_rgb)})")
    
    # Analyze frame area specifically
    print(f"\nAnalyzing frame outer edge (should be all WH):")
    frame_samples = []
    for gx in range(0, SCREEN_W, 20):
        y_center = 7 * scale + scale // 2  # Row 7 (outer frame)
        x_center = gx * scale + scale // 2
        
        rgb = img_corrected_rgb[y_center, x_center, :].astype(np.uint8)
        dist_wh = np.linalg.norm(rgb.astype(float) - WH_target.astype(float))
        dist_lg = np.linalg.norm(rgb.astype(float) - LG_target.astype(float))
        classified = "WH" if dist_wh < dist_lg else "LG"
        frame_samples.append({
            'gx': gx, 'rgb': rgb, 'dist_wh': dist_wh, 'dist_lg': dist_lg, 'classified': classified
        })
        print(f"  gx={gx:3d}: RGB={tuple(rgb)}, d_WH={dist_wh:5.1f}, d_LG={dist_lg:5.1f} -> {classified}")
    
    # Show some camera area pixels
    print(f"\nAnalyzing camera area (should be mixed):")
    camera_samples = []
    for gy in range(INNER_TOP + 20, INNER_BOT - 20, 30):
        for gx in range(INNER_LEFT + 20, INNER_RIGHT - 20, 30):
            y_center = gy * scale + scale // 2
            x_center = gx * scale + scale // 2
            
            corrected_rgb = img_corrected_rgb[y_center, x_center, :].astype(np.uint8)
            reference_rgb = img_reference_rgb[y_center, x_center, :].astype(np.uint8)
            
            dist_wh = np.linalg.norm(corrected_rgb.astype(float) - WH_target.astype(float))
            dist_lg = np.linalg.norm(corrected_rgb.astype(float) - LG_target.astype(float))
            classified = "WH" if dist_wh < dist_lg else "LG"
            camera_samples.append({
                'gy': gy, 'gx': gx, 'rgb': corrected_rgb, 'ref': reference_rgb,
                'dist_wh': dist_wh, 'dist_lg': dist_lg, 'classified': classified
            })
            print(f"  ({gy:3d}, {gx:3d}): corrected={tuple(corrected_rgb)}, "
                  f"ref={tuple(reference_rgb)}, "
                  f"d_WH={dist_wh:5.1f}, d_LG={dist_lg:5.1f} -> {classified}")
    
    print(f"\n{'='*70}\n")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        # Default to zelda-poster-3
        corrected = "test-output/zelda-poster-3-test-fix/zelda-poster-3_correct.png"
        reference = "test-input/zelda-poster-output-corrected.png"
    else:
        corrected = sys.argv[1]
        reference = sys.argv[2]
    
    analyze_wh_lg_confusion(corrected, reference)
