#!/usr/bin/env python3
"""
Build and apply a spatial color transformation based on frame calibration.

The core idea:
1. Measure what the frame colors currently are (from warp image)
2. Know what they should be (from frame_ascii.txt)
3. Build a spatial transformation function that maps current -> target
4. Apply this transformation to the entire image

This gives us a proper color correction that accounts for spatial variation
across the image, which will naturally correct both frame and camera picture.
"""
import numpy as np
import cv2
from pathlib import Path
from scipy.ndimage import uniform_filter1d
from scipy import interpolate

from gbcam_common import (
    SCREEN_W, SCREEN_H, FRAME_THICK, INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT,
    CAM_W, CAM_H,
    log
)

# Target RGB colors from frame_ascii
FRAME_TARGETS = {
    0: np.array([255.0, 255.0, 165.0]),  # yellow (space)
    1: np.array([255.0, 148.0, 148.0]),  # red (·)
    2: np.array([148.0, 148.0, 255.0]),  # blue (▓)
    3: np.array([0.0, 0.0, 0.0]),        # black (█)
}

def _load_frame_ascii():
    """Load frame_ascii.txt and return a 160×144 grid with color indices (0-3)."""
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
                    row.append(0)
            if len(row) == SCREEN_W:
                frame.append(row)
        if len(frame) == SCREEN_H:
            return frame
    except Exception:
        pass
    return None

def build_spatial_color_transform(warp_rgb, scale=8):
    """
    Build a spatial color transformation by analyzing frame colors in the warp image.
    
    Returns a function transform_rgb(x, y) -> (dr, dg, db) that gives the color offset
    needed at image coordinate (x, y).
    """
    frame = _load_frame_ascii()
    if frame is None:
        return None
    
    H, W = warp_rgb.shape[:2]
    
    # Collect calibration samples: (pixel_y, pixel_x, current_rgb, target_rgb)
    samples = []
    
    for gy in range(SCREEN_H):
        for gx in range(SCREEN_W):
            color_idx = frame[gy][gx]
            target = FRAME_TARGETS[color_idx]
            
            # Sample at center of GB block
            y_center = gy * scale + scale // 2
            x_center = gx * scale + scale // 2
            
            if 0 <= y_center < H and 0 <= x_center < W:
                current = warp_rgb[y_center, x_center, :]
                # Compute delta (how much to add to current to reach target)
                delta = target - current
                samples.append((y_center, x_center, current, delta))
    
    if len(samples) < 10:
        log("  ERROR: Not enough frame samples for color calibration")
        return None
    
    # Extract sample positions and deltas
    sample_ys = np.array([s[0] for s in samples], dtype=float)
    sample_xs = np.array([s[1] for s in samples], dtype=float)
    sample_deltas = np.array([s[3] for s in samples], dtype=np.float32)  # (N, 3)
    
    # Fit bivariate polynomials to the deltas (per channel)
    # This gives us a smooth field of color corrections
    log(f"  Building spatial color transform from {len(samples)} frame samples")
    
    # Normalize coordinates for fitting
    y_norm = sample_ys / H * 2 - 1
    x_norm = sample_xs / W * 2 - 1
    
    # Build design matrix for degree-2 bivariate polynomial
    # Basis: [1, x, y, x^2, xy, y^2]
    cols = []
    for dy in range(3):
        for dx in range(3 - dy):
            cols.append((x_norm ** dx) * (y_norm ** dy))
    A = np.column_stack(cols)
    
    # Fit per channel
    delta_surfaces = []
    for ch in range(3):
        v = sample_deltas[:, ch]
        coeffs, _, _, _ = np.linalg.lstsq(A, v, rcond=None)
        delta_surfaces.append(coeffs)
    
    # Create a function that evaluates the transform at any point
    def transform_func(y_px, x_px):
        """Return (dr, dg, db) offset at image pixel (y_px, x_px)."""
        y_n = (y_px / H) * 2 - 1
        x_n = (x_px / W) * 2 - 1
        
        basis = np.array([
            1.0,
            x_n, y_n,
            x_n**2, x_n*y_n, y_n**2
        ])
        
        delta = np.array([
            float(np.dot(delta_surfaces[ch], basis))
            for ch in range(3)
        ])
        return delta
    
    return transform_func

