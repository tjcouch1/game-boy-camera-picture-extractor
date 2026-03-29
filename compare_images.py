#!/usr/bin/env python3
"""Compare image characteristics to understand why thing-1/thing-2 fail."""

import cv2
import numpy as np
from pathlib import Path

images = {
    "thing-1": "test-input/thing-1.jpg",
    "thing-2": "test-input/thing-2.jpg", 
    "thing-3": "test-input/thing-3.jpg",
    "zelda-1": "test-input/zelda-poster-1.jpg",
    "zelda-2": "test-input/zelda-poster-2.jpg",
    "zelda-3": "test-input/zelda-poster-3.jpg",
}

print("IMAGE CHARACTERISTICS ANALYSIS")
print("=" * 80)
print(f"{'Image':<12} {'Size':<12} {'Gray Min':<10} {'Gray Max':<10} {'Gray Mean':<10} {'Gray Std':<10}")
print("-" * 80)

for name, path in images.items():
    img = cv2.imread(path)
    if img is None:
        print(f"{name}: ERROR - file not found")
        continue
    
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    print(f"{name:<12} {W}x{H:<8} {gray.min():<10} {gray.max():<10} {gray.mean():<10.1f} {gray.std():<10.1f}")

print("\nR-B CHANNEL ANALYSIS (for border detection)")
print("=" * 80)
print(f"{'Image':<12} {'RB Min':<10} {'RB Max':<10} {'RB Mean':<10} {'RB Std':<10} {'RB Range':<10}")
print("-" * 80)

for name, path in images.items():
    img = cv2.imread(path)
    if img is None:
        continue
    
    b, g, r = cv2.split(img)
    rb_ch = np.clip(r.astype(np.float32) - b.astype(np.float32) + 128, 0, 255).astype(np.uint8)
    
    rb_min, rb_max = rb_ch.min(), rb_ch.max()
    rb_mean = rb_ch.mean()
    rb_std = rb_ch.std()
    
    print(f"{name:<12} {rb_min:<10} {rb_max:<10} {rb_mean:<10.1f} {rb_std:<10.1f} {rb_max-rb_min:<10}")

print("\nCONTOUR/CORNER DETECTION DIFFICULTY")
print("=" * 80)

for name, path in images.items():
    img = cv2.imread(path)
    if img is None:
        continue
    
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Try threshold-based detection like gbcam_warp does
    contour_counts = []
    for thresh in range(180, 114, -5):
        _, binary = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)
        kernel = np.ones((7, 7), np.uint8)
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour_counts.append(len(contours))
    
    print(f"{name:<12} Contour counts at thresholds: {contour_counts}")
