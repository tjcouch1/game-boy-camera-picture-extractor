#!/usr/bin/env python3
"""
test_pipeline.py — Pipeline regression test against a hand-corrected reference image.

Runs the full gbcam pipeline on an input photo, compares the result pixel-by-pixel
against a reference image, and prints comprehensive diagnostics so failures can be
diagnosed and fixed.

Usage:
    python test_pipeline.py --input PHOTO --reference REFERENCE_GBCAM_PNG [options]

    --input PHOTO           Phone photo to process (e.g. 20260216_130838~2.jpg)
    --reference REF.png     Hand-corrected 128×112 four-color reference image
    --output-dir DIR        Where to write pipeline outputs and diagnostic images
                            (default: ./test_output)
    --keep-intermediates    Do not delete intermediate step files after the run
    --scale N               Pipeline scale (default: 8)
    --threshold T           Warp threshold (default: 180)
    --poly-degree N         Correct polynomial degree (default: 2)
    --sample-margin N       Sample margin (default: auto)
    --sample-margin-h N     Horizontal sample margin (default: auto)
    --sample-margin-v N     Vertical sample margin (default: auto)
    --sample-method METHOD  Sample aggregation method (default: median)
    --no-kmeans             Skip k-means in quantize step

Exit code:
    0  — all pixels match
    1  — one or more pixels differ (or pipeline error)
"""

import argparse
import os
import sys
import tempfile
import traceback
from pathlib import Path

import cv2
import numpy as np

# ── GB palette ────────────────────────────────────────────────────────────────
GB_COLORS   = [0, 82, 165, 255]
COLOR_NAMES = {0: "black (#000000)", 82: "dark-gray (#525252)",
               165: "light-gray (#A5A5A5)", 255: "white (#FFFFFF)"}

# ─────────────────────────────────────────────────────────────────────────────
# Run pipeline
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline(input_path, output_dir, scale=8, thresh_val=180, poly_degree=2,
                 sample_margin_h=None, sample_margin_v=None, sample_method="median",
                 use_kmeans=True, debug=True):
    """Run the full pipeline and return the path to the _gbcam.png output."""
    # Import here so the test can be run from the pipeline directory
    sys.path.insert(0, str(Path(__file__).parent))
    from gbcam_common import STEP_SUFFIX, strip_step_suffix
    import gbcam_warp     as step_warp
    import gbcam_correct  as step_correct
    import gbcam_crop     as step_crop
    import gbcam_sample   as step_sample
    import gbcam_quantize as step_quantize
    from gbcam_common import set_verbose
    set_verbose(True)

    out   = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    dbg   = str(out / "debug")
    stem  = strip_step_suffix(Path(input_path).stem)

    def p(suffix):
        return str(out / (stem + suffix + ".png"))

    print(f"\n{'='*70}")
    print(f"PIPELINE RUN")
    print(f"  Input:      {input_path}")
    print(f"  Output dir: {output_dir}")
    print(f"  scale={scale}  threshold={thresh_val}  poly_degree={poly_degree}")
    print(f"  sample_margin_h={sample_margin_h}  sample_margin_v={sample_margin_v}")
    print(f"  sample_method={sample_method}  kmeans={use_kmeans}")
    print(f"{'='*70}\n")

    step_warp.process_file(input_path, p("_warp"),
                           scale=scale, thresh_val=thresh_val,
                           debug=debug, debug_dir=dbg)
    step_correct.process_file(p("_warp"), p("_correct"),
                              scale=scale, poly_degree=poly_degree,
                              debug=debug, debug_dir=dbg)
    step_crop.process_file(p("_correct"), p("_crop"),
                           scale=scale, debug=debug, debug_dir=dbg)
    step_sample.process_file(p("_crop"), p("_sample"),
                             scale=scale,
                             h_margin=sample_margin_h, v_margin=sample_margin_v,
                             method=sample_method,
                             debug=debug, debug_dir=dbg)
    step_quantize.process_file(p("_sample"), p("_gbcam"),
                               use_kmeans=use_kmeans, scale=scale,
                               debug=debug, debug_dir=dbg)
    return p("_gbcam")


# ─────────────────────────────────────────────────────────────────────────────
# Comparison and diagnostics
# ─────────────────────────────────────────────────────────────────────────────

def load_and_validate(path, label):
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f"ERROR: cannot read {label} image: {path}", file=sys.stderr)
        sys.exit(1)
    if img.shape != (112, 128):
        print(f"ERROR: {label} image is {img.shape[1]}×{img.shape[0]}, expected 128×112",
              file=sys.stderr)
        sys.exit(1)
    unique = sorted(np.unique(img).tolist())
    bad    = [v for v in unique if v not in GB_COLORS]
    if bad:
        print(f"WARNING: {label} image contains non-palette values: {bad}")
    return img


