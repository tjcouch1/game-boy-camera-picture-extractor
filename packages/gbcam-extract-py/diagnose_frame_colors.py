#!/usr/bin/env python3
"""
Diagnose frame colors in _correct.png output.

Reads frame_ascii.txt to identify where each color should be, then samples
the actual colors at those locations and displays statistics.
"""

import cv2
import numpy as np
from pathlib import Path
import sys

# Target colors in RGB
PALETTE = {
    ' ': (165, 165, 255),   # #FFFFA5 - yellow (light)
    '·': (148, 148, 255),   # #FF9494 - red/pink
    '▓': (148, 148, 255),   # #9494FF - dark blue/purple
    '█': (0, 0, 0),         # #000000 - black
}

# Frame structure
FRAME_THICK = 16
SCREEN_W, SCREEN_H = 160, 144
INNER_LEFT = FRAME_THICK
INNER_RIGHT = SCREEN_W - FRAME_THICK - 1
INNER_TOP = FRAME_THICK
INNER_BOT = SCREEN_H - FRAME_THICK - 1


def read_frame_ascii():
    """Read frame_ascii.txt and return a 160x144 array of color characters."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    with open(repo_root / 'supporting-materials' / 'frame_ascii.txt', 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Pad/trim to exactly 144 lines
    lines = lines[:144]
    
    frame = []
    for line in lines:
        # Each character in the line represents a pixel
        row = []
        for ch in line:
            if ch in PALETTE:
                row.append(ch)
            elif ch == '\n':
                break
        # Pad to 160 pixels
        while len(row) < 160:
            row.append(' ')
        frame.append(row[:160])
    
    return frame


def sample_color_at_pixel(img, gy, gx, scale):
    """Sample the color at GB pixel (gy, gx) in the image."""
    y1 = gy * scale
    x1 = gx * scale
    y2 = min(y1 + scale, img.shape[0])
    x2 = min(x1 + scale, img.shape[1])
    
    if y2 <= y1 or x2 <= x1:
        return None
    
    block = img[y1:y2, x1:x2]
    # Return median color
    return tuple(float(np.median(block[:, :, ch])) for ch in range(3))


def diagnose_file(correct_png_path, scale=8):
    """Analyze frame colors in a _correct.png file."""
    print(f"\n{'='*80}")
    print(f"Diagnosing: {correct_png_path}")
    print(f"{'='*80}")
    
    # Read image
    img = cv2.imread(str(correct_png_path))
    if img is None:
        print(f"ERROR: Could not read {correct_png_path}")
        return False
    
    print(f"Image shape: {img.shape} (height, width, channels)")
    print(f"Expected shape: ({SCREEN_H * scale}, {SCREEN_W * scale}, 3)")
    
    # Read frame ASCII
    frame = read_frame_ascii()
    
    # Define test points for each color
    test_points = {
        '█': [(1, 6), (6, 70), (138, 6), (138, 70), (70, 1), (70, 138)],  # black corners and edges
        '▓': [(15, 15), (15, 144), (128, 15), (128, 144)],  # dark border
        ' ': [(132, 156), (5, 149), (5, 5), (155, 5)],  # light/yellow scattered
    }
    
    # Sample colors at test points
    results = {}
    for color_ch, points in test_points.items():
        color_name = [k for k, v in PALETTE.items() if v == PALETTE.get(color_ch)]
        print(f"\n{color_ch} (expected) - {color_name}")
        results[color_ch] = []
        for gy, gx in points:
            if 0 <= gy < SCREEN_H and 0 <= gx < SCREEN_W:
                expected_ch = frame[gy][gx] if gy < len(frame) and gx < len(frame[gy]) else '?'
                actual_color = sample_color_at_pixel(img, gy, gx, scale)
                if actual_color:
                    print(f"  ({gx:3d}, {gy:3d}): expected={expected_ch} actual_RGB={tuple(f'{c:.1f}' for c in actual_color)}")
                    results[color_ch].append(actual_color)
    
    # Analyze frame strips
    print(f"\n{'='*80}")
    print("Frame color uniformity analysis:")
    print(f"{'='*80}")
    
    # Sample top frame strip (light)
    top_colors = []
    for gx in range(0, SCREEN_W, 20):
        color = sample_color_at_pixel(img, 5, gx, scale)
        if color:
            top_colors.append(color)
            print(f"Top frame at x={gx:3d}: RGB={tuple(f'{c:.1f}' for c in color)}")
    
    # Sample bottom frame strip
    print()
    bottom_colors = []
    for gx in range(0, SCREEN_W, 20):
        color = sample_color_at_pixel(img, SCREEN_H - 5, gx, scale)
        if color:
            bottom_colors.append(color)
            print(f"Bottom frame at x={gx:3d}: RGB={tuple(f'{c:.1f}' for c in color)}")
    
    # Sample left frame strip
    print()
    left_colors = []
    for gy in range(0, SCREEN_H, 20):
        color = sample_color_at_pixel(img, gy, 5, scale)
        if color:
            left_colors.append(color)
            print(f"Left frame at y={gy:3d}: RGB={tuple(f'{c:.1f}' for c in color)}")
    
    # Sample right frame strip
    print()
    right_colors = []
    for gy in range(0, SCREEN_H, 20):
        color = sample_color_at_pixel(img, gy, SCREEN_W - 5, scale)
        if color:
            right_colors.append(color)
            print(f"Right frame at y={gy:3d}: RGB={tuple(f'{c:.1f}' for c in color)}")
    
    # Calculate variation
    print(f"\n{'='*80}")
    print("Color variation statistics:")
    print(f"{'='*80}")
    
    all_frames = [top_colors, bottom_colors, left_colors, right_colors]
    all_frame_colors = [c for colors in all_frames for c in colors]
    
    if all_frame_colors:
        colors_array = np.array(all_frame_colors)
        print(f"Frame colors (all strips):")
        for ch_idx, ch_name in enumerate(['R', 'G', 'B']):
            ch_vals = colors_array[:, ch_idx]
            print(f"  {ch_name}: min={ch_vals.min():.1f}, max={ch_vals.max():.1f}, "
                  f"mean={ch_vals.mean():.1f}, std={ch_vals.std():.1f}")
    
    return True


def main():
    # Find all _correct.png files in test-output
    repo_root = Path(__file__).resolve().parent.parent.parent
    test_output = repo_root / 'test-output'
    correct_files = list(test_output.rglob('*_correct.png'))

    if not correct_files:
        print("No _correct.png files found in test-output/")
        return
    
    for correct_file in sorted(correct_files):
        diagnose_file(correct_file)


if __name__ == '__main__':
    main()
