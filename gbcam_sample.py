#!/usr/bin/env python3
"""
gbcam_sample.py — Sample step: per-pixel brightness sampling

Takes the cropped camera area from the crop step and produces a 128×112
grayscale image where each pixel holds the single representative brightness
for the corresponding GB Camera pixel.

Each GB pixel occupies a (scale×scale) block of image pixels.  The physical
GB screen has horizontal pixel gaps (~1 px between columns) and pixel bleeding
(bright pixels bleed vertically into adjacent darker ones).  To get a reliable
brightness reading, only the interior of each block is sampled, skipping
h_margin pixels on each horizontal edge and v_margin pixels on each vertical
edge.  A statistical aggregate of the remaining interior pixels is taken.

SAMPLING METHODS
  mean    — arithmetic mean (default; reduces bias at tone boundaries)
  mean    — arithmetic mean
  mode    — most common value (rounded to nearest integer)
  min     — minimum (darkest interior pixel)
  max     — maximum (brightest interior pixel)
  p10, p25, p75, p90, pNN — Nth percentile

MARGIN DEFAULTS
  At scale=8: h_margin=2, v_margin=1, giving a 4×6 sample interior.
  Auto: h=max(2, scale//4), v=max(1, scale//5). Use --sample-margin to override.

Input:  <stem>_crop.png   — from the crop step  ((128*scale)×(112*scale) px)
Output: <stem>_sample.png — 128×112 grayscale PNG (raw brightness, 0–255)

Standalone usage:
  python gbcam_sample.py crop_file.png [...]  [options]
  python gbcam_sample.py --dir ./crop_outputs [options]

Options:
  --output-dir DIR        Output directory (default: same dir as input)
  --scale N               Pixels per GB pixel (default: 8)
  --sample-margin N       Set both h and v interior margins (default: auto h=max(2,scale//4), v=max(1,scale//5))
  --sample-margin-h N     Horizontal-only interior margin (overrides --sample-margin)
  --sample-margin-v N     Vertical-only interior margin (overrides --sample-margin)
  --sample-method METHOD  Aggregation method for interior block (default: mean)
                          Choices: median, mean, mode, min, max, p10, p25, p75, p90, pNN
  --debug                 Save 8× upscaled debug image
"""

import cv2
import numpy as np
import argparse
import sys
import traceback
from pathlib import Path

from gbcam_common import (
    CAM_W, CAM_H, STEP_SUFFIX,
    log, set_verbose, save_debug, collect_inputs, make_output_path,
)

SUFFIX = STEP_SUFFIX["sample"]

VALID_METHODS = ("median", "mean", "mode", "min", "max")


def _parse_method(method_str):
    """Return a callable that aggregates a 1-D float array to a single value."""
    s = method_str.strip().lower()
    if s == "median":
        return np.median
    if s == "mean":
        return np.mean
    if s == "min":
        return np.min
    if s == "max":
        return np.max
    if s == "mode":
        from scipy import stats as _stats
        def _mode(arr):
            # round to nearest int then find mode
            rounded = np.round(arr).astype(int)
            return float(_stats.mode(rounded, keepdims=True).mode[0])
        return _mode
    if s.startswith("p") and s[1:].isdigit():
        pct = int(s[1:])
        if not (0 <= pct <= 100):
            raise ValueError(f"Percentile must be 0–100, got {pct}")
        return lambda arr, _p=pct: float(np.percentile(arr, _p))
    raise ValueError(
        f"Unknown sample method '{method_str}'. "
        f"Valid: median, mean, mode, min, max, pNN (e.g. p25, p75).")