def apply_spatial_color_transform(img_rgb, transform_func, scale=8):
    """
    Apply spatial color transformation to an image.
    More efficient by operating on GB pixel blocks.
    """
    if transform_func is None:
        return img_rgb
    
    H, W = img_rgb.shape[:2]
    result = img_rgb.copy()
    
    # Apply transform per GB pixel block (more efficient)
    n_gy = (H + scale - 1) // scale
    n_gx = (W + scale - 1) // scale
    
    for gy in range(n_gy):
        for gx in range(n_gx):
            # Sample transform at center of this GB pixel block
            y_center = gy * scale + scale // 2
            x_center = gx * scale + scale // 2
            
            if y_center < H and x_center < W:
                delta = transform_func(float(y_center), float(x_center))
                
                # Apply delta to all pixels in this block
                y_start = gy * scale
                y_end = min((gy + 1) * scale, H)
                x_start = gx * scale
                x_end = min((gx + 1) * scale, W)
                
                result[y_start:y_end, x_start:x_end, :] = np.clip(
                    result[y_start:y_end, x_start:x_end, :] + delta,
                    0, 255
                )
    
    return result

def validate_frame_colors(img_rgb, scale=8):
    """
    After transformation, check if frame colors are now closer to targets.
    """
    frame = _load_frame_ascii()
    if frame is None:
        return
    
    H, W = img_rgb.shape[:2]
    
    print("\n" + "="*70)
    print("FRAME COLOR VALIDATION AFTER TRANSFORM")
    print("="*70)
    
    for color_idx in range(4):
        color_name = ['yellow', 'red', 'blue', 'black'][color_idx]
        target = FRAME_TARGETS[color_idx]
        
        # Collect samples of this color
        samples = []
        for gy in range(SCREEN_H):
            for gx in range(SCREEN_W):
                if frame[gy][gx] == color_idx:
                    y_center = gy * scale + scale // 2
                    x_center = gx * scale + scale // 2
                    if 0 <= y_center < H and 0 <= x_center < W:
                        samples.append(img_rgb[y_center, x_center, :])
        
        if samples:
            samples = np.array(samples)
            mean = np.mean(samples, axis=0)
            std = np.std(samples, axis=0)
            delta = target - mean
            
            print(f"\n{color_name.upper()}:")
            print(f"  Target:  {tuple(target)}")
            print(f"  Mean:    {tuple(mean)}")
            print(f"  Std:     {tuple(std)}")
            print(f"  Error:   {tuple(delta)}")

def main():
    import sys
    
    if len(sys.argv) > 1:
        warp_path = sys.argv[1]
    else:
        _repo_root = str(Path(__file__).resolve().parent.parent.parent)
        warp_path = _repo_root + "/test-output/zelda-poster-3/zelda-poster-3_warp.png"
    
    print(f"Loading {warp_path}")
    bgr = cv2.imread(str(warp_path))
    if bgr is None:
        print(f"ERROR: Could not load {warp_path}")
        return
    
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    scale = 8
    
    # Build transform
    transform = build_spatial_color_transform(rgb, scale)
    if transform is None:
        print("ERROR: Could not build transform")
        return
    
    # Validate before
    print("\nBEFORE transformation:")
    validate_frame_colors(rgb, scale)
    
    # Apply transform
    print("\nApplying spatial color transformation...")
    rgb_corrected = apply_spatial_color_transform(rgb, transform, scale)
    
    # Validate after
    print("\nAFTER transformation:")
    validate_frame_colors(rgb_corrected, scale)
    
    # Save corrected image
    bgr_corrected = cv2.cvtColor(np.clip(rgb_corrected, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    output_path = Path(warp_path).parent / (Path(warp_path).stem + "_transformed.png")
    cv2.imwrite(str(output_path), bgr_corrected)
    print(f"\nSaved transformed image to: {output_path}")

if __name__ == "__main__":
    main()