def compare(result, reference, output_dir, stem):
    """
    Compare result against reference pixel-by-pixel.
    Prints full diagnostics and saves diagnostic images.
    stem is prepended to each diagnostic image filename.
    Returns True if all pixels match.
    """
    out = Path(output_dir)

    # ── Summary counts ────────────────────────────────────────
    total   = result.size          # 128 * 112 = 14336
    matches = int((result == reference).sum())
    wrongs  = total - matches
    pct     = 100.0 * matches / total

    print(f"\n{'='*70}")
    print(f"COMPARISON SUMMARY")
    print(f"{'='*70}")
    print(f"  Total pixels : {total}")
    print(f"  Matching     : {matches}  ({100*matches/total:.2f}%)")
    print(f"  Different    : {wrongs}   ({100*wrongs/total:.2f}%)")

    # ── Per-color distribution ────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"COLOR DISTRIBUTION")
    print(f"{'─'*70}")
    print(f"  {'Color':<32}  {'Result':>8}  {'Reference':>10}  {'Diff':>8}")
    for v in GB_COLORS:
        r_cnt = int((result    == v).sum())
        g_cnt = int((reference == v).sum())
        print(f"  {COLOR_NAMES[v]:<32}  {r_cnt:>8}  {g_cnt:>10}  {r_cnt-g_cnt:>+8}")

    # ── Confusion matrix ─────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"CONFUSION MATRIX  (rows = pipeline result, cols = reference)")
    print(f"{'─'*70}")
    hdr = f"  {'Result \\ Ref':<18}" + "".join(f"  {v:>8}" for v in GB_COLORS) + "   TOTAL"
    print(hdr)
    for rv in GB_COLORS:
        row = f"  {COLOR_NAMES[rv]:<18}"
        mask_r = (result == rv)
        total_r = int(mask_r.sum())
        for cv in GB_COLORS:
            cnt = int((mask_r & (reference == cv)).sum())
            mark = " ✓" if rv == cv else ("  " if cnt == 0 else " ✗")
            row += f"  {cnt:>7}{mark}"
        row += f"  {total_r:>6}"
        print(row)
    col_totals = "  " + " " * 18 + "".join(
        f"  {int((reference==v).sum()):>9}" for v in GB_COLORS)
    print(col_totals)

    # ── Spatial distribution of errors ───────────────────────
    if wrongs > 0:
        ys, xs = np.where(result != reference)
        print(f"\n{'─'*70}")
        print(f"SPATIAL DISTRIBUTION OF ERRORS  ({wrongs} pixels)")
        print(f"{'─'*70}")
        print(f"  Row range  : {ys.min()}–{ys.max()}  (top=0, bottom=111)")
        print(f"  Col range  : {xs.min()}–{xs.max()}  (left=0, right=127)")
        # Quadrant counts
        for rlabel, rmask in [("top (rows 0-55)", ys < 56),
                               ("bottom (rows 56-111)", ys >= 56)]:
            for clabel, cmask in [("left (cols 0-63)", xs < 64),
                                   ("right (cols 64-127)", xs >= 64)]:
                cnt = int((rmask & cmask).sum())
                print(f"  {rlabel} / {clabel}: {cnt} errors")

        # Row histogram
        print(f"\n  Errors per row (GB rows 0–111):")
        row_counts = np.bincount(ys, minlength=112)
        for gy in range(112):
            if row_counts[gy] > 0:
                bar = "█" * min(row_counts[gy], 60)
                print(f"    row {gy:3d}: {row_counts[gy]:4d}  {bar}")

        # Column histogram
        print(f"\n  Errors per column (GB cols 0–127):")
        col_counts = np.bincount(xs, minlength=128)
        for gx in range(128):
            if col_counts[gx] > 0:
                bar = "█" * min(col_counts[gx], 60)
                print(f"    col {gx:3d}: {col_counts[gx]:4d}  {bar}")

    # ── Full pixel-by-pixel error list ───────────────────────
    if wrongs > 0:
        print(f"\n{'─'*70}")
        print(f"FULL PIXEL ERROR LIST  ({wrongs} pixels, sorted by row then col)")
        print(f"{'─'*70}")
        print(f"  {'Row':>4}  {'Col':>4}  {'Pipeline':>24}  {'Reference':>24}  Error type")
        ys, xs = np.where(result != reference)
        order  = np.lexsort((xs, ys))
        for idx in order:
            gy, gx = int(ys[idx]), int(xs[idx])
            rv = int(result[gy, gx])
            gv = int(reference[gy, gx])
            ri = GB_COLORS.index(rv) if rv in GB_COLORS else -1
            gi = GB_COLORS.index(gv) if gv in GB_COLORS else -1
            if ri >= 0 and gi >= 0:
                if ri < gi:
                    etype = f"too dark  (off by {gi-ri} level{'s' if gi-ri>1 else ''})"
                else:
                    etype = f"too light (off by {ri-gi} level{'s' if ri-gi>1 else ''})"
            else:
                etype = "non-palette value"
            print(f"  {gy:>4}  {gx:>4}  {COLOR_NAMES.get(rv, str(rv)):>24}  "
                  f"{COLOR_NAMES.get(gv, str(gv)):>24}  {etype}")

    # ── Diagnostic images ────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"DIAGNOSTIC IMAGES  (saved to {out}/)")
    print(f"{'─'*70}")
    SCALE = 8

    def upscale(arr):
        return np.repeat(np.repeat(arr, SCALE, axis=0), SCALE, axis=1)

    # result and reference side by side at 8×
    side = np.hstack([upscale(result), upscale(reference)])
    p_side = str(out / f"{stem}_diag_result_vs_reference.png")
    cv2.imwrite(p_side, side)
    print(f"  {stem}_diag_result_vs_reference.png   — pipeline result (left) vs reference (right)")

    # Error map: correct=white, wrong=coloured by error type
    err_bgr = np.ones((112, 128, 3), dtype=np.uint8) * 255
    for v_result, v_ref, colour in [
        # too-dark errors: result darker than reference
        (0,   82,  (255, 0,   0  )),   # blue: black when should be dark-gray
        (0,   165, (255, 0,   128)),   # blue-magenta: black when should be light-gray
        (0,   255, (255, 0,   255)),   # magenta: black when should be white
        (82,  165, (128, 0,   0  )),   # dark blue: dark-gray when should be light-gray
        (82,  255, (192, 0,   128)),   # purple: dark-gray when should be white
        (165, 255, (0,   0,   128)),   # dark red: light-gray when should be white
        # too-light errors: result lighter than reference
        (255, 165, (0,   128, 255)),   # orange: white when should be light-gray
        (255, 82,  (0,   64,  255)),   # deeper orange: white when should be dark-gray
        (255, 0,   (0,   0,   255)),   # red: white when should be black
        (165, 82,  (0,   200, 128)),   # teal: light-gray when should be dark-gray
        (165, 0,   (0,   255, 0  )),   # green: light-gray when should be black
        (82,  0,   (0,   255, 255)),   # yellow: dark-gray when should be black
    ]:
        mask = (result == v_result) & (reference == v_ref)
        err_bgr[mask] = colour

    p_err = str(out / f"{stem}_diag_error_map.png")
    cv2.imwrite(p_err, upscale(err_bgr))
    print(f"  {stem}_diag_error_map.png             — white=correct; "
          f"blue=too-dark; red/orange=too-light")

    # Absolute difference image (scaled 0-255 over max possible diff of 255)
    diff = np.abs(result.astype(int) - reference.astype(int)).astype(np.uint8)
    p_diff = str(out / f"{stem}_diag_abs_diff.png")
    cv2.imwrite(p_diff, upscale(diff))
    print(f"  {stem}_diag_abs_diff.png              — absolute brightness difference (scaled)")

    # Level-difference image (-3 to +3 levels, mapped to 0-255)
    level_map = {v: i for i, v in enumerate(GB_COLORS)}
    r_levels  = np.vectorize(lambda v: level_map.get(int(v), -99))(result)
    g_levels  = np.vectorize(lambda v: level_map.get(int(v), -99))(reference)
    ldiff     = (r_levels - g_levels).astype(np.int8)   # -3 .. +3
    ldiff_vis = ((ldiff.astype(float) + 3) / 6 * 255).clip(0, 255).astype(np.uint8)
    p_ldiff   = str(out / f"{stem}_diag_level_diff.png")
    cv2.imwrite(p_ldiff, upscale(ldiff_vis))
    print(f"  {stem}_diag_level_diff.png            — level difference: "
          f"mid-gray=correct, darker=result too dark, lighter=result too light")

    # ── Reprint summary at the bottom for easy scanning ─────
    print(f"\n{'='*70}")
    print(f"COMPARISON SUMMARY (reprint)")
    print(f"{'='*70}")
    print(f"  Total pixels : {total}")
    print(f"  Matching     : {matches}  ({100*matches/total:.2f}%)")
    print(f"  Different    : {wrongs}   ({100*wrongs/total:.2f}%)")
    print(f"  {'Color':<32}  {'Result':>8}  {'Reference':>10}  {'Diff':>8}")
    for v in GB_COLORS:
        r_cnt = int((result    == v).sum())
        g_cnt = int((reference == v).sum())
        print(f"  {COLOR_NAMES[v]:<32}  {r_cnt:>8}  {g_cnt:>10}  {r_cnt-g_cnt:>+8}")

    return wrongs == 0



