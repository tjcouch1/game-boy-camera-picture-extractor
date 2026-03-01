#!/usr/bin/env python3
"""
gbcam_extract.py — Game Boy Camera image extractor (pipeline orchestrator)
"""

import argparse
import glob
import os
import sys
import textwrap
import traceback
from pathlib import Path

from gbcam_common import (
    STEP_ORDER, STEP_SUFFIX, STEP_INPUT_SUFFIX, STEP_DESCRIPTION,
    log, set_verbose, collect_inputs, make_output_path, strip_step_suffix,
)

import gbcam_warp     as step_warp
import gbcam_correct  as step_correct
import gbcam_crop     as step_crop
import gbcam_sample   as step_sample
import gbcam_quantize as step_quantize

_STEP_MOD = {
    "warp":     step_warp,
    "correct":  step_correct,
    "crop":     step_crop,
    "sample":   step_sample,
    "quantize": step_quantize,
}


# ─────────────────────────────────────────────────────────────
# Help text
# ─────────────────────────────────────────────────────────────

def _build_help():
    lines = []
    w = 78

    def rule(char="─"):
        return char * w

    def wrap(text, indent=2):
        return textwrap.fill(text, width=w - indent,
                             initial_indent=" " * indent,
                             subsequent_indent=" " * indent)

    lines += [
        "",
        "OVERVIEW",
        rule(),
        wrap(
            "Transforms phone photos of a Game Boy Advance SP screen into clean "
            "128×112 four-color Game Boy Camera images. The GBA SP front-lit screen "
            "introduces perspective distortion, washed-out colors, uneven lighting, "
            "and pixel-gap/bleeding artifacts — this pipeline corrects all of them."
        ),
        "",
        "PIPELINE STEPS  (run in order: warp → crop → sample → quantize)",
        rule(),
    ]

    step_inputs = {
        "warp":     "phone photo (.jpg / .png, any size)",
        "correct":  "<stem>_warp.png    — from the warp step",
        "crop":     "<stem>_correct.png — from the correct step",
        "sample":   "<stem>_crop.png    — from the crop step",
        "quantize": "<stem>_sample.png  — from the sample step",
    }
    step_outputs = {
        "warp":     "<stem>_warp.png    — (160×scale)×(144×scale) px grayscale, default 1280×1152",
        "correct":  "<stem>_correct.png — same dimensions, brightness-normalized",
        "crop":     "<stem>_crop.png    — (128×scale)×(112×scale) px grayscale, default 1024×896",
        "sample":   "<stem>_sample.png  — 128×112 px grayscale (raw brightness values, 0–255)",
        "quantize": "<stem>_gbcam.png   — 128×112 px, values exactly 0 / 82 / 165 / 255",
    }

    for name in STEP_ORDER:
        lines += [
            f"  {name.upper()}   (gbcam_{name}.py)",
            wrap(STEP_DESCRIPTION[name], indent=4),
            f"    Input:  {step_inputs[name]}",
            f"    Output: {step_outputs[name]}",
            "",
        ]

    lines += [
        "COLOR CORRECTION",
        rule(),
        wrap(
            "Color correction is handled by the dedicated correct step, which runs "
            "between warp and crop. The GBA SP side-mounted front-light creates a "
            "smooth 2-D brightness gradient — both horizontally and vertically — "
            "across the screen. The effect is affine per pixel: the black floor and "
            "white ceiling both shift together, so a global or row-only correction "
            "is insufficient. The correct step fits a degree-2 bivariate polynomial "
            "independently to two sets of reference measurements collected from the "
            "screen's own built-in geometry: the white filmstrip frame strips (all 4 "
            "sides) supply the observed white level across the full image area, and "
            "the 1-GB-pixel-wide inner #525252 border bands (all 4 sides of the "
            "camera region) supply the observed dark level at every position around "
            "the camera boundary. The per-pixel affine model is then inverted so that "
            "the four GB colors are uniformly distributed regardless of their position."
        ),
        "",
        "TUNABLE PARAMETERS",
        rule(),
        "  Correct step:",
        "    --poly-degree N      Polynomial degree for brightness surface fit (default: 2).",
        "                        Degree 1 = flat affine plane. Degree 2 adds curvature.",
        "                        Increase if correction still shows residual gradient.",
        "",
        "  Sample step:",
        "    --sample-margin N    Interior margin on all 4 sides of each GB-pixel block",
        "                        (default: auto = max(1, scale//5) = 1 at scale=8).",
        "                        At scale=8 margin=1 gives a 6×6 interior region.",
        "                        Increase to avoid more gap/bleed; decrease to use more pixels.",
        "    --sample-margin-h N  Horizontal-only margin (overrides --sample-margin).",
        "    --sample-margin-v N  Vertical-only margin (overrides --sample-margin).",
        "    --sample-method M    How to aggregate the interior block (default: median).",
        "                        Choices: median, mean, mode, min, max, pNN (e.g. p25, p75).",
        "",
        "  Quantize step:",
        "    --no-kmeans          Skip k-means; use frame calibration or min/max instead.",
        "",
        "  Warp step:",
        "    --threshold T        Brightness threshold for corner detection (default: 180).",
        "",
        "HOUSEKEEPING",
        rule(),
        "    --clean-steps        After processing, remove all intermediate step files",
        "                        (warp, correct, crop, sample). With --debug they are moved",
        "                        to the debug folder instead of deleted. The final output",
        "                        (_gbcam.png or the --end step output) is always kept.",
        "",
        "USAGE",
        rule(),
        "  Full pipeline on a folder of photos:",
        "    python gbcam_extract.py --dir ./photos --output-dir ./out",
        "",
        "  Full pipeline on specific files:",
        "    python gbcam_extract.py photo1.jpg photo2.jpg --output-dir ./out",
        "",
        "  With debug images saved at every step:",
        "    python gbcam_extract.py --dir ./photos --output-dir ./out --debug",
        "",
        "  Resume from the correct step (inputs are warp-step outputs):",
        "    python gbcam_extract.py --start correct --dir ./out --output-dir ./out",
        "",
        "  Resume from the crop step (inputs are correct-step outputs):",
        "    python gbcam_extract.py --start crop --dir ./out --output-dir ./out",
        "",
        "  Resume from the sample step (inputs are crop-step outputs):",
        "    python gbcam_extract.py --start sample --dir ./out --output-dir ./out",
        "",
        "  Resume from the quantize step (inputs are sample-step outputs):",
        "    python gbcam_extract.py --start quantize --dir ./out --output-dir ./out",
        "",
        "  Run only the warp step and stop:",
        "    python gbcam_extract.py --dir ./photos --end warp --output-dir ./out",
        "",
        "  Run only the correct step in isolation:",
        "    python gbcam_extract.py --start correct --end correct --dir ./out --output-dir ./out",
        "",
        "  Try quantize again without k-means:",
        "    python gbcam_extract.py --start quantize --dir ./out --output-dir ./out --no-kmeans",
        "",
        "  Run any step as a standalone script (same --dir / --output-dir flags):",
        "    python gbcam_warp.py     photo.jpg            --output-dir ./out",
        "    python gbcam_correct.py  photo_warp.png       --output-dir ./out",
        "    python gbcam_crop.py     photo_correct.png    --output-dir ./out",
        "    python gbcam_sample.py   photo_crop.png       --output-dir ./out",
        "    python gbcam_quantize.py photo_sample.png     --output-dir ./out",
        "",
        "  When using --start, point --dir at the folder that holds the outputs of",
        "  the previous step. The orchestrator looks for files ending in the right",
        "  suffix automatically:",
        "    --start correct  looks for  *_warp.png",
        "    --start crop     looks for  *_correct.png",
        "    --start sample   looks for  *_crop.png",
        "    --start quantize looks for  *_sample.png",
        "",
        "OPTIONS",
        rule(),
    ]

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────
# Input collection
# ─────────────────────────────────────────────────────────────

