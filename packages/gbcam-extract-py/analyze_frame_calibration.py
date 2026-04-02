#!/usr/bin/env python3
"""
Analyze frame color calibration data.

For each frame region (yellow, red, blue, black), sample the current colors
and compare to the target colors. Build a mapping of spatial location to
color transformation needed.
"""
import numpy as np
import cv2
from pathlib import Path
from gbcam_common import SCREEN_W, SCREEN_H, FRAME_THICK, INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT, log

# Target RGB colors from frame_ascii
FRAME_TARGETS = {
    'yellow': np.array([255.0, 255.0, 165.0]),  # space in frame_ascii
    'red': np.array([255.0, 148.0, 148.0]),     # · in frame_ascii
    'blue': np.array([148.0, 148.0, 255.0]),    # ▓ in frame_ascii
    'black': np.array([0.0, 0.0, 0.0]),         # █ in frame_ascii
}

def _load_frame_ascii():
    """Load frame_ascii.txt and return a 160×144 character grid with color indices."""
    frame_path = Path(__file__).resolve().parent.parent.parent / 'supporting-materials' / 'frame_ascii.txt'
    if not frame_path.exists():
        return None
    try:
        with open(frame_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        frame = []
        for line in lines:
            line = line.rstrip('\n\r')
            row = []
            for char in line:
                if char == ' ':
                    row.append(0)  # yellow
                elif char == '·':
                    row.append(1)  # red
                elif char == '▓':
                    row.append(2)  # blue
                elif char == '█':
                    row.append(3)  # black
                else:
                    row.append(0)  # default to yellow
            if len(row) == SCREEN_W:
                frame.append(row)
        if len(frame) == SCREEN_H:
            return frame
    except Exception as e:
        print(f"Error loading frame_ascii: {e}")
    return None

def analyze_frame_colors(warp_path):
    """
    Analyze the frame colors in the warp image and determine needed transformations.
    """
    print(f"\nAnalyzing frame colors in: {warp_path}")
    
    # Load warp image
    bgr = cv2.imread(str(warp_path))
    if bgr is None:
        print(f"  ERROR: Could not load {warp_path}")
        return None
    
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    scale = 8  # assuming standard scale
    
    # Load frame_ascii
    frame = _load_frame_ascii()
    if frame is None:
        print("  ERROR: Could not load frame_ascii.txt")
        return None
    
    # Sample frame colors at different locations
    color_names = {0: 'yellow', 1: 'red', 2: 'blue', 3: 'black'}
    results = {
        'yellow': {'current': [], 'target': FRAME_TARGETS['yellow'], 'positions': []},
        'red': {'current': [], 'target': FRAME_TARGETS['red'], 'positions': []},
        'blue': {'current': [], 'target': FRAME_TARGETS['blue'], 'positions': []},
        'black': {'current': [], 'target': FRAME_TARGETS['black'], 'positions': []},
    }
    
    # Sample the frame at regular intervals
    for gy in range(SCREEN_H):
        for gx in range(SCREEN_W):
            color_idx = frame[gy][gx]
            color_name = color_names[color_idx]
            
            # Sample center of GB block
            y_center = gy * scale + scale // 2
            x_center = gx * scale + scale // 2
            
            if 0 <= y_center < rgb.shape[0] and 0 <= x_center < rgb.shape[1]:
                sampled_color = rgb[y_center, x_center, :]
                results[color_name]['current'].append(sampled_color)
                results[color_name]['positions'].append((gy, gx))
    
    # Analyze each color
    print(f"\n{'='*80}")
    print("FRAME COLOR ANALYSIS")
    print(f"{'='*80}")
    
    calibration_data = {}
    
    for color_name in ['yellow', 'red', 'blue', 'black']:
        data = results[color_name]
        if not data['current']:
            print(f"\n{color_name.upper()}: No samples found")
            continue
        
        current = np.array(data['current'])
        target = data['target']
        
        # Compute statistics
        mean_current = np.mean(current, axis=0)
        std_current = np.std(current, axis=0)
        delta = target - mean_current
        
        print(f"\n{color_name.upper()}:")
        print(f"  Target RGB:      {tuple(target)}")
        print(f"  Current mean:    {tuple(mean_current)}")
        print(f"  Current std:     {tuple(std_current)}")
        print(f"  Delta (target-current): {tuple(delta)}")
        print(f"  Samples: {len(current)}")
        
        # Show spatial variation
        if len(current) > 1:
            current_min = np.min(current, axis=0)
            current_max = np.max(current, axis=0)
            print(f"  Current range:   R [{current_min[0]:.1f}-{current_max[0]:.1f}]  "
                  f"G [{current_min[1]:.1f}-{current_max[1]:.1f}]  "
                  f"B [{current_min[2]:.1f}-{current_max[2]:.1f}]")
        
        # Store for later use
        calibration_data[color_name] = {
            'mean': mean_current,
            'target': target,
            'delta': delta,
            'positions': data['positions'],
            'current': current,
        }
    
    # Analyze spatial patterns - see if color variation correlates with position
    print(f"\n{'='*80}")
    print("SPATIAL PATTERN ANALYSIS")
    print(f"{'='*80}")
    
    for color_name in ['yellow', 'red', 'blue', 'black']:
        if color_name not in calibration_data:
            continue
        
        data = calibration_data[color_name]
        positions = np.array(data['positions'])
        current = data['current']
        
        if len(positions) < 2:
            continue
        
        # Correlation between position and color
        gy_vals = positions[:, 0]
        gx_vals = positions[:, 1]
        
        for ch_idx, ch_name in enumerate(['R', 'G', 'B']):
            corr_y = np.corrcoef(gy_vals, current[:, ch_idx])[0, 1]
            corr_x = np.corrcoef(gx_vals, current[:, ch_idx])[0, 1]
            print(f"{color_name} {ch_name}: corr_y={corr_y:.3f} corr_x={corr_x:.3f}")
    
    return calibration_data

def main():
    import sys
    
    if len(sys.argv) > 1:
        warp_path = sys.argv[1]
    else:
        # Use a test image
        _repo_root = str(Path(__file__).resolve().parent.parent.parent)
        warp_path = _repo_root + "/test-output/zelda-poster-3/zelda-poster-3_warp.png"
    
    result = analyze_frame_colors(warp_path)
    
    if result:
        print(f"\n{'='*80}")
        print("Calibration data collected successfully")
        print(f"{'='*80}")

if __name__ == "__main__":
    main()
