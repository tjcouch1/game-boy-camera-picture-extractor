#!/usr/bin/env python3
"""
Frame color validation and diagnostic utility for the correction step.

Reads frame_ascii.txt to identify expected colors, then provides functions
to validate and correct frame color issues.
"""

import numpy as np
from pathlib import Path

# Frame structure
SCREEN_W, SCREEN_H = 160, 144
FRAME_THICK = 16

# Target palette colors (RGB)
PALETTE_RGB = {
    ' ': np.array([255.0, 255.0, 165.0], dtype=np.float32),  # #FFFFA5 - yellow (light)
    '·': np.array([255.0, 148.0, 148.0], dtype=np.float32),  # #FF9494 - red/pink
    '▓': np.array([148.0, 148.0, 255.0], dtype=np.float32),  # #9494FF - dark blue/purple
    '█': np.array([0.0, 0.0, 0.0], dtype=np.float32),       # #000000 - black
}

# Character map
CHAR_TO_COLOR = {
    ' ': (255, 255, 165),
    '·': (255, 148, 148),
    '▓': (148, 148, 255),
    '█': (0, 0, 0),
}


class FrameASCII:
    """Load and query frame_ascii.txt for expected colors at GB pixels."""
    
    def __init__(self, ascii_file='supporting-materials/frame_ascii.txt'):
        self.frame = None
        self.load(ascii_file)
    
    def load(self, ascii_file):
        """Load frame_ascii.txt and parse it."""
        try:
            with open(ascii_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except FileNotFoundError:
            # Try relative path
            try:
                with open(Path('supporting-materials') / 'frame_ascii.txt', 'r', encoding='utf-8') as f:
                    lines = f.readlines()
            except FileNotFoundError:
                print(f"Warning: Could not find {ascii_file}")
                self.frame = None
                return
        
        # Pad/trim to exactly 144 lines
        lines = lines[:SCREEN_H]
        
        frame = []
        for line in lines:
            row = []
            for ch in line:
                if ch in PALETTE_RGB:
                    row.append(ch)
                elif ch == '\n':
                    break
            # Pad to 160 pixels
            while len(row) < SCREEN_W:
                row.append(' ')
            frame.append(row[:SCREEN_W])
        
        self.frame = frame
    
    def get_color_at(self, gy, gx):
        """Get expected RGB color at GB pixel (gy, gx)."""
        if self.frame is None or gy < 0 or gy >= len(self.frame) or gx < 0 or gx >= len(self.frame[gy]):
            return None
        ch = self.frame[gy][gx]
        return PALETTE_RGB.get(ch, None), ch
    
    def get_frame_colors(self):
        """Get all frame pixel locations and their expected colors."""
        frame_pixels = []
        for gy in range(SCREEN_H):
            for gx in range(SCREEN_W):
                if gy < FRAME_THICK or gy >= SCREEN_H - FRAME_THICK or gx < FRAME_THICK or gx >= SCREEN_W - FRAME_THICK:
                    color_rgb, ch = self.get_color_at(gy, gx)
                    if color_rgb is not None:
                        frame_pixels.append((gy, gx, color_rgb, ch))
        return frame_pixels


def validate_frame_colors(corrected_rgb, scale, frame_ascii=None):
    """
    Validate and report on frame color uniformity.
    
    Parameters:
        corrected_rgb: (H, W, 3) float32 RGB image
        scale: pixels per GB pixel
        frame_ascii: FrameASCII instance (loads if None)
    
    Returns:
        dict with validation statistics
    """
    if frame_ascii is None:
        frame_ascii = FrameASCII()
    
    if frame_ascii.frame is None:
        return None
    
    results = {
        'channel_stats': {},
        'color_errors': {},
        'by_region': {}
    }
    
    # Collect all frame pixel samples
    frame_samples = {' ': [], '·': [], '▓': [], '█': []}
    
    for gy in range(SCREEN_H):
        for gx in range(SCREEN_W):
            if gy < FRAME_THICK or gy >= SCREEN_H - FRAME_THICK or gx < FRAME_THICK or gx >= SCREEN_W - FRAME_THICK:
                color_rgb, ch = frame_ascii.get_color_at(gy, gx)
                if color_rgb is not None:
                    # Sample the actual color at this GB pixel
                    y1, y2 = gy * scale, (gy + 1) * scale
                    x1, x2 = gx * scale, (gx + 1) * scale
                    if y2 <= corrected_rgb.shape[0] and x2 <= corrected_rgb.shape[1]:
                        block = corrected_rgb[y1:y2, x1:x2, :]
                        actual_color = np.median(block, axis=(0, 1))
                        frame_samples[ch].append((gy, gx, actual_color))
    
    # Analyze each color
    for ch, samples in frame_samples.items():
        if not samples:
            continue
        
        samples_array = np.array([s[2] for s in samples])
        expected = PALETTE_RGB[ch]
        
        # Per-channel stats
        for c_idx, c_name in enumerate(['R', 'G', 'B']):
            if ch not in results['channel_stats']:
                results['channel_stats'][ch] = {}
            vals = samples_array[:, c_idx]
            results['channel_stats'][ch][c_name] = {
                'mean': float(np.mean(vals)),
                'std': float(np.std(vals)),
                'min': float(np.min(vals)),
                'max': float(np.max(vals)),
                'expected': float(expected[c_idx]),
                'error': float(np.mean(np.abs(vals - expected[c_idx])))
            }
        
        # Color error
        color_errors = np.linalg.norm(samples_array - expected, axis=1)
        results['color_errors'][ch] = {
            'mean_error': float(np.mean(color_errors)),
            'std_error': float(np.std(color_errors)),
            'max_error': float(np.max(color_errors)),
            'n_samples': len(samples)
        }
    
    return results


if __name__ == '__main__':
    frame = FrameASCII()
    print("Frame ASCII loaded successfully" if frame.frame else "Failed to load frame ASCII")
    if frame.frame:
        print(f"Frame dimensions: {len(frame.frame)}x{len(frame.frame[0])}")
        # Sample a few colors
        for gy, gx in [(5, 5), (70, 70), (140, 140)]:
            color, ch = frame.get_color_at(gy, gx)
            print(f"  ({gx}, {gy}): {ch} -> RGB={tuple(color)}")
