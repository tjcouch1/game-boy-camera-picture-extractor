#!/usr/bin/env python3
"""
visualize_frame_colors.py - CRITICAL diagnostic tool for Phase 1, Iteration 1

Samples all four palette colors (BK, DG, LG, WH) from known frame positions
and verifies that color correction is working correctly.

The Game Boy frame contains all four colors:
  BK (#000000): Black dashes running through the frame
  DG (#9494FF): Inner border (one pixel thick around camera area)
  LG (#FF9494): Light gray elements in frame structure
  WH (#FFFFA5): Frame background (yellow/white)

This tool directly tests correction quality by measuring how close the
corrected frame colors are to their target values.

Usage:
  python visualize_frame_colors.py test-output/thing-1/thing-1_warp.png test-output/thing-1/thing-1_correct.png
  python visualize_frame_colors.py --all-tests
"""

import cv2
import numpy as np
import argparse
import sys
from pathlib import Path
import glob

from gbcam_common import (
    SCREEN_W, SCREEN_H, FRAME_THICK, CAM_W, CAM_H,
    INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT,
)

# Target RGB values for the four palette colors
TARGET_BK = np.array([0, 0, 0], dtype=float)
TARGET_DG = np.array([148, 148, 255], dtype=float)
TARGET_LG = np.array([255, 148, 148], dtype=float)
TARGET_WH = np.array([255, 255, 165], dtype=float)


def sample_color_at_gb_pixel(img_rgb, gy, gx, scale=8):
    """Sample the mean RGB color of a GB pixel block."""
    y1, y2 = gy * scale, (gy + 1) * scale
    x1, x2 = gx * scale, (gx + 1) * scale
    block = img_rgb[y1:y2, x1:x2, :]
    return np.mean(block, axis=(0, 1))