def _collect_for_start(inputs_list, directory, start_step):
    """
    Collect input files appropriate for the given start step name.
    - warp:     any jpg/png  (raw phone photos)
    - crop/sample/quantize: files ending in the previous step's suffix
    """
    if start_step == "warp":
        return collect_inputs(inputs_list, directory)

    suffix = STEP_INPUT_SUFFIX[start_step]
    files  = list(inputs_list or [])
    if directory:
        files.extend(glob.glob(os.path.join(directory, f"*{suffix}.png")))
    return files


# ─────────────────────────────────────────────────────────────
# Pipeline runner
# ─────────────────────────────────────────────────────────────

def run_pipeline(input_files, output_dir,
                 start_step="warp", end_step="quantize",
                 scale=8, thresh_val=180,
                 poly_degree=2,
                 sample_margin_h=None, sample_margin_v=None, sample_method="median",
                 use_kmeans=True,
                 clean_steps=False,
                 debug=False, debug_dir=None):
    """
    Run the pipeline for a list of input files.

    Returns (errors, all_intermediate_paths) where all_intermediate_paths is
    a list of files created by non-final steps (used by --clean-steps).
    """
    start_idx    = STEP_ORDER.index(start_step)
    end_idx      = STEP_ORDER.index(end_step)
    errors       = []
    intermediates = []   # files that should be cleaned up if --clean-steps

    for inp in input_files:
        inp_path = Path(inp)
        if not inp_path.exists():
            print(f"WARNING: not found: {inp}", file=sys.stderr)
            continue

        base_stem = strip_step_suffix(inp_path.stem)
        out_base  = Path(output_dir) if output_dir else inp_path.parent
        out_base.mkdir(parents=True, exist_ok=True)

        try:
            def out_for(step_name):
                return str(out_base / (base_stem + STEP_SUFFIX[step_name] + ".png"))

            current_file = str(inp_path)

            for step_name in STEP_ORDER[start_idx : end_idx + 1]:
                out_path = out_for(step_name)
                is_final = (step_name == end_step)

                if step_name == "warp":
                    step_warp.process_file(
                        current_file, out_path,
                        scale=scale, thresh_val=thresh_val,
                        debug=debug, debug_dir=debug_dir)

                elif step_name == "correct":
                    in_path = out_for("warp") if start_idx < STEP_ORDER.index("correct") else current_file
                    step_correct.process_file(
                        in_path, out_path,
                        scale=scale, poly_degree=poly_degree,
                        debug=debug, debug_dir=debug_dir)

                elif step_name == "crop":
                    in_path = out_for("correct") if start_idx < STEP_ORDER.index("crop") else current_file
                    step_crop.process_file(
                        in_path, out_path,
                        scale=scale,
                        debug=debug, debug_dir=debug_dir)

                elif step_name == "sample":
                    in_path = out_for("crop") if start_idx < STEP_ORDER.index("sample") else current_file
                    step_sample.process_file(
                        in_path, out_path,
                        scale=scale,
                        h_margin=sample_margin_h, v_margin=sample_margin_v,
                        method=sample_method,
                        debug=debug, debug_dir=debug_dir)

                elif step_name == "quantize":
                    in_path = out_for("sample") if start_idx < STEP_ORDER.index("quantize") else current_file
                    step_quantize.process_file(
                        in_path, out_path,
                        use_kmeans=use_kmeans, scale=scale,
                        debug=debug, debug_dir=debug_dir)

                if not is_final:
                    intermediates.append(out_path)
                current_file = out_path

        except Exception as exc:
            print(f"\nERROR — {inp}: {exc}", file=sys.stderr)
            if debug:
                traceback.print_exc()
            errors.append((inp, exc))

    # ── Clean up intermediate files ──────────────────────────
    if clean_steps and intermediates:
        kept, removed = 0, 0
        for path in intermediates:
            if not os.path.exists(path):
                continue
            if debug and debug_dir:
                # Move to debug directory
                os.makedirs(debug_dir, exist_ok=True)
                dest = os.path.join(debug_dir, os.path.basename(path))
                os.replace(path, dest)
                kept += 1
            else:
                os.remove(path)
                removed += 1
        if kept:
            print(f"  [clean-steps] Moved {kept} intermediate file(s) to {debug_dir}/")
        if removed:
            print(f"  [clean-steps] Deleted {removed} intermediate file(s).")

    return errors


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

