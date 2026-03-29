#!/usr/bin/env python3
"""
analyze_border_distortion.py — Analyze border positioning and straightness

This script analyzes the inner border (#9494FF) positioning in a _warp.png file
to quantify distortions, edge curvature, and corner alignment issues.

Usage:
  python analyze_border_distortion.py <warp_file.png> [--verbose]
  python analyze_border_distortion.py --dir ./test-output --verbose
"""

import cv2
import numpy as np
import argparse
import sys
import json
from pathlib import Path
from scipy.ndimage import gaussian_filter1d

# Constants from gbcam_common
SCREEN_W = 160
SCREEN_H = 144
INNER_TOP = 15
INNER_BOT = 128
INNER_LEFT = 15
INNER_RIGHT = 144
FRAME_THICK = 16
CAM_W = 128
CAM_H = 112


def _first_dark_from_frame(profile, smooth_sigma=1.5):
    """
    Sub-pixel index of the first dark pixel scanning FROM the white frame.
    """
    p = gaussian_filter1d(profile.astype(float), sigma=smooth_sigma)
    d = np.diff(p)
    k = int(np.argmin(d))
    delta = 0.0
    if 0 < k < len(d) - 1:
        d0, d1, d2 = float(d[k - 1]), float(d[k]), float(d[k + 1])
        denom = d0 - 2.0 * d1 + d2
        if abs(denom) > 1e-10:
            delta = float(np.clip(0.5 * (d0 - d2) / denom, -1.0, 1.0))
    return float(k + 1 + delta)