def collect_frame_color_samples(img_rgb, scale=8):
    """
    Collect samples of all four colors from the frame based on known positions.

    Returns dict with keys 'BK', 'DG', 'LG', 'WH', each containing:
      - 'positions': list of (gy, gx) tuples
      - 'colors': list of RGB arrays
      - 'mean': mean RGB across all samples
    """
    samples = {
        'BK': {'positions': [], 'colors': []},
        'DG': {'positions': [], 'colors': []},
        'LG': {'positions': [], 'colors': []},
        'WH': {'positions': [], 'colors': []},
    }

    # DG: Inner border (complete rectangle around camera area)
    # Top border: row INNER_TOP, cols INNER_LEFT to INNER_RIGHT
    for gx in range(INNER_LEFT, INNER_RIGHT + 1):
        samples['DG']['positions'].append((INNER_TOP, gx))
        samples['DG']['colors'].append(sample_color_at_gb_pixel(img_rgb, INNER_TOP, gx, scale))

    # Bottom border: row INNER_BOT, cols INNER_LEFT to INNER_RIGHT
    for gx in range(INNER_LEFT, INNER_RIGHT + 1):
        samples['DG']['positions'].append((INNER_BOT, gx))
        samples['DG']['colors'].append(sample_color_at_gb_pixel(img_rgb, INNER_BOT, gx, scale))

    # Left border: col INNER_LEFT, rows INNER_TOP to INNER_BOT
    for gy in range(INNER_TOP + 1, INNER_BOT):
        samples['DG']['positions'].append((gy, INNER_LEFT))
        samples['DG']['colors'].append(sample_color_at_gb_pixel(img_rgb, gy, INNER_LEFT, scale))

    # Right border: col INNER_RIGHT, rows INNER_TOP to INNER_BOT
    for gy in range(INNER_TOP + 1, INNER_BOT):
        samples['DG']['positions'].append((gy, INNER_RIGHT))
        samples['DG']['colors'].append(sample_color_at_gb_pixel(img_rgb, gy, INNER_RIGHT, scale))

    # WH: Frame background (avoiding dashes and corners)
    # Top strip: rows 0 to INNER_TOP-1, safe cols
    for gy in range(INNER_TOP):
        for gx in range(10, SCREEN_W - 10):
            color = sample_color_at_gb_pixel(img_rgb, gy, gx, scale)
            # Heuristic: if very dark, it's probably a black dash, skip it
            if np.mean(color) > 100:  # Threshold to exclude BK dashes
                samples['WH']['positions'].append((gy, gx))
                samples['WH']['colors'].append(color)

    # Bottom strip: rows INNER_BOT+1 to SCREEN_H-1
    for gy in range(INNER_BOT + 1, SCREEN_H):
        for gx in range(10, SCREEN_W - 10):
            color = sample_color_at_gb_pixel(img_rgb, gy, gx, scale)
            if np.mean(color) > 100:
                samples['WH']['positions'].append((gy, gx))
                samples['WH']['colors'].append(color)

    # Left strip: cols 0 to INNER_LEFT-1
    for gy in range(10, SCREEN_H - 10):
        for gx in range(INNER_LEFT):
            color = sample_color_at_gb_pixel(img_rgb, gy, gx, scale)
            if np.mean(color) > 100:
                samples['WH']['positions'].append((gy, gx))
                samples['WH']['colors'].append(color)

    # Right strip: cols INNER_RIGHT+1 to SCREEN_W-1
    for gy in range(10, SCREEN_H - 10):
        for gx in range(INNER_RIGHT + 1, SCREEN_W):
            color = sample_color_at_gb_pixel(img_rgb, gy, gx, scale)
            if np.mean(color) > 100:
                samples['WH']['positions'].append((gy, gx))
                samples['WH']['colors'].append(color)

    # BK: Black dashes in frame (simplified sampling at known dash locations)
    # From frame_ascii.txt, dashes appear in specific patterns in top/bottom rows
    # Row 6 (0-indexed) has dashes at specific positions
    # Sample a few known dash positions from top frame
    dash_candidates = []
    for gy in range(6, 9):  # Rows with dashes
        for gx in range(5, 15):  # Known dash region
            color = sample_color_at_gb_pixel(img_rgb, gy, gx, scale)
            if np.mean(color) < 100:  # Dark pixels
                dash_candidates.append((gy, gx, np.mean(color)))

    # Take the darkest pixels as BK samples
    dash_candidates.sort(key=lambda x: x[2])
    for gy, gx, _ in dash_candidates[:20]:  # Top 20 darkest
        samples['BK']['positions'].append((gy, gx))
        samples['BK']['colors'].append(sample_color_at_gb_pixel(img_rgb, gy, gx, scale))

    # Compute means for each color type
    for color_name in ['BK', 'DG', 'LG', 'WH']:
        if samples[color_name]['colors']:
            samples[color_name]['mean'] = np.mean(samples[color_name]['colors'], axis=0)
        else:
            samples[color_name]['mean'] = np.array([0, 0, 0], dtype=float)

    return samples


def compute_color_errors(samples):
    """
    Compute error statistics for each color type.
    Returns dict with keys 'BK', 'DG', 'LG', 'WH', each containing:
      - 'target': target RGB
      - 'actual': actual mean RGB
      - 'error': absolute error per channel
      - 'rmse': root mean square error across RGB
    """
    targets = {'BK': TARGET_BK, 'DG': TARGET_DG, 'LG': TARGET_LG, 'WH': TARGET_WH}
    errors = {}

    for color_name, target in targets.items():
        actual = samples[color_name]['mean']
        error = np.abs(actual - target)
        rmse = np.sqrt(np.mean((actual - target) ** 2))
        errors[color_name] = {
            'target': target,
            'actual': actual,
            'error': error,
            'rmse': rmse,
        }

    return errors


def print_report(name, samples, errors):
    """Print a detailed report of frame color accuracy."""
    print(f"\n{'='*70}")
    print(f"Frame Color Analysis: {name}")
    print(f"{'='*70}")

    for color_name in ['BK', 'DG', 'LG', 'WH']:
        n_samples = len(samples[color_name]['colors'])
        target = errors[color_name]['target']
        actual = errors[color_name]['actual']
        error = errors[color_name]['error']
        rmse = errors[color_name]['rmse']

        print(f"\n{color_name} (n={n_samples}):")
        print(f"  Target:  R={target[0]:6.1f}  G={target[1]:6.1f}  B={target[2]:6.1f}")
        print(f"  Actual:  R={actual[0]:6.1f}  G={actual[1]:6.1f}  B={actual[2]:6.1f}")
        print(f"  Error:   R={error[0]:6.1f}  G={error[1]:6.1f}  B={error[2]:6.1f}")
        print(f"  RMSE: {rmse:.2f}")

        # Quality assessment
        if rmse < 20:
            quality = "[OK] GOOD"
        elif rmse < 40:
            quality = "[WARN] MODERATE"
        else:
            quality = "[FAIL] POOR"
        print(f"  Quality: {quality}")

    # Overall assessment
    avg_rmse = np.mean([errors[c]['rmse'] for c in ['BK', 'DG', 'LG', 'WH']])
    print(f"\nAverage RMSE across all colors: {avg_rmse:.2f}")
    if avg_rmse < 20:
        print("Overall: [OK] CORRECTION IS WORKING WELL")
    elif avg_rmse < 40:
        print("Overall: [WARN] CORRECTION HAS MODERATE ERRORS")
    else:
        print("Overall: [FAIL] CORRECTION HAS SEVERE ERRORS")