class _Tee:
    """Write stdout to both the terminal and a log file simultaneously."""
    def __init__(self, log_path):
        self._terminal = sys.stdout
        self._log = open(log_path, 'w', encoding='utf-8')

    def write(self, message):
        self._terminal.write(message)
        self._log.write(message)

    def flush(self):
        self._terminal.flush()
        self._log.flush()

    def close(self):
        self._log.close()

    # Proxy any other attribute lookups to the terminal (e.g. isatty)
    def __getattr__(self, name):
        return getattr(self._terminal, name)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Pipeline regression test against a hand-corrected reference image.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    parser.add_argument("--input",     required=True, metavar="PHOTO",
                        help="Phone photo to process through the pipeline.")
    parser.add_argument("--reference", required=True, metavar="REF.png",
                        help="Hand-corrected 128×112 four-color reference image "
                             "to compare against.")
    parser.add_argument("--output-dir", default="./test_output", metavar="DIR",
                        help="Where to write pipeline outputs and diagnostic images. "
                             "Default: ./test_output")
    parser.add_argument("--keep-intermediates", action="store_true",
                        help="Keep intermediate step files (_warp, _correct, _crop, "
                             "_sample) after the run. By default they are deleted to "
                             "reduce clutter — only the _gbcam output and diagnostics "
                             "are kept.")
    # Pass-through pipeline args
    parser.add_argument("--scale",          type=int,   default=8)
    parser.add_argument("--threshold",      type=int,   default=180)
    parser.add_argument("--poly-degree",    type=int,   default=2)
    parser.add_argument("--sample-margin",  type=int,   default=None)
    parser.add_argument("--sample-margin-h",type=int,   default=None)
    parser.add_argument("--sample-margin-v",type=int,   default=None)
    parser.add_argument("--sample-method",  default="median")
    parser.add_argument("--no-kmeans",      action="store_true")
    args = parser.parse_args()

    # Compute stem early — used for log filename and diagnostic image names
    from gbcam_common import strip_step_suffix
    stem = strip_step_suffix(Path(args.input).stem)

    # Redirect stdout through tee so all output goes to both terminal and log file
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    log_path = str(Path(args.output_dir) / f"{stem}.log")
    tee = _Tee(log_path)
    sys.stdout = tee

    # Validate inputs
    if not Path(args.input).exists():
        print(f"ERROR: input photo not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    if not Path(args.reference).exists():
        print(f"ERROR: reference image not found: {args.reference}", file=sys.stderr)
        sys.exit(1)

    # Resolve sample margins
    hm = args.sample_margin_h if args.sample_margin_h is not None else args.sample_margin
    vm = args.sample_margin_v if args.sample_margin_v is not None else args.sample_margin

    # Run pipeline
    try:
        gbcam_path = run_pipeline(
            input_path      = args.input,
            output_dir      = args.output_dir,
            scale           = args.scale,
            thresh_val      = args.threshold,
            poly_degree     = args.poly_degree,
            sample_margin_h = hm,
            sample_margin_v = vm,
            sample_method   = args.sample_method,
            use_kmeans      = not args.no_kmeans,
            debug           = True,
        )
    except Exception as e:
        print(f"\nPIPELINE ERROR: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    # Load and compare
    result    = load_and_validate(gbcam_path, "pipeline result")
    reference = load_and_validate(args.reference, "reference")

    passed = compare(result, reference, args.output_dir, stem)

    # Clean up intermediates unless asked to keep them
    if not args.keep_intermediates:
        from gbcam_common import STEP_SUFFIX
        out  = Path(args.output_dir)
        removed = []
        for step in ("warp", "correct", "crop", "sample"):
            p = out / (stem + STEP_SUFFIX[step] + ".png")
            if p.exists():
                p.unlink()
                removed.append(p.name)
        if removed:
            print(f"\n  [cleanup] Deleted intermediates: {', '.join(removed)}")

    print(f"\n{'='*70}")
    if passed:
        print("RESULT: PASS — all pixels match the reference.")
    else:
        print("RESULT: FAIL — see diagnostics above and in the output directory.")
    print(f"{'='*70}\n")

    tee.close()
    sys.stdout = tee._terminal
    print(f"  [log] Full output written to {log_path}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
