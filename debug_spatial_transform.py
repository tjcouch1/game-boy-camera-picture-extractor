#!/usr/bin/env python3
"""
Debug script to verify spatial color transform is working correctly.
Checks what deltas are being computed and whether they're actually improving things.
"""
import sys
import json
import numpy as np
import cv2
from pathlib import Path

# Add locals
sys.path.insert(0, str(Path(__file__).parent))
from gbcam_common import INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT, SCREEN_H, SCREEN_W
from gbcam_correct import (
    _load_frame_ascii, _build_spatial_color_transform, 
    _apply_spatial_color_transform, FRAME_TARGETS
)

def debug_transform(input_path, scale=8):
    """Debug the spatial transform by checking samples and deltas."""
    
    print(f"\n{'='*70}")
    print(f"DEBUGGING SPATIAL TRANSFORM: {input_path}")
    print(f"{'='*70}")
    
    # Load warped image
    img_bgr = cv2.imread(input_path)
    if img_bgr is None:
        print(f"ERROR: Could not load {input_path}")
        return
    
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    H, W = img_rgb.shape[:2]
    print(f"Image shape: {H} x {W}")
    
    # Load frame_ascii to understand structure
    frame = _load_frame_ascii()
    if frame is None:
        print("ERROR: Could not load frame_ascii.txt")
        return
    
    print(f"\nFrame shape: {len(frame)} rows x {len(frame[0])} cols")
    print(f"Frame target colors:")
    for idx, name in enumerate(['Yellow', 'Red', 'Blue', 'Black']):
        print(f"  {idx}: {name} {FRAME_TARGETS[idx]}")
    
    # Collect yellow samples
    print(f"\nCollecting yellow frame samples...")
    samples = []
    for gy in range(SCREEN_H):
        for gx in range(SCREEN_W):
            if frame[gy][gx] == 0:  # yellow
                y_center = gy * scale + scale // 2
                x_center = gx * scale + scale // 2
                
                if 0 <= y_center < H and 0 <= x_center < W:
                    current = img_rgb[y_center, x_center, :]
                    target = FRAME_TARGETS[0]  # yellow
                    delta = target - current
                    samples.append({
                        'gy': gy, 'gx': gx,
                        'y_px': y_center, 'x_px': x_center,
                        'current': tuple(current),
                        'target': tuple(target),
                        'delta': tuple(delta)
                    })
    
    print(f"  Found {len(samples)} yellow samples")
    
    # Show stats
    if samples:
        deltas_arr = np.array([s['delta'] for s in samples])
        print(f"\nDelta statistics (target - current):")
        print(f"  R: mean={deltas_arr[:,0].mean():.1f}, std={deltas_arr[:,0].std():.1f}, "
              f"min={deltas_arr[:,0].min():.1f}, max={deltas_arr[:,0].max():.1f}")
        print(f"  G: mean={deltas_arr[:,1].mean():.1f}, std={deltas_arr[:,1].std():.1f}, "
              f"min={deltas_arr[:,1].min():.1f}, max={deltas_arr[:,1].max():.1f}")
        print(f"  B: mean={deltas_arr[:,2].mean():.1f}, std={deltas_arr[:,2].std():.1f}, "
              f"min={deltas_arr[:,2].min():.1f}, max={deltas_arr[:,2].max():.1f}")
        
        # Show some example samples
        print(f"\nSample yellow frame pixels (first 10):")
        for i, s in enumerate(samples[:10]):
            print(f"  ({s['gy']:3d}, {s['gx']:3d}): curr={s['current']}, "
                  f"targ={s['target']}, delta={s['delta']}")
    
    # Build transform
    print(f"\nBuilding spatial color transform...")
    transform_func, delta_surfaces = _build_spatial_color_transform(img_rgb, scale)
    
    if transform_func is None:
        print("  ERROR: Failed to build transform")
        return
    
    # Sample transform at various points
    print(f"\nSampling transform at various image coordinates:")
    test_points = [
        (H//4, W//4), (H//4, W//2), (H//4, 3*W//4),
        (H//2, W//4), (H//2, W//2), (H//2, 3*W//4),
        (3*H//4, W//4), (3*H//4, W//2), (3*H//4, 3*W//4),
    ]
    
    for y_px, x_px in test_points:
        delta = transform_func(float(y_px), float(x_px))
        print(f"  ({y_px:3d}, {x_px:3d}): delta={tuple(delta)}")
    
    # Check what happens if we apply transform
    print(f"\nApplying spatial color transform to image...")
    img_corrected = _apply_spatial_color_transform(img_rgb.copy(), transform_func, scale)
    
    # Compare before/after at a few sample points
    print(f"\nBefore/After comparison at yellow samples:")
    for s in samples[:5]:
        y_px, x_px = s['y_px'], s['x_px']
        before = img_rgb[y_px, x_px, :]
        after = img_corrected[y_px, x_px, :]
        delta_applied = after - before
        print(f"  ({s['gy']:3d}, {s['gx']:3d}): "
              f"before={tuple(before)}, "
              f"after={tuple(after)}, "
              f"applied_delta={tuple(delta_applied)}")
    
    print(f"\n{'='*70}\n")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        # Test on zelda-poster-3 warped image
        test_path = "test-output/zelda-poster-3/zelda-poster-3_warp.png"
    else:
        test_path = sys.argv[1]
    
    debug_transform(test_path)