def visualize_frame_colors(warp_path, correct_path, output_dir=None, scale=8):
    """
    Visualize and analyze frame colors before and after correction.
    """
    name = Path(warp_path).stem.replace('_warp', '')

    # Load images
    warp_bgr = cv2.imread(str(warp_path))
    if warp_bgr is None:
        raise RuntimeError(f"Cannot read warp image: {warp_path}")
    warp_rgb = cv2.cvtColor(warp_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)

    correct_bgr = cv2.imread(str(correct_path))
    if correct_bgr is None:
        raise RuntimeError(f"Cannot read correct image: {correct_path}")
    correct_rgb = cv2.cvtColor(correct_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)

    # Analyze both images
    print(f"\n{'#'*70}")
    print(f"# BEFORE CORRECTION (warp)")
    print(f"{'#'*70}")
    warp_samples = collect_frame_color_samples(warp_rgb, scale)
    warp_errors = compute_color_errors(warp_samples)
    print_report(name + " (BEFORE)", warp_samples, warp_errors)

    print(f"\n{'#'*70}")
    print(f"# AFTER CORRECTION")
    print(f"{'#'*70}")
    correct_samples = collect_frame_color_samples(correct_rgb, scale)
    correct_errors = compute_color_errors(correct_samples)
    print_report(name + " (AFTER)", correct_samples, correct_errors)

    # Create visualization
    if output_dir:
        create_visualization(warp_rgb, correct_rgb, warp_samples, correct_samples,
                           warp_errors, correct_errors, name, output_dir, scale)

    return warp_errors, correct_errors