def analyze_warp_file(warp_path, scale=8, verbose=False):
    """Analyze a warped image and return distortion metrics."""
    
    img = cv2.imread(str(warp_path))
    if img is None:
        print(f"ERROR: Cannot read {warp_path}")
        return None
    
    H, W = img.shape[:2]
    print(f"\n{'='*70}")
    print(f"Analyzing: {Path(warp_path).name}")
    print(f"Image size: {W}x{H} px (scale factor: {scale})")
    print(f"Expected inner border at:")
    print(f"  Top:    y = {INNER_TOP * scale} px")
    print(f"  Bottom: y = {INNER_BOT * scale} px")
    print(f"  Left:   x = {INNER_LEFT * scale} px")
    print(f"  Right:  x = {INNER_RIGHT * scale} px")
    
    # Convert to RGB and extract R-B channel for border detection
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
    rb_ch = np.clip(rgb[:, :, 0] - rgb[:, :, 2] + 128.0, 0.0, 255.0).astype(np.uint8)
    
    results = {
        'file': str(warp_path),
        'image_size': [W, H],
        'scale': scale,
        'borders': {},
        'corners': {},
        'edge_straightness': {},
        'overall_error': 0.0
    }
    
    # Expected positions
    exp_top = INNER_TOP * scale
    exp_bottom = INNER_BOT * scale
    exp_left = INNER_LEFT * scale
    exp_right = INNER_RIGHT * scale
    
    srch = 6 * scale
    
    # ===== DETECT BORDER POSITIONS AT MULTIPLE POINTS ALONG EACH EDGE =====
    
    # Top edge: sample at 13 points across the width
    print(f"\n--- TOP EDGE ---")
    top_positions = []
    for col_frac in np.linspace(0.0, 1.0, 13):
        col = int(exp_left + (exp_right - exp_left) * col_frac)
        col = np.clip(col, 0, W - 1)
        r1, r2 = max(0, int(exp_top - srch)), min(H, int(exp_top + srch))
        if r1 < r2:
            profile = rb_ch[int(r1):int(r2), col].astype(float)
            y_pos = r1 + _first_dark_from_frame(profile)
            error = y_pos - exp_top
            top_positions.append((col_frac, y_pos, error))
            if verbose:
                print(f"  col {col:4d} (frac={col_frac:.2f}): detected={y_pos:7.2f}, expected={exp_top}, error={error:+7.2f}")
    
    # Bottom edge: sample at 13 points
    print(f"\n--- BOTTOM EDGE ---")
    bottom_positions = []
    for col_frac in np.linspace(0.0, 1.0, 13):
        col = int(exp_left + (exp_right - exp_left) * col_frac)
        col = np.clip(col, 0, W - 1)
        r1, r2 = max(0, int(exp_bottom - srch)), min(H, int(exp_bottom + srch))
        if r1 < r2:
            prof = rb_ch[int(r1):int(r2), col].astype(float)
            idx = _first_dark_from_frame(prof[::-1])
            y_pos = int(r2 - 1) - idx - (scale - 1)
            error = y_pos - exp_bottom
            bottom_positions.append((col_frac, y_pos, error))
            if verbose:
                print(f"  col {col:4d} (frac={col_frac:.2f}): detected={y_pos:7.2f}, expected={exp_bottom}, error={error:+7.2f}")
    
    # Left edge: sample at 13 points along height
    print(f"\n--- LEFT EDGE ---")
    left_positions = []
    for row_frac in np.linspace(0.0, 1.0, 13):
        row = int(exp_top + (exp_bottom - exp_top) * row_frac)
        row = np.clip(row, 0, H - 1)
        c1, c2 = max(0, int(exp_left - srch)), min(W, int(exp_left + srch))
        if c1 < c2:
            profile = rb_ch[row, int(c1):int(c2)].astype(float)
            x_pos = c1 + _first_dark_from_frame(profile)
            error = x_pos - exp_left
            left_positions.append((row_frac, x_pos, error))
            if verbose:
                print(f"  row {row:4d} (frac={row_frac:.2f}): detected={x_pos:7.2f}, expected={exp_left}, error={error:+7.2f}")
    
    # Right edge: sample at 13 points
    print(f"\n--- RIGHT EDGE ---")
    right_positions = []
    for row_frac in np.linspace(0.0, 1.0, 13):
        row = int(exp_top + (exp_bottom - exp_top) * row_frac)
        row = np.clip(row, 0, H - 1)
        c1, c2 = max(0, int(exp_right - srch)), min(W, int(exp_right + srch))
        if c1 < c2:
            prof = rb_ch[row, int(c1):int(c2)].astype(float)
            idx = _first_dark_from_frame(prof[::-1])
            x_pos = int(c2 - 1) - idx - (scale - 1)
            error = x_pos - exp_right
            right_positions.append((row_frac, x_pos, error))
            if verbose:
                print(f"  row {row:4d} (frac={row_frac:.2f}): detected={x_pos:7.2f}, expected={exp_right}, error={error:+7.2f}")
    
    # ===== ANALYZE EDGE QUALITY =====
    
    print(f"\n--- EDGE QUALITY ANALYSIS ---")
    
    # Top edge analysis
    if top_positions:
        top_errors = [e for _, _, e in top_positions]
        top_mean_error = np.mean(top_errors)
        top_std_error = np.std(top_errors)
        top_max_error = max(abs(e) for e in top_errors)
        top_curvature = max(top_errors) - min(top_errors)
        results['borders']['top'] = {
            'mean_error': float(top_mean_error),
            'std_error': float(top_std_error),
            'max_error': float(top_max_error),
            'curvature': float(top_curvature),
            'is_straight': abs(top_curvature) < 1.0
        }
        print(f"TOP:    mean_error={top_mean_error:+7.3f}  std={top_std_error:6.3f}  "
              f"max={top_max_error:7.3f}  curvature={top_curvature:7.3f}  "
              f"straight={abs(top_curvature) < 1.0}")
    
    # Bottom edge analysis
    if bottom_positions:
        bottom_errors = [e for _, _, e in bottom_positions]
        bottom_mean_error = np.mean(bottom_errors)
        bottom_std_error = np.std(bottom_errors)
        bottom_max_error = max(abs(e) for e in bottom_errors)
        bottom_curvature = max(bottom_errors) - min(bottom_errors)
        results['borders']['bottom'] = {
            'mean_error': float(bottom_mean_error),
            'std_error': float(bottom_std_error),
            'max_error': float(bottom_max_error),
            'curvature': float(bottom_curvature),
            'is_straight': abs(bottom_curvature) < 1.0
        }
        print(f"BOTTOM: mean_error={bottom_mean_error:+7.3f}  std={bottom_std_error:6.3f}  "
              f"max={bottom_max_error:7.3f}  curvature={bottom_curvature:7.3f}  "
              f"straight={abs(bottom_curvature) < 1.0}")
    
    # Left edge analysis
    if left_positions:
        left_errors = [e for _, _, e in left_positions]
        left_mean_error = np.mean(left_errors)
        left_std_error = np.std(left_errors)
        left_max_error = max(abs(e) for e in left_errors)
        left_curvature = max(left_errors) - min(left_errors)
        results['borders']['left'] = {
            'mean_error': float(left_mean_error),
            'std_error': float(left_std_error),
            'max_error': float(left_max_error),
            'curvature': float(left_curvature),
            'is_straight': abs(left_curvature) < 1.0
        }
        print(f"LEFT:   mean_error={left_mean_error:+7.3f}  std={left_std_error:6.3f}  "
              f"max={left_max_error:7.3f}  curvature={left_curvature:7.3f}  "
              f"straight={abs(left_curvature) < 1.0}")
    
    # Right edge analysis
    if right_positions:
        right_errors = [e for _, _, e in right_positions]
        right_mean_error = np.mean(right_errors)
        right_std_error = np.std(right_errors)
        right_max_error = max(abs(e) for e in right_errors)
        right_curvature = max(right_errors) - min(right_errors)
        results['borders']['right'] = {
            'mean_error': float(right_mean_error),
            'std_error': float(right_std_error),
            'max_error': float(right_max_error),
            'curvature': float(right_curvature),
            'is_straight': abs(right_curvature) < 1.0
        }
        print(f"RIGHT:  mean_error={right_mean_error:+7.3f}  std={right_std_error:6.3f}  "
              f"max={right_max_error:7.3f}  curvature={right_curvature:7.3f}  "
              f"straight={abs(right_curvature) < 1.0}")
    
    # ===== CORNER ANALYSIS =====
    
    print(f"\n--- CORNER ANALYSIS ---")
    
    # Get corner positions from the multi-point samples
    if top_positions and left_positions:
        tl_y = top_positions[0][1]
        tl_x = left_positions[0][1]
        tl_err_x = tl_x - exp_left
        tl_err_y = tl_y - exp_top
        print(f"TL: expected=({exp_left}, {exp_top})  detected=({tl_x:.1f}, {tl_y:.1f})  error=({tl_err_x:+.1f}, {tl_err_y:+.1f})")
        results['corners']['TL'] = {'detected': [tl_x, tl_y], 'expected': [exp_left, exp_top], 'error': [tl_err_x, tl_err_y]}
    
    if top_positions and right_positions:
        tr_y = top_positions[-1][1]
        tr_x = right_positions[0][1]
        tr_err_x = tr_x - exp_right
        tr_err_y = tr_y - exp_top
        print(f"TR: expected=({exp_right}, {exp_top})  detected=({tr_x:.1f}, {tr_y:.1f})  error=({tr_err_x:+.1f}, {tr_err_y:+.1f})")
        results['corners']['TR'] = {'detected': [tr_x, tr_y], 'expected': [exp_right, exp_top], 'error': [tr_err_x, tr_err_y]}
    
    if bottom_positions and right_positions:
        br_y = bottom_positions[-1][1]
        br_x = right_positions[-1][1]
        br_err_x = br_x - exp_right
        br_err_y = br_y - exp_bottom
        print(f"BR: expected=({exp_right}, {exp_bottom})  detected=({br_x:.1f}, {br_y:.1f})  error=({br_err_x:+.1f}, {br_err_y:+.1f})")
        results['corners']['BR'] = {'detected': [br_x, br_y], 'expected': [exp_right, exp_bottom], 'error': [br_err_x, br_err_y]}
    
    if bottom_positions and left_positions:
        bl_y = bottom_positions[0][1]
        bl_x = left_positions[-1][1]
        bl_err_x = bl_x - exp_left
        bl_err_y = bl_y - exp_bottom
        print(f"BL: expected=({exp_left}, {exp_bottom})  detected=({bl_x:.1f}, {bl_y:.1f})  error=({bl_err_x:+.1f}, {bl_err_y:+.1f})")
        results['corners']['BL'] = {'detected': [bl_x, bl_y], 'expected': [exp_left, exp_bottom], 'error': [bl_err_x, bl_err_y]}
    
    # ===== COMPUTE OVERALL ERROR METRIC =====
    
    all_errors = []
    for _, _, e in top_positions + bottom_positions + left_positions + right_positions:
        all_errors.append(abs(e))
    
    if all_errors:
        overall_rms = np.sqrt(np.mean(np.array(all_errors) ** 2))
        overall_max = max(all_errors)
        results['overall_error'] = float(overall_rms)
        results['max_error'] = float(overall_max)
        print(f"\n--- OVERALL METRICS ---")
        print(f"RMS error: {overall_rms:.3f} px")
        print(f"Max error: {overall_max:.3f} px")
        status = 'ACCEPTABLE' if overall_rms < 0.2 else 'NEEDS FIX'
        print(f"Status: {status}")
    
    return results


def main():
    parser = argparse.ArgumentParser(description="Analyze border distortion in warp outputs")
    parser.add_argument("inputs", nargs="*", help="Warp image files to analyze")
    parser.add_argument("--dir", "-d", help="Directory to search for _warp.png files")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--scale", type=int, default=8, help="Scale factor (default: 8)")
    args = parser.parse_args()
    
    files = []
    if args.dir:
        files = sorted(Path(args.dir).glob("**/*_warp.png"))
    else:
        files = [Path(f) for f in args.inputs]
    
    if not files:
        print("No files to analyze", file=sys.stderr)
        sys.exit(1)
    
    results_list = []
    for fpath in files:
        result = analyze_warp_file(str(fpath), args.scale, args.verbose)
        if result:
            results_list.append(result)
    
    # Summary
    print(f"\n{'='*70}")
    print(f"SUMMARY ({len(results_list)} files analyzed)")
    print(f"{'='*70}")
    for result in results_list:
        fname = Path(result['file']).name
        overall = result['overall_error']
        max_err = result['max_error']
        status = "OK" if overall < 0.2 else "FAIL"
        print(f"{status} {fname:50s}  RMS={overall:.3f}  MAX={max_err:.3f}")


if __name__ == "__main__":
    main()
