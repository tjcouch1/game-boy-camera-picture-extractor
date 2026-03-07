#!/usr/bin/env python3
"""
gbcam_crop.py — Crop step: remove the filmstrip frame

Takes the perspective-corrected grayscale output from the warp step and crops
out exactly the 128×112 GB Camera image area, discarding the surrounding white
filmstrip frame.

The warp step output is a clean (160*scale)×(144*scale) grayscale rectangle
where each GB pixel occupies (scale×scale) image pixels. The camera image
starts at GB pixel (16, 16) and is 128×112 GB pixels large, so in image-pixel
coordinates it occupies:
  x: [16*scale .. (16+128)*scale]
  y: [16*scale .. (16+112)*scale]

Input:  <stem>_warp.png  — from the warp step  (160*scale × 144*scale px)
Output: <stem>_crop.png  — (128*scale)×(112*scale) px, default 1024×896

Standalone usage:
  python gbcam_crop.py warp_file.png [...]  [options]
  python gbcam_crop.py --dir ./warp_outputs [options]

Options:
  --output-dir DIR    Output directory (default: same dir as input)
  --scale N           Pixels per GB pixel — must match warp step (default: 8)
  --debug             Save annotated debug image
"""

import cv2
import numpy as np
import argparse
import sys
import traceback
from pathlib import Path

from gbcam_common import (
    SCREEN_W, SCREEN_H, FRAME_THICK, CAM_W, CAM_H,
    STEP_SUFFIX,
    log, set_verbose, save_debug, collect_inputs, make_output_path,
)

SUFFIX = STEP_SUFFIX["crop"]


def process_file(input_path, output_path, scale=8, debug=False, debug_dir=None):
    stem = Path(input_path).stem
    log(f"\n{'='*60}", always=True)
    log(f"[crop] {input_path}", always=True)

    gray = cv2.imread(str(input_path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise RuntimeError(f"Cannot read image: {input_path}")

    expected_w, expected_h = SCREEN_W * scale, SCREEN_H * scale
    if gray.shape != (expected_h, expected_w):
        raise RuntimeError(
            f"Unexpected input size {gray.shape[1]}×{gray.shape[0]}; "
            f"expected {expected_w}×{expected_h}. "
            f"Did you pass a correct-step (or warp-step) output with the correct --scale?")
    log(f"  Loaded {gray.shape[1]}×{gray.shape[0]} px (scale={scale})")

    y1, x1 = FRAME_THICK * scale, FRAME_THICK * scale
    y2, x2 = y1 + CAM_H * scale, x1 + CAM_W * scale
    log(f"  Camera region: ({x1},{y1}) → ({x2},{y2})  "
        f"= {x2-x1}×{y2-y1} px  ({CAM_W}×{CAM_H} GB pixels)")

    # Validate: the inner border band just outside the crop should be darker
    # than the white frame
    border_mean = np.mean([
        gray[y1 - scale : y1,       x1 : x2].mean(),
        gray[y2 : y2 + scale,       x1 : x2].mean(),
        gray[y1 : y2, x1 - scale : x1].mean(),
        gray[y1 : y2, x2 : x2 + scale].mean(),
    ])
    white_mean = gray[scale : 4*scale, 20*scale : 140*scale].mean()
    ok = border_mean < white_mean * 0.85
    log(f"  Validation: inner border mean={border_mean:.1f}, "
        f"white frame mean={white_mean:.1f} "
        f"({'OK' if ok else 'WARNING — border not clearly darker than frame'})")

    crop = gray[y1:y2, x1:x2]

    if debug and debug_dir and stem:
        dbg = cv2.cvtColor(gray.copy(), cv2.COLOR_GRAY2BGR)
        cv2.rectangle(dbg, (x1, y1), (x2, y2), (0, 200, 0), 3)
        cv2.rectangle(dbg, (x1 - scale, y1 - scale),
                      (x2 + scale, y2 + scale), (0, 100, 255), scale)
        save_debug(dbg, debug_dir, stem, "crop_a_region")

    cv2.imwrite(str(output_path), crop)
    log(f"  Saved → {output_path}  ({crop.shape[1]}×{crop.shape[0]} px)", always=True)


def main():
    parser = argparse.ArgumentParser(
        description="Crop step: remove the filmstrip frame",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("inputs", nargs="*",
                        help="Correct-step output files (*_correct.png) to crop. "
                             "A warp-step output (*_warp.png) is also accepted if "
                             "skipping the correct step.")
    parser.add_argument("--dir", "-d", metavar="DIR",
                        help="Directory of correct-step (or warp-step) outputs to glob.")
    parser.add_argument("--output-dir", "-o", metavar="DIR",
                        help="Where to write *_crop.png outputs. Default: same "
                             "directory as each input file.")
    parser.add_argument("--scale", type=int, default=8, metavar="N",
                        help="Working resolution multiplier. Must match the value "
                             "used in all earlier steps. The crop boundaries are "
                             "computed as multiples of this value, so using a "
                             "different scale here than in the warp step will "
                             "crop the wrong region. Default: 8.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save a diagnostic image "
                             "(crop_a_region) showing the input image with the crop "
                             "boundary and inner border band highlighted in colour. "
                             "Saved to <output-dir>/debug/.")
    args = parser.parse_args()
    set_verbose(args.debug)
    files = collect_inputs(args.inputs, args.dir)
    if not files:
        parser.print_help(); print("\nError: no input files.", file=sys.stderr); sys.exit(1)
    debug_dir = (args.output_dir or ".") + "/debug" if args.debug else None
    errors = []
    for f in files:
        out = make_output_path(f, args.output_dir, SUFFIX)
        try:
            process_file(f, out, args.scale, args.debug, debug_dir)
        except Exception as e:
            print(f"ERROR — {f}: {e}", file=sys.stderr)
            if args.debug: traceback.print_exc()
            errors.append(f)
    print(f"\nDone — {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors: sys.exit(1)


if __name__ == "__main__":
    main()