class _HelpFormatter(argparse.RawDescriptionHelpFormatter):
    """Keep the epilog verbatim but wrap the description normally."""
    pass


def main():
    parser = argparse.ArgumentParser(
        prog="gbcam_extract.py",
        description="Game Boy Camera image extractor — pipeline orchestrator",
        formatter_class=_HelpFormatter,
        epilog=_build_help(),
        add_help=True,
    )
    parser.add_argument(
        "inputs", nargs="*",
        help="Input files. For --start warp: phone photos. "
             "For later start steps: the output files of the previous step.")
    parser.add_argument(
        "--dir", "-d", metavar="DIR",
        help="Directory to glob for input files.")
    parser.add_argument(
        "--output-dir", "-o", metavar="DIR",
        help="Directory for all output files. Defaults to the same directory "
             "as each input file.")
    parser.add_argument(
        "--start", metavar="STEP", default="warp",
        choices=STEP_ORDER,
        help=f"Begin the pipeline at this step. Choices: {', '.join(STEP_ORDER)}. "
             f"Default: warp. When starting after warp, input files must be "
             f"the outputs of the previous step.")
    parser.add_argument(
        "--end", metavar="STEP", default="quantize",
        choices=STEP_ORDER,
        help=f"Stop after this step. Choices: {', '.join(STEP_ORDER)}. "
             f"Default: quantize.")
    parser.add_argument(
        "--scale", type=int, default=8, metavar="N",
        help="Working pixels per GB pixel. Must be consistent across all steps "
             "for the same image. Default: 8.")
    parser.add_argument(
        "--threshold", type=int, default=180, metavar="T",
        help="Brightness threshold for screen corner detection (warp step only). "
             "Lower if the screen is dim; raise if background is bright. Default: 180.")
    parser.add_argument(
        "--no-kmeans", action="store_true",
        help="Quantize step: skip k-means clustering and use frame-geometry "
             "reference points (or sample min/max as a last resort) instead.")

    # ── Correct step parameters ──────────────────────────────
    parser.add_argument(
        "--poly-degree", type=int, default=2, metavar="N",
        help="Correct step: degree of the bivariate polynomial used to fit "
             "the front-light brightness surface (default: 2). "
             "Degree 1 = affine plane; degree 2 = adds curvature.")

    # ── Sample step parameters ───────────────────────────────
    parser.add_argument(
        "--sample-margin", type=int, default=None, metavar="N",
        help="Sample step: set both h and v interior margins for each GB-pixel "
             "block. Default: auto = max(1, scale//5), which is 1 at scale=8, "
             "giving a 6×6 interior region.")
    parser.add_argument(
        "--sample-margin-h", type=int, default=None, metavar="N",
        help="Sample step: horizontal-only interior margin (overrides --sample-margin).")
    parser.add_argument(
        "--sample-margin-v", type=int, default=None, metavar="N",
        help="Sample step: vertical-only interior margin (overrides --sample-margin).")
    parser.add_argument(
        "--sample-method", default="median", metavar="METHOD",
        help="Sample step: how to aggregate the interior block pixels into a "
             "single brightness value. Default: median. "
             "Choices: median, mean, mode, min, max, pNN (e.g. p25, p75, p90).")

    # ── Housekeeping ─────────────────────────────────────────
    parser.add_argument(
        "--clean-steps", action="store_true",
        help="After all images are processed, remove the intermediate step "
             "files (warp, correct, crop, sample). With --debug they are moved "
             "into the debug folder instead of deleted. The final output "
             "(_gbcam.png, or the --end step output) is always kept.")
    parser.add_argument(
        "--debug", action="store_true",
        help="Save intermediate debug images at every step into "
             "<output-dir>/debug/. Also enables verbose logging.")

    args = parser.parse_args()

    start_idx = STEP_ORDER.index(args.start)
    end_idx   = STEP_ORDER.index(args.end)
    if start_idx > end_idx:
        print(f"Error: --start {args.start} comes after --end {args.end} in the pipeline.",
              file=sys.stderr)
        sys.exit(1)

    set_verbose(args.debug)

    input_files = _collect_for_start(args.inputs, args.dir, args.start)
    if not input_files:
        parser.print_help()
        print(f"\nError: no input files found for --start {args.start}.",
              file=sys.stderr)
        if args.start != "warp":
            expected = STEP_INPUT_SUFFIX[args.start]
            print(f"  Expected files ending in '{expected}.png' "
                  f"(outputs of the {STEP_ORDER[start_idx-1]} step).",
                  file=sys.stderr)
        sys.exit(1)

    active_steps = " → ".join(STEP_ORDER[start_idx : end_idx + 1])
    print(f"Pipeline: {active_steps}  |  scale={args.scale}  |  "
          f"{len(input_files)} input file(s)")

    out_dir   = args.output_dir or None
    debug_dir = (args.output_dir or ".") + "/debug" if args.debug else None

    # Resolve sample margin args (specific h/v override the combined flag)
    hm = args.sample_margin_h if args.sample_margin_h is not None else args.sample_margin
    vm = args.sample_margin_v if args.sample_margin_v is not None else args.sample_margin

    errors = run_pipeline(
        input_files     = input_files,
        output_dir      = out_dir,
        start_step      = args.start,
        end_step        = args.end,
        scale           = args.scale,
        thresh_val      = args.threshold,
        poly_degree     = args.poly_degree,
        sample_margin_h = hm,
        sample_margin_v = vm,
        sample_method   = args.sample_method,
        use_kmeans      = not args.no_kmeans,
        clean_steps     = args.clean_steps,
        debug           = args.debug,
        debug_dir       = debug_dir,
    )

    n_ok = len(input_files) - len(errors)
    print(f"\nDone — {n_ok} succeeded, {len(errors)} failed.")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
