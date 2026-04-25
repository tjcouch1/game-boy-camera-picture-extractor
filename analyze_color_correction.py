#!/usr/bin/env python3
"""
Analyze color correction issues in the corrected images.
This script examines specific frame pixels to see if colors match the target palette.
"""
import cv2
import numpy as np
from pathlib import Path

# Target palette colors (what the frame should be)
TARGET_COLORS = {
    "WH": (255, 255, 165),   # #FFFFA5 - yellow/white
    "LG": (255, 148, 148),   # #FF9494 - light pink
    "DG": (148, 148, 255),   # #9494FF - dark blue
    "BK": (0, 0, 0),         # #000000 - black
}

# Frame structure:
# - 15-pixel white frame (#FFFFA5)
# - 1-pixel dark-gray border (#9494FF)
# Inside that is the camera area (128x112)

def analyze_image(img_path):
    """Analyze a corrected image for color accuracy."""
    img = cv2.imread(str(img_path))
    if img is None:
        print(f"Cannot read {img_path}")
        return
    
    # Convert BGR to RGB
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    
    print(f"\n{'='*80}")
    print(f"Analyzing: {img_path.name}")
    print(f"Image size: {w}x{h}")
    print(f"{'='*80}")
    
    # Test points: sample pixels from the frame region
    # Frame is at GB coordinates 0-15 (left), 144-159 (right), 0-15 (top), 128-143 (bottom)
    # In image pixels (with scale=8): 0-120, 1152-1280, 0-120, 1024-1152
    
    scale = 8
    test_points = {
        "top-left-yellow": (1 * scale, 1 * scale),      # Should be WH (#FFFFA5)
        "top-middle-yellow": (80 * scale, 1 * scale),
        "top-right-yellow": (159 * scale, 1 * scale),
        "left-yellow": (1 * scale, 70 * scale),
        "right-yellow": (159 * scale, 70 * scale),
        "bottom-left-yellow": (1 * scale, 143 * scale),
        "bottom-middle-yellow": (80 * scale, 143 * scale),
        "bottom-right-yellow": (159 * scale, 143 * scale),
        "inner-border-left": (16 * scale, 70 * scale),   # Should be DG (#9494FF)
        "inner-border-right": (143 * scale, 70 * scale),
        "inner-border-top": (80 * scale, 16 * scale),
        "inner-border-bottom": (80 * scale, 127 * scale),
    }
    
    print("\nFrame color samples:")
    print(f"{'Location':<30} {'Actual RGB':<25} {'Target':<25} {'Match?':<10}")
    print("-" * 90)
    
    for label, (x, y) in test_points.items():
        if 0 <= y < h and 0 <= x < w:
            actual = tuple(img_rgb[y, x])
            target_name = "WH" if "yellow" in label else "DG"
            target = TARGET_COLORS[target_name]
            
            # Calculate color distance
            dist = np.sqrt(sum((a - t) ** 2 for a, t in zip(actual, target)))
            match = "OK" if dist < 30 else "FAIL" if dist > 60 else "WARN"
            
            print(f"{label:<30} {str(actual):<25} {str(target):<25} {match:<10} (d={dist:.1f})")
    
    # Also check overall frame statistics
    print("\n" + "="*80)
    print("Frame region statistics (GB pixels 0-15 on all sides):")
    print("-" * 80)
    
    # Extract frame regions
    frame_top = img_rgb[0:16*scale, :, :]
    frame_bottom = img_rgb[(128+16)*scale:, :, :]
    frame_left = img_rgb[:, 0:16*scale, :]
    frame_right = img_rgb[:, (128+16)*scale:, :]
    
    regions = {
        "Top": frame_top,
        "Bottom": frame_bottom,
        "Left": frame_left,
        "Right": frame_right,
    }
    
    for name, region in regions.items():
        if region.size > 0:
            mean_rgb = region.reshape(-1, 3).mean(axis=0)
            target = TARGET_COLORS["WH"]
            dist = np.sqrt(sum((m - t) ** 2 for m, t in zip(mean_rgb, target)))
            print(f"{name:<15} Mean RGB: {tuple(mean_rgb.astype(int))} Target: {target} Distance: {dist:.1f}")
    
    # Check inner border
    print("\nInner border statistics (GB pixel row/col 15 and 128 on opposite sides):")
    print("-" * 80)
    
    border_left = img_rgb[:, 15*scale:17*scale, :]
    border_right = img_rgb[:, (128+15)*scale:(128+17)*scale, :]
    border_top = img_rgb[15*scale:17*scale, :, :]
    border_bottom = img_rgb[(128+15)*scale:(128+17)*scale, :, :]
    
    borders = {
        "Left border": border_left,
        "Right border": border_right,
        "Top border": border_top,
        "Bottom border": border_bottom,
    }
    
    for name, border in borders.items():
        if border.size > 0:
            mean_rgb = border.reshape(-1, 3).mean(axis=0)
            target = TARGET_COLORS["DG"]
            dist = np.sqrt(sum((m - t) ** 2 for m, t in zip(mean_rgb, target)))
            print(f"{name:<15} Mean RGB: {tuple(mean_rgb.astype(int))} Target: {target} Distance: {dist:.1f}")


def main():
    # Find all test output corrected images
    test_dir = Path("test-output")
    corrected_images = sorted(test_dir.glob("*/*_correct.png"))
    
    if not corrected_images:
        print("No corrected images found in test-output/*/*_correct.png")
        return
    
    # Just analyze zelda-poster-3 for now
    for img_path in corrected_images:
        if "zelda-poster-3" in str(img_path):
            analyze_image(img_path)


if __name__ == "__main__":
    main()
