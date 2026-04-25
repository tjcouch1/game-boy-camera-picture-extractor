#!/usr/bin/env python3
"""
test_polynomial_degrees.py - Test different polynomial degrees

Runs the full correction and quantization pipeline with different polynomial
degrees (0, 1, 2, 3) to see which works best for each image.

Degree 0 = no spatial correction (global mean only)
Degree 1 = linear plane (simple gradient)
Degree 2 = quadratic (current default)
Degree 3 = cubic (more complex)

Usage:
  python test_polynomial_degrees.py test-output/thing-1/thing-1_warp.png reference.png
  python test_polynomial_degrees.py --all-tests
"""

import cv2
import numpy as np
import argparse
import sys
from pathlib import Path
import glob
import subprocess
import tempfile
import shutil

def run_pipeline_with_degree(warp_path, reference_path, poly_degree, temp_dir):
    """
    Run the correction and quantization pipeline with a specific polynomial degree.
    Returns the accuracy (matching percentage).
    """
    warp_path = Path(warp_path)
    reference_path = Path(reference_path)
    temp_dir = Path(temp_dir)

    name = warp_path.stem.replace('_warp', '')

    # Run correction with specified degree
    correct_path = temp_dir / f"{name}_correct_deg{poly_degree}.png"
    cmd_correct = [
        sys.executable, "gbcam_correct.py",
        str(warp_path),
        "--output-dir", str(temp_dir),
        "--poly-degree", str(poly_degree),
        "--scale", "8",
    ]

    result = subprocess.run(cmd_correct, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Correction failed for degree {poly_degree}", file=sys.stderr)
        return None

    # Find the output (it will be named <name>_correct.png in temp_dir)
    actual_correct_path = temp_dir / f"{name}_warp_correct.png"
    if not actual_correct_path.exists():
        print(f"  Correction output not found: {actual_correct_path}", file=sys.stderr)
        return None

    # Rename to our expected name
    shutil.move(str(actual_correct_path), str(correct_path))

    # Run crop
    crop_path = temp_dir / f"{name}_crop_deg{poly_degree}.png"
    cmd_crop = [
        sys.executable, "gbcam_crop.py",
        str(correct_path),
        "--output-dir", str(temp_dir),
        "--scale", "8",
    ]

    result = subprocess.run(cmd_crop, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Crop failed for degree {poly_degree}", file=sys.stderr)
        return None

    actual_crop_path = temp_dir / f"{name}_correct_deg{poly_degree}_crop.png"
    if not actual_crop_path.exists():
        print(f"  Crop output not found: {actual_crop_path}", file=sys.stderr)
        return None

    shutil.move(str(actual_crop_path), str(crop_path))

    # Run sample
    sample_path = temp_dir / f"{name}_sample_deg{poly_degree}.png"
    cmd_sample = [
        sys.executable, "gbcam_sample.py",
        str(crop_path),
        "--output-dir", str(temp_dir),
        "--scale", "8",
    ]

    result = subprocess.run(cmd_sample, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Sample failed for degree {poly_degree}", file=sys.stderr)
        return None

    actual_sample_path = temp_dir / f"{name}_crop_deg{poly_degree}_sample.png"
    if not actual_sample_path.exists():
        print(f"  Sample output not found: {actual_sample_path}", file=sys.stderr)
        return None

    shutil.move(str(actual_sample_path), str(sample_path))

    # Run quantize
    output_path = temp_dir / f"{name}_gbcam_deg{poly_degree}.png"
    cmd_quantize = [
        sys.executable, "gbcam_quantize.py",
        str(sample_path),
        "--output-dir", str(temp_dir),
    ]

    result = subprocess.run(cmd_quantize, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Quantize failed for degree {poly_degree}", file=sys.stderr)
        return None

    actual_output_path = temp_dir / f"{name}_sample_deg{poly_degree}_gbcam.png"
    if not actual_output_path.exists():
        print(f"  Quantize output not found: {actual_output_path}", file=sys.stderr)
        return None

    shutil.move(str(actual_output_path), str(output_path))

    # Compare with reference
    result_img = cv2.imread(str(output_path))
    reference_img = cv2.imread(str(reference_path))

    if result_img is None or reference_img is None:
        print(f"  Failed to load images for comparison", file=sys.stderr)
        return None

    # Convert to grayscale for comparison
    result_gray = cv2.cvtColor(result_img, cv2.COLOR_BGR2GRAY)
    reference_gray = cv2.cvtColor(reference_img, cv2.COLOR_BGR2GRAY)

    # Count matching pixels
    total_pixels = result_gray.size
    matching_pixels = np.sum(result_gray == reference_gray)
    accuracy = (matching_pixels / total_pixels) * 100

    return accuracy


def test_degrees_for_image(warp_path, reference_path, degrees=[0, 1, 2, 3]):
    """
    Test multiple polynomial degrees for a single image.
    """
    name = Path(warp_path).stem.replace('_warp', '')

    print(f"\n{'='*70}")
    print(f"Testing Polynomial Degrees: {name}")
    print(f"{'='*70}")

    results = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        for degree in degrees:
            print(f"\nTesting degree {degree}...", end=" ")
            sys.stdout.flush()

            try:
                accuracy = run_pipeline_with_degree(warp_path, reference_path,
                                                   degree, temp_dir)
                if accuracy is not None:
                    results[degree] = accuracy
                    print(f"Accuracy: {accuracy:.2f}%")
                else:
                    print("FAILED")
            except Exception as e:
                print(f"ERROR: {e}")
                import traceback
                traceback.print_exc()

    # Print summary for this image
    print(f"\nSummary for {name}:")
    print(f"{'Degree':<10} {'Accuracy':>12}")
    print("-" * 25)
    for degree in sorted(results.keys()):
        print(f"{degree:<10} {results[degree]:>11.2f}%")

    if results:
        best_degree = max(results.keys(), key=lambda d: results[d])
        best_accuracy = results[best_degree]
        print(f"\nBest: Degree {best_degree} with {best_accuracy:.2f}% accuracy")
    else:
        print("\nNo successful results")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Test different polynomial degrees for color correction",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("warp", nargs='?', help="Warp image (*_warp.png)")
    parser.add_argument("reference", nargs='?', help="Reference image for comparison")
    parser.add_argument("--all-tests", action="store_true",
                       help="Process all test images in test-output/")
    parser.add_argument("--degrees", type=int, nargs='+', default=[0, 1, 2, 3],
                       help="Polynomial degrees to test (default: 0 1 2 3)")
    args = parser.parse_args()

    if args.all_tests:
        # Find test images and their references
        _repo_root = str(Path(__file__).resolve().parent.parent.parent)
        test_configs = []

        # thing tests
        for i in [1, 2, 3]:
            warp_path = Path(f"{_repo_root}/test-output/thing-{i}/thing-{i}_warp.png")
            ref_path = Path(f"{_repo_root}/test-input/thing-output-corrected.png")
            if warp_path.exists() and ref_path.exists():
                test_configs.append((str(warp_path), str(ref_path)))

        # zelda-poster tests
        for i in [1, 2, 3]:
            warp_path = Path(f"{_repo_root}/test-output/zelda-poster-{i}/zelda-poster-{i}_warp.png")
            ref_path = Path(f"{_repo_root}/test-input/zelda-poster-output-corrected.png")
            if warp_path.exists() and ref_path.exists():
                test_configs.append((str(warp_path), str(ref_path)))

        if not test_configs:
            print("No test configurations found", file=sys.stderr)
            sys.exit(1)

        all_results = {}
        for warp_path, ref_path in test_configs:
            name = Path(warp_path).stem.replace('_warp', '')
            results = test_degrees_for_image(warp_path, ref_path, args.degrees)
            all_results[name] = results

        # Print overall summary
        print(f"\n{'='*70}")
        print("OVERALL SUMMARY: Polynomial Degree Comparison")
        print(f"{'='*70}")

        # Create table
        degrees = sorted(args.degrees)
        header = f"{'Test':<20}"
        for deg in degrees:
            header += f" {'Deg-' + str(deg):>10}"
        header += f" {'Best':>10}"
        print(header)
        print("-" * len(header))

        for test_name in sorted(all_results.keys()):
            results = all_results[test_name]
            row = f"{test_name:<20}"
            for deg in degrees:
                if deg in results:
                    row += f" {results[deg]:>9.2f}%"
                else:
                    row += f" {'N/A':>10}"

            if results:
                best_deg = max(results.keys(), key=lambda d: results[d])
                row += f" {best_deg:>10}"
            else:
                row += f" {'N/A':>10}"

            print(row)

        # Print average for each degree
        print("-" * len(header))
        row = f"{'Average':<20}"
        for deg in degrees:
            vals = [results[deg] for results in all_results.values() if deg in results]
            if vals:
                row += f" {np.mean(vals):>9.2f}%"
            else:
                row += f" {'N/A':>10}"
        print(row)

    else:
        if not args.warp or not args.reference:
            parser.print_help()
            print("\nError: provide warp and reference images, or use --all-tests",
                  file=sys.stderr)
            sys.exit(1)

        test_degrees_for_image(args.warp, args.reference, args.degrees)


if __name__ == "__main__":
    main()
