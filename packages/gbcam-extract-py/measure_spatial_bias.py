#!/usr/bin/env python3
"""
measure_spatial_bias.py - Measure spatial correction bias

Divides corrected image into regions and measures mean R, G, B values
to detect spatial artifacts in correction.

Usage:
  python measure_spatial_bias.py test-output/zelda-poster-3/zelda-poster-3_correct.png
  python measure_spatial_bias.py --all-tests
"""

import cv2
import numpy as np
import argparse
from pathlib import Path
import glob

from gbcam_common import FRAME_THICK, CAM_W, CAM_H

def measure_spatial_bias(image_path, scale=8):
    """Measure spatial bias in corrected image."""
    name = Path(image_path).stem.replace('_correct', '')

    print(f"\n{'='*70}")
    print(f"Spatial Bias Analysis: {name}")
    print(f"{'='*70}")

    # Load image
    bgr = cv2.imread(str(image_path))
    if bgr is None:
        raise RuntimeError(f"Cannot read: {image_path}")

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)

    # Extract camera area only
    y1, y2 = FRAME_THICK * scale, (FRAME_THICK + CAM_H) * scale
    x1, x2 = FRAME_THICK * scale, (FRAME_THICK + CAM_W) * scale
    cam_rgb = rgb[y1:y2, x1:x2, :]

    H, W = cam_rgb.shape[:2]

    # Divide into regions: left, center, right / top, center, bottom
    third_w = W // 3
    third_h = H // 3

    regions = {
        'Top-Left':     cam_rgb[:third_h, :third_w, :],
        'Top-Center':   cam_rgb[:third_h, third_w:2*third_w, :],
        'Top-Right':    cam_rgb[:third_h, 2*third_w:, :],
        'Mid-Left':     cam_rgb[third_h:2*third_h, :third_w, :],
        'Mid-Center':   cam_rgb[third_h:2*third_h, third_w:2*third_w, :],
        'Mid-Right':    cam_rgb[third_h:2*third_h, 2*third_w:, :],
        'Bot-Left':     cam_rgb[2*third_h:, :third_w, :],
        'Bot-Center':   cam_rgb[2*third_h:, third_w:2*third_w, :],
        'Bot-Right':    cam_rgb[2*third_h:, 2*third_w:, :],
    }

    print(f"\n{'Region':<15} {'Mean R':>8} {'Mean G':>8} {'Mean B':>8} {'R-G Diff':>10}")
    print("-" * 60)

    stats = {}
    for region_name, region_rgb in regions.items():
        mean_r = np.mean(region_rgb[:, :, 0])
        mean_g = np.mean(region_rgb[:, :, 1])
        mean_b = np.mean(region_rgb[:, :, 2])
        diff_rg = mean_r - mean_g

        stats[region_name] = {
            'R': mean_r, 'G': mean_g, 'B': mean_b, 'R-G': diff_rg
        }

        print(f"{region_name:<15} {mean_r:>8.1f} {mean_g:>8.1f} {mean_b:>8.1f} {diff_rg:>+10.1f}")

    # Compute spatial variation
    all_r = [s['R'] for s in stats.values()]
    all_g = [s['G'] for s in stats.values()]
    all_rg = [s['R-G'] for s in stats.values()]

    print(f"\n{'Metric':<20} {'Range':>15} {'Std Dev':>10}")
    print("-" * 50)
    print(f"{'R variation':<20} {min(all_r):>7.1f}-{max(all_r):<6.1f} {np.std(all_r):>10.1f}")
    print(f"{'G variation':<20} {min(all_g):>7.1f}-{max(all_g):<6.1f} {np.std(all_g):>10.1f}")
    print(f"{'R-G diff variation':<20} {min(all_rg):>7.1f}-{max(all_rg):<6.1f} {np.std(all_rg):>10.1f}")

    # Check for problematic bias
    r_range = max(all_r) - min(all_r)
    g_range = max(all_g) - min(all_g)
    rg_range = max(all_rg) - min(all_rg)

    print(f"\nBias Assessment:")
    if r_range > 30:
        print(f"  WARNING: R channel has {r_range:.1f} point range (>30 threshold)")
    if g_range > 30:
        print(f"  WARNING: G channel has {g_range:.1f} point range (>30 threshold)")
    if rg_range > 40:
        print(f"  WARNING: R-G balance varies by {rg_range:.1f} points (>40 threshold)")
        print(f"           This causes LG/DG/WH misclassification!")

    if r_range <= 30 and g_range <= 30 and rg_range <= 40:
        print("  OK: Spatial bias is within acceptable range")

    return stats


def main():
    parser = argparse.ArgumentParser(description="Measure spatial correction bias")
    parser.add_argument("image", nargs='?', help="Corrected image (*_correct.png)")
    parser.add_argument("--all-tests", action="store_true",
                       help="Process all test images")
    parser.add_argument("--scale", type=int, default=8)
    args = parser.parse_args()

    if args.all_tests:
        _repo_root = str(Path(__file__).resolve().parent.parent.parent)
        test_dirs = glob.glob(_repo_root + "/test-output/*/")
        for test_dir in sorted(test_dirs):
            test_name = Path(test_dir).name
            correct_path = Path(test_dir) / f"{test_name}_correct.png"
            if correct_path.exists():
                try:
                    measure_spatial_bias(correct_path, args.scale)
                except Exception as e:
                    print(f"Error: {e}")
    else:
        if not args.image:
            parser.print_help()
            return
        measure_spatial_bias(args.image, args.scale)


if __name__ == "__main__":
    main()