def create_visualization(warp_rgb, correct_rgb, warp_samples, correct_samples,
                        warp_errors, correct_errors, name, output_dir, scale):
    """Create annotated visualization showing frame color samples."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Create side-by-side visualization with sample points marked
    H, W = warp_rgb.shape[:2]
    vis = np.zeros((H, W * 2 + 20, 3), dtype=np.uint8)

    # Copy images
    vis[:, :W, :] = np.clip(warp_rgb, 0, 255).astype(np.uint8)
    vis[:, W+20:, :] = np.clip(correct_rgb, 0, 255).astype(np.uint8)

    # Mark sample positions with colored dots
    colors = {
        'BK': (0, 0, 0),
        'DG': (148, 148, 255),
        'LG': (255, 148, 148),
        'WH': (255, 255, 165),
    }

    # Mark samples on left (warp) image
    for color_name, color_rgb in colors.items():
        for gy, gx in warp_samples[color_name]['positions'][:50]:  # Limit to 50 points per color
            cy = gy * scale + scale // 2
            cx = gx * scale + scale // 2
            cv2.circle(vis, (cx, cy), 2, color_rgb, -1)

    # Mark samples on right (correct) image
    for color_name, color_rgb in colors.items():
        for gy, gx in correct_samples[color_name]['positions'][:50]:
            cy = gy * scale + scale // 2
            cx = gx * scale + scale // 2 + W + 20
            cv2.circle(vis, (cx, cy), 2, color_rgb, -1)

    # Add text labels
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(vis, "BEFORE", (10, 30), font, 1, (255, 255, 255), 2)
    cv2.putText(vis, "AFTER", (W + 30, 30), font, 1, (255, 255, 255), 2)

    # Save visualization
    output_path = Path(output_dir) / f"{name}_frame_colors_visualization.png"
    cv2.imwrite(str(output_path), cv2.cvtColor(vis, cv2.COLOR_RGB2BGR))
    print(f"\nVisualization saved to: {output_path}")

    # Create summary chart
    create_summary_chart(warp_errors, correct_errors, name, output_dir)


def create_summary_chart(warp_errors, correct_errors, name, output_dir):
    """Create a bar chart comparing errors before/after correction."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    fig.suptitle(f'Frame Color Correction Quality: {name}', fontsize=16)

    color_names = ['BK', 'DG', 'LG', 'WH']
    channel_names = ['R', 'G', 'B']

    for idx, color_name in enumerate(color_names):
        ax = axes[idx // 2, idx % 2]

        warp_error = warp_errors[color_name]['error']
        correct_error = correct_errors[color_name]['error']

        x = np.arange(3)
        width = 0.35

        ax.bar(x - width/2, warp_error, width, label='Before', alpha=0.8)
        ax.bar(x + width/2, correct_error, width, label='After', alpha=0.8)

        ax.set_ylabel('Absolute Error')
        ax.set_title(f'{color_name} - Target: {warp_errors[color_name]["target"]}')
        ax.set_xticks(x)
        ax.set_xticklabels(channel_names)
        ax.legend()
        ax.grid(axis='y', alpha=0.3)
        ax.set_ylim(0, max(200, max(warp_error.max(), correct_error.max()) * 1.1))

        # Add RMSE text
        warp_rmse = warp_errors[color_name]['rmse']
        correct_rmse = correct_errors[color_name]['rmse']
        ax.text(0.5, 0.95, f'RMSE: {warp_rmse:.1f} → {correct_rmse:.1f}',
                transform=ax.transAxes, ha='center', va='top',
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    plt.tight_layout()
    output_path = Path(output_dir) / f"{name}_frame_colors_chart.png"
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"Chart saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Visualize and analyze frame color correction quality",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("warp", nargs='?', help="Warp image (*_warp.png)")
    parser.add_argument("correct", nargs='?', help="Corrected image (*_correct.png)")
    parser.add_argument("--all-tests", action="store_true",
                       help="Process all test images in test-output/")
    parser.add_argument("--output-dir", default="diagnostic-output/frame-colors",
                       help="Where to save visualizations (default: diagnostic-output/frame-colors)")
    parser.add_argument("--scale", type=int, default=8, help="Scale factor (default: 8)")
    args = parser.parse_args()

    if args.all_tests:
        # Find all test outputs
        test_dirs = glob.glob("test-output/*/")
        if not test_dirs:
            print("No test outputs found in test-output/", file=sys.stderr)
            sys.exit(1)

        all_results = []
        for test_dir in sorted(test_dirs):
            test_name = Path(test_dir).name
            warp_path = Path(test_dir) / f"{test_name}_warp.png"
            correct_path = Path(test_dir) / f"{test_name}_correct.png"

            if warp_path.exists() and correct_path.exists():
                try:
                    warp_err, correct_err = visualize_frame_colors(
                        warp_path, correct_path, args.output_dir, args.scale)
                    all_results.append((test_name, warp_err, correct_err))
                except Exception as e:
                    print(f"Error processing {test_name}: {e}", file=sys.stderr)

        # Print summary comparison
        print(f"\n{'='*70}")
        print("SUMMARY: Correction Quality Across All Tests")
        print(f"{'='*70}")
        print(f"{'Test':<20} {'Avg RMSE Before':>15} {'Avg RMSE After':>15} {'Improvement':>12}")
        print("-" * 70)
        for test_name, warp_err, correct_err in all_results:
            avg_before = np.mean([warp_err[c]['rmse'] for c in ['BK', 'DG', 'LG', 'WH']])
            avg_after = np.mean([correct_err[c]['rmse'] for c in ['BK', 'DG', 'LG', 'WH']])
            improvement = avg_before - avg_after
            print(f"{test_name:<20} {avg_before:>15.2f} {avg_after:>15.2f} {improvement:>+12.2f}")

    else:
        if not args.warp or not args.correct:
            parser.print_help()
            print("\nError: provide warp and correct images, or use --all-tests", file=sys.stderr)
            sys.exit(1)

        visualize_frame_colors(args.warp, args.correct, args.output_dir, args.scale)


if __name__ == "__main__":
    main()