def process_file(input_path, output_path, scale=8,
                 h_margin=None, v_margin=None, method="mean",
                 debug=False, debug_dir=None):
    """
    Sample one brightness value per GB pixel from a crop-step output.

    Parameters
    ----------
    h_margin : int or None
        Pixels to skip on each horizontal (left/right) side of each block.
        None → use auto formula: h=max(2,scale//4), v=max(1,scale//5).
    v_margin : int or None
        Pixels to skip on each vertical (top/bottom) side.
        None → use auto formula: h=max(2,scale//4), v=max(1,scale//5).
    method : str
        Aggregation method name (see module docstring).
    """
    stem = Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[sample] {input_path}", always=True)

    gray = cv2.imread(str(input_path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise RuntimeError(f"Cannot read image: {input_path}")

    expected_w, expected_h = CAM_W * scale, CAM_H * scale
    if gray.shape != (expected_h, expected_w):
        raise RuntimeError(
            f"Unexpected input size {gray.shape[1]}×{gray.shape[0]}; "
            f"expected {expected_w}×{expected_h}. "
            f"Did you pass a crop-step output with the correct --scale?")
    log(f"  Loaded {gray.shape[1]}×{gray.shape[0]} px  "
        f"({CAM_W}×{CAM_H} GB pixels at scale={scale})")

    # Resolve margins
    # Auto horizontal margin = 2 (excludes inter-column pixel gaps more aggressively)
    # Auto vertical margin = max(1, scale // 5) (excludes pixel bleeding between rows)
    auto_h = max(2, scale // 4)
    auto_v = max(1, scale // 5)
    hm = h_margin if h_margin is not None else auto_h
    vm = v_margin if v_margin is not None else auto_v

    # Validate: margins must leave at least 1 pixel
    max_hm = (scale - 1) // 2
    max_vm = (scale - 1) // 2
    if hm > max_hm:
        log(f"  WARNING: --sample-margin-h {hm} too large for scale={scale}; "
            f"clamped to {max_hm}")
        hm = max_hm
    if vm > max_vm:
        log(f"  WARNING: --sample-margin-v {vm} too large for scale={scale}; "
            f"clamped to {max_vm}")
        vm = max_vm

    log(f"  Block {scale}×{scale}  margins h={hm} v={vm}  "
        f"sample region {scale-2*hm}×{scale-2*vm}  method={method}", always=True)

    aggregate = _parse_method(method)

    samples    = np.empty((CAM_H, CAM_W), dtype=np.float32)
    medians    = np.empty((CAM_H, CAM_W), dtype=np.float32)
    zerocounts = np.zeros((CAM_H, CAM_W), dtype=np.uint8)
    for gy in range(CAM_H):
        for gx in range(CAM_W):
            y1 = gy * scale + vm;  y2 = (gy + 1) * scale - vm
            x1 = gx * scale + hm;  x2 = (gx + 1) * scale - hm
            block = gray[y1:y2, x1:x2]
            if block.size > 0:
                flat = block.ravel().astype(float)
            else:
                # Fallback if margins are too large
                flat = gray[gy*scale:(gy+1)*scale, gx*scale:(gx+1)*scale].ravel().astype(float)
            samples[gy, gx]    = aggregate(flat)
            medians[gy, gx]    = float(np.median(flat))
            zerocounts[gy, gx] = int((flat == 0).sum())

    log(f"  Stats: min={samples.min():.1f}  max={samples.max():.1f}  "
        f"mean={samples.mean():.1f}")

    output_path = Path(output_path)
    output_arr = np.clip(np.round(samples), 0, 255).astype(np.uint8)
    cv2.imwrite(str(output_path), output_arr)
    log(f"  Saved → {output_path}  (128×112 px)", always=True)

    # Save auxiliary stat images consumed by the quantize step.
    stem = output_path.stem
    med_path = output_path.parent / (stem + "_med" + output_path.suffix)
    zc_path  = output_path.parent / (stem + "_zc"  + output_path.suffix)
    cv2.imwrite(str(med_path), np.clip(np.round(medians), 0, 255).astype(np.uint8))
    cv2.imwrite(str(zc_path),  zerocounts)

    if debug and debug_dir and stem:
        big = np.repeat(np.repeat(output_arr, 8, axis=0), 8, axis=1)
        save_debug(big, debug_dir, stem, "sample_a_8x")


def main():
    parser = argparse.ArgumentParser(
        description="Sample step: per-pixel brightness sampling",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    parser.add_argument("inputs", nargs="*",
                        help="Crop-step output files (*_crop.png) to sample.")
    parser.add_argument("--dir", "-d", metavar="DIR",
                        help="Directory of crop-step outputs to glob.")
    parser.add_argument("--output-dir", "-o", metavar="DIR",
                        help="Where to write *_sample.png outputs. Default: same "
                             "directory as each input file.")
    parser.add_argument("--scale", type=int, default=8, metavar="N",
                        help="Working resolution multiplier. Must match the value "
                             "used in all earlier steps. Default: 8.")
    parser.add_argument("--sample-margin", type=int, default=None, metavar="N",
                        help="Pixels to discard on each side of every GB-pixel block "
                             "before measuring its brightness. Sets both horizontal "
                             "and vertical margins equally. The GB LCD has two "
                             "spatial artifacts that contaminate block edges: pixel "
                             "gaps (dark vertical stripes between LCD columns, "
                             "visible on left/right block edges) and pixel bleeding "
                             "(bright pixels bleed vertically into adjacent rows, "
                             "visible on top/bottom edges). Increasing the margin "
                             "excludes more contaminated edge pixels at the cost of "
                             "using a smaller interior sample. Use "
                             "--sample-margin-h / --sample-margin-v to set "
                             "independently. Default: auto = max(1, scale // 5), "
                             "which is 1 at scale=8, leaving a 6x6 interior.")
    parser.add_argument("--sample-margin-h", type=int, default=None, metavar="N",
                        help="Horizontal-only interior margin (pixels skipped on "
                             "left and right of each block). Targets pixel gaps "
                             "between LCD columns. Overrides the horizontal component "
                             "of --sample-margin. Default: auto (see --sample-margin).")
    parser.add_argument("--sample-margin-v", type=int, default=None, metavar="N",
                        help="Vertical-only interior margin (pixels skipped on top "
                             "and bottom of each block). Targets pixel bleeding "
                             "between rows. Overrides the vertical component of "
                             "--sample-margin. Default: auto (see --sample-margin).")
    parser.add_argument("--sample-method", default="mean", metavar="METHOD",
                        help="How to collapse the interior block pixels into a single "
                             "brightness value. Choices: mean (default), median, mode, "
                             "min, max, or pNN where NN is 0-100 (e.g. p25, p75, p90). "
                             "mean: arithmetic average, uses all pixels, reduces bias at "
                             "tone boundaries (default). "
                             "median: middle value after sorting, robust to surviving "
                             "edge artifacts but can introduce slight boundary bias. "
                             "mode: most common integer value, works poorly when "
                             "optical blur spreads values across a continuous range. "
                             "min / max: darkest or brightest interior pixel, useful "
                             "for diagnosis or correcting a systematic brightness bias. "
                             "pNN: p25 biases toward darker readings (helps when "
                             "bleeding dominates), p75 toward brighter (helps when "
                             "gaps dominate), p50 equals median.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save a diagnostic 8x "
                             "upscaled image (sample_a_8x) so individual GB pixels "
                             "are visible as blocks. Saved to <output-dir>/debug/.")
    args = parser.parse_args()

    set_verbose(args.debug)
    files = collect_inputs(args.inputs, args.dir)
    if not files:
        parser.print_help(); print("\nError: no input files.", file=sys.stderr); sys.exit(1)

    # Resolve margin args: specific h/v override the combined flag
    hm = args.sample_margin_h if args.sample_margin_h is not None else args.sample_margin
    vm = args.sample_margin_v if args.sample_margin_v is not None else args.sample_margin

    debug_dir = (args.output_dir or ".") + "/debug" if args.debug else None
    errors = []
    for f in files:
        out = make_output_path(f, args.output_dir, SUFFIX)
        try:
            process_file(f, out, args.scale, hm, vm, args.sample_method,
                         args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
