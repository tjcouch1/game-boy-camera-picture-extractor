#!/usr/bin/env python3
"""
visualize_white_samples.py - Diagnostic tool for Phase 1, Iteration 1

Visualizes the white reference samples collected from the frame and shows
how the polynomial surface fits to them.

Creates scatter plots showing:
- Sample positions and their brightness values
- Fitted polynomial surface as contour lines
- Residuals (actual - fitted) to show fit quality

This helps us understand if the polynomial model is appropriate for the data.

Usage:
  python visualize_white_samples.py test-output/thing-1/thing-1_warp.png
  python visualize_white_samples.py --all-tests
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

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib import cm
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False


def _gb_block_sample(gray, gy, gx, scale, percentile=50):
    """Return the <percentile>-th brightness value of GB pixel (gy, gx)."""
    y1, y2 = gy * scale, (gy + 1) * scale
    x1, x2 = gx * scale, (gx + 1) * scale
    block = gray[y1:y2, x1:x2]
    return float(np.percentile(block, percentile)) if block.size > 0 else 0.0


def collect_white_samples(gray, scale):
    """
    Collect (y_px, x_px, brightness) white reference samples from all four
    filmstrip frame strips - COPIED FROM gbcam_correct.py
    """
    H, W = gray.shape
    raw = []

    # Top strip
    for gy in range(INNER_TOP):
        for gx in range(10, SCREEN_W - 10):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    # Bottom strip
    for gy in range(INNER_BOT + 1, SCREEN_H):
        for gx in range(10, SCREEN_W - 10):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    # Left strip
    for gy in range(10, SCREEN_H - 10):
        for gx in range(INNER_LEFT):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    # Right strip
    for gy in range(10, SCREEN_H - 10):
        for gx in range(INNER_RIGHT + 1, SCREEN_W):
            v = _gb_block_sample(gray, gy, gx, scale, 85)
            raw.append((gy * scale + scale // 2,
                         gx * scale + scale // 2, v))

    if not raw:
        return [], [], []

    vals = np.array([v for _, _, v in raw])
    med  = float(np.median(vals))
    kept = [(y, x, v) for y, x, v in raw if v > 0.75 * med]

    ys = [p[0] for p in kept]
    xs = [p[1] for p in kept]
    vs = [p[2] for p in kept]

    return ys, xs, vs


def _design_matrix(yn, xn, degree):
    """Build the Vandermonde design matrix for a bivariate polynomial."""
    cols = []
    for dy in range(degree + 1):
        for dx in range(degree + 1 - dy):
            cols.append((yn ** dy) * (xn ** dx))
    return np.column_stack(cols)


def fit_surface(ys, xs, vals, H, W, degree=2):
    """
    Fit a degree-<degree> bivariate polynomial - COPIED FROM gbcam_correct.py
    """
    yn_s = (np.array(ys, dtype=float) / H) * 2 - 1
    xn_s = (np.array(xs, dtype=float) / W) * 2 - 1
    v_s  = np.array(vals, dtype=float)

    A      = _design_matrix(yn_s, xn_s, degree)
    coeffs, residuals, rank, s = np.linalg.lstsq(A, v_s, rcond=None)

    # Evaluate on the full pixel grid
    all_y  = np.arange(H, dtype=float)
    all_x  = np.arange(W, dtype=float)
    Yn2d, Xn2d = np.meshgrid((all_y / H) * 2 - 1,
                              (all_x / W) * 2 - 1, indexing='ij')
    yn_g = Yn2d.ravel()
    xn_g = Xn2d.ravel()

    A_grid   = _design_matrix(yn_g, xn_g, degree)
    surface  = (A_grid @ coeffs).reshape(H, W)

    # Also compute fitted values at sample points for residuals
    A_samples = _design_matrix(yn_s, xn_s, degree)
    fitted_vals = A_samples @ coeffs

    return surface.astype(np.float32), fitted_vals, residuals


def analyze_white_samples(image_path, poly_degree=2, scale=8, output_dir=None):
    """
    Analyze white sample distribution and polynomial fit quality.
    """
    name = Path(image_path).stem

    print(f"\n{'='*70}")
    print(f"White Sample Analysis: {name}")
    print(f"{'='*70}")

    # Load image
    bgr = cv2.imread(str(image_path))
    if bgr is None:
        raise RuntimeError(f"Cannot read image: {image_path}")

    # Convert to grayscale for analysis (use same method as gbcam_correct.py)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    gray = np.mean(rgb, axis=2).astype(np.float32)

    H, W = gray.shape

    # Collect white samples
    ys, xs, vals = collect_white_samples(gray, scale)
    n_samples = len(ys)

    print(f"\nSample Statistics:")
    print(f"  Total samples: {n_samples}")
    print(f"  Brightness range: {min(vals):.1f} - {max(vals):.1f}")
    print(f"  Brightness mean: {np.mean(vals):.1f}")
    print(f"  Brightness std: {np.std(vals):.1f}")
    print(f"  Brightness median: {np.median(vals):.1f}")

    # Fit polynomial surface
    print(f"\nFitting degree-{poly_degree} polynomial...")
    surface, fitted_vals, lstsq_residuals = fit_surface(ys, xs, vals, H, W, poly_degree)

    # Compute residuals at sample points
    residuals = np.array(vals) - fitted_vals

    print(f"\nPolynomial Fit Quality:")
    print(f"  Mean residual: {np.mean(residuals):.2f}")
    print(f"  Std dev residual: {np.std(residuals):.2f}")
    print(f"  Max abs residual: {np.abs(residuals).max():.2f}")
    print(f"  RMSE: {np.sqrt(np.mean(residuals**2)):.2f}")

    # Check for systematic bias
    center_y, center_x = H // 2, W // 2
    # Samples in center quarter
    center_mask = np.array([(abs(y - center_y) < H/4 and abs(x - center_x) < W/4)
                           for y, x in zip(ys, xs)])
    # Samples in outer regions
    edge_mask = ~center_mask

    if center_mask.any():
        center_residual = np.mean(residuals[center_mask])
        print(f"  Mean residual in center: {center_residual:.2f}")
    if edge_mask.any():
        edge_residual = np.mean(residuals[edge_mask])
        print(f"  Mean residual at edges: {edge_residual:.2f}")

    # Check for spatial pattern in residuals
    if center_mask.any() and edge_mask.any():
        bias = center_residual - edge_residual
        if abs(bias) > 10:
            if bias > 0:
                print(f"  WARNING: Polynomial UNDER-corrects center by {bias:.1f}")
            else:
                print(f"  WARNING: Polynomial OVER-corrects center by {abs(bias):.1f}")

    # Surface statistics
    print(f"\nFitted Surface Statistics:")
    print(f"  Surface range: {surface.min():.1f} - {surface.max():.1f}")
    print(f"  Surface mean: {surface.mean():.1f}")
    print(f"  Surface at center: {surface[center_y, center_x]:.1f}")
    print(f"  Surface at corners: TL={surface[0,0]:.1f} TR={surface[0,W-1]:.1f} "
          f"BL={surface[H-1,0]:.1f} BR={surface[H-1,W-1]:.1f}")

    # Create visualizations if matplotlib is available
    if HAS_MATPLOTLIB and output_dir:
        create_visualizations(ys, xs, vals, fitted_vals, residuals, surface,
                            name, poly_degree, output_dir, H, W)

    return {
        'n_samples': n_samples,
        'vals_mean': np.mean(vals),
        'vals_std': np.std(vals),
        'residuals_mean': np.mean(residuals),
        'residuals_std': np.std(residuals),
        'residuals_max': np.abs(residuals).max(),
        'rmse': np.sqrt(np.mean(residuals**2)),
    }


def create_visualizations(ys, xs, vals, fitted_vals, residuals, surface,
                         name, poly_degree, output_dir, H, W):
    """Create visualization plots."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Figure 1: Scatter plot of samples with fitted surface as contours
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))

    # Left: Sample brightness scatter
    ax = axes[0]
    scatter = ax.scatter(xs, ys, c=vals, s=20, cmap='jet', vmin=min(vals), vmax=max(vals))
    ax.set_xlabel('X position (pixels)')
    ax.set_ylabel('Y position (pixels)')
    ax.set_title(f'{name}: White Sample Brightness\n(n={len(vals)} samples)')
    ax.invert_yaxis()
    ax.set_aspect('equal')
    plt.colorbar(scatter, ax=ax, label='Brightness')

    # Overlay contours of fitted surface
    Y_grid, X_grid = np.meshgrid(range(0, H, 20), range(0, W, 20), indexing='ij')
    Z_grid = surface[::20, ::20]
    contours = ax.contour(X_grid, Y_grid, Z_grid, levels=10, colors='white',
                         linewidths=0.5, alpha=0.7)
    ax.clabel(contours, inline=True, fontsize=8)

    # Right: Fitted surface heatmap
    ax = axes[1]
    im = ax.imshow(surface, cmap='jet', aspect='equal', origin='upper')
    ax.set_xlabel('X position (pixels)')
    ax.set_ylabel('Y position (pixels)')
    ax.set_title(f'{name}: Fitted Surface (degree {poly_degree})\nRange: {surface.min():.1f} - {surface.max():.1f}')
    plt.colorbar(im, ax=ax, label='Brightness')

    plt.tight_layout()
    output_path = Path(output_dir) / f"{name}_white_samples_scatter.png"
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"\nScatter plot saved to: {output_path}")

    # Figure 2: Residuals analysis
    fig, axes = plt.subplots(2, 2, figsize=(14, 12))

    # Top-left: Residuals scatter
    ax = axes[0, 0]
    scatter = ax.scatter(xs, ys, c=residuals, s=20, cmap='RdBu_r',
                        vmin=-max(abs(residuals)), vmax=max(abs(residuals)))
    ax.set_xlabel('X position (pixels)')
    ax.set_ylabel('Y position (pixels)')
    ax.set_title(f'{name}: Residuals (Actual - Fitted)\nRed=under-corrected, Blue=over-corrected')
    ax.invert_yaxis()
    ax.set_aspect('equal')
    plt.colorbar(scatter, ax=ax, label='Residual')

    # Top-right: Residual histogram
    ax = axes[0, 1]
    ax.hist(residuals, bins=50, edgecolor='black')
    ax.set_xlabel('Residual (Actual - Fitted)')
    ax.set_ylabel('Count')
    ax.set_title(f'Residual Distribution\nMean: {np.mean(residuals):.2f}, Std: {np.std(residuals):.2f}')
    ax.axvline(0, color='red', linestyle='--', linewidth=2, label='Zero')
    ax.axvline(np.mean(residuals), color='green', linestyle='--', linewidth=2, label='Mean')
    ax.legend()
    ax.grid(alpha=0.3)

    # Bottom-left: Actual vs Fitted scatter
    ax = axes[1, 0]
    ax.scatter(fitted_vals, vals, s=10, alpha=0.5)
    min_val, max_val = min(min(vals), min(fitted_vals)), max(max(vals), max(fitted_vals))
    ax.plot([min_val, max_val], [min_val, max_val], 'r--', linewidth=2, label='Perfect fit')
    ax.set_xlabel('Fitted Value')
    ax.set_ylabel('Actual Value')
    ax.set_title('Actual vs Fitted Values')
    ax.legend()
    ax.grid(alpha=0.3)
    ax.set_aspect('equal')

    # Bottom-right: Residuals vs Fitted
    ax = axes[1, 1]
    ax.scatter(fitted_vals, residuals, s=10, alpha=0.5)
    ax.axhline(0, color='red', linestyle='--', linewidth=2)
    ax.set_xlabel('Fitted Value')
    ax.set_ylabel('Residual')
    ax.set_title('Residuals vs Fitted\n(should be random around 0)')
    ax.grid(alpha=0.3)

    plt.tight_layout()
    output_path = Path(output_dir) / f"{name}_white_samples_residuals.png"
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"Residuals plot saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Visualize white sample distribution and polynomial fitting",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("image", nargs='?', help="Warp image (*_warp.png)")
    parser.add_argument("--all-tests", action="store_true",
                       help="Process all test images in test-output/")
    parser.add_argument("--poly-degree", type=int, default=2,
                       help="Polynomial degree to fit (default: 2)")
    parser.add_argument("--output-dir", default="diagnostic-output/white-samples",
                       help="Where to save visualizations")
    parser.add_argument("--scale", type=int, default=8, help="Scale factor")
    args = parser.parse_args()

    if not HAS_MATPLOTLIB:
        print("WARNING: matplotlib not installed, visualizations will be skipped",
              file=sys.stderr)
        print("Install with: pip install matplotlib", file=sys.stderr)

    if args.all_tests:
        test_dirs = glob.glob("test-output/*/")
        if not test_dirs:
            print("No test outputs found in test-output/", file=sys.stderr)
            sys.exit(1)

        all_results = []
        for test_dir in sorted(test_dirs):
            test_name = Path(test_dir).name
            warp_path = Path(test_dir) / f"{test_name}_warp.png"

            if warp_path.exists():
                try:
                    result = analyze_white_samples(warp_path, args.poly_degree,
                                                  args.scale, args.output_dir)
                    all_results.append((test_name, result))
                except Exception as e:
                    print(f"Error processing {test_name}: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc()

        # Print summary
        print(f"\n{'='*70}")
        print("SUMMARY: Polynomial Fit Quality Across All Tests")
        print(f"{'='*70}")
        print(f"{'Test':<20} {'N Samples':>10} {'RMSE':>10} {'Max Residual':>14} {'Std Dev':>10}")
        print("-" * 70)
        for test_name, result in all_results:
            print(f"{test_name:<20} {result['n_samples']:>10} {result['rmse']:>10.2f} "
                  f"{result['residuals_max']:>14.2f} {result['residuals_std']:>10.2f}")

    else:
        if not args.image:
            parser.print_help()
            print("\nError: provide image path or use --all-tests", file=sys.stderr)
            sys.exit(1)

        analyze_white_samples(args.image, args.poly_degree, args.scale, args.output_dir)


if __name__ == "__main__":
    main()
