#!/usr/bin/env python3
"""
test_pipeline.py — Pipeline regression test against a hand-corrected reference image.

Runs the full gbcam colour pipeline on an input photo, compares the _gbcam.png
result pixel-by-pixel against a reference image, and prints comprehensive
diagnostics so failures can be diagnosed and fixed.

Usage:
    python test_pipeline.py --input PHOTO --reference REFERENCE_GBCAM_PNG [options]

    --input PHOTO           Phone photo to process (e.g. 20260216_130838~2.jpg)
    --reference REF.png     Hand-corrected 128×112 four-color reference image
                            (grayscale, using 0/82/165/255 palette values)
    --output-dir DIR        Where to write pipeline outputs and diagnostic images
                            (default: ./test_output)
    --keep-intermediates    Do not delete intermediate step files after the run
    --scale N               Pipeline scale (default: 8)
    --threshold T           Warp threshold (default: 180)
    --poly-degree N         Correct polynomial degree (default: 2)
    --grayscale             Use the legacy grayscale pipeline instead of colour

Exit code:
    0  — all pixels match
    1  — one or more pixels differ (or pipeline error)
"""

import argparse
import sys
import traceback
from pathlib import Path

import cv2
import numpy as np

# ── Palette ───────────────────────────────────────────────────────────────────
# The pipeline outputs _gbcam.png as grayscale using the original 4-level palette
# (0=BK, 82=DG, 165=LG, 255=WH) regardless of colour mode.  Comparison always
# works in this grayscale space.
GB_COLORS = [0, 82, 165, 255]
# Human-readable names using the colour-palette hex values
COLOR_NAMES = {
    0:   "BK  #000000",
    82:  "DG  #9494FF",
    165: "LG  #FF9494",
    255: "WH  #FFFFA5",
}
# BGR values for each palette entry (for rendering diagnostic images)
BGR_PALETTE = {
    0:   (0,   0,   0  ),    # BK  #000000
    82:  (255, 148, 148),    # DG  #9494FF  (B=255 G=148 R=148)
    165: (148, 148, 255),    # LG  #FF9494  (B=148 G=148 R=255)
    255: (165, 255, 255),    # WH  #FFFFA5  (B=165 G=255 R=255)
}


# ─────────────────────────────────────────────────────────────────────────────
# Run pipeline
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline(input_path, output_dir, scale=8, thresh_val=180, poly_degree=2,
                 dark_smooth=13, color=True, debug=True):
    """Run the full pipeline and return the path to the _gbcam.png output."""
    sys.path.insert(0, str(Path(__file__).parent))
    from gbcam_common import strip_step_suffix, set_verbose
    import gbcam_warp     as step_warp
    import gbcam_correct  as step_correct
    import gbcam_crop     as step_crop
    import gbcam_sample   as step_sample
    import gbcam_quantize as step_quantize
    set_verbose(True)

    out  = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    dbg  = str(out / "debug")
    stem = strip_step_suffix(Path(input_path).stem)

    def p(suffix):
        return str(out / (stem + suffix + ".png"))

    mode = "colour" if color else "grayscale (legacy)"
    print(f"\n{'='*70}")
    print(f"PIPELINE RUN  [{mode}]")
    print(f"  Input:      {input_path}")
    print(f"  Output dir: {output_dir}")
    print(f"  scale={scale}  threshold={thresh_val}  poly_degree={poly_degree}"
          f"  dark_smooth={dark_smooth}")
    print(f"{'='*70}\n")

    step_warp.process_file(
        input_path, p("_warp"),
        scale=scale, thresh_val=thresh_val,
        color=color, debug=debug, debug_dir=dbg)

    step_correct.process_file(
        p("_warp"), p("_correct"),
        scale=scale, poly_degree=poly_degree,
        dark_smooth=dark_smooth,
        color=color, debug=debug, debug_dir=dbg)

    step_crop.process_file(
        p("_correct"), p("_crop"),
        scale=scale, color=color, debug=debug, debug_dir=dbg)

    step_sample.process_file(
        p("_crop"), p("_sample"),
        scale=scale, color=color, debug=debug, debug_dir=dbg)

    step_quantize.process_file(
        p("_sample"), p("_gbcam"),
        color=color, debug=debug, debug_dir=dbg)

    return p("_gbcam")


# ─────────────────────────────────────────────────────────────────────────────
# Comparison and diagnostics
# ─────────────────────────────────────────────────────────────────────────────

def quantize_to_palette(img):
    """Snap every pixel to the nearest GB palette value."""
    gb   = np.array(GB_COLORS, dtype=np.int32)
    flat = img.ravel().astype(np.int32)
    idx  = np.argmin(np.abs(flat[:, None] - gb[None, :]), axis=1)
    return gb[idx].astype(np.uint8).reshape(img.shape)


def load_and_validate(path, label):
    """Load a grayscale 128x112 palette image, snapping stray values if needed."""
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        print(f"ERROR: cannot read {label} image: {path}", file=sys.stderr)
        sys.exit(1)
    if img.shape != (112, 128):
        print(f"ERROR: {label} image is {img.shape[1]}x{img.shape[0]}, "
              f"expected 128x112", file=sys.stderr)
        sys.exit(1)
    unique = sorted(np.unique(img).tolist())
    bad    = [v for v in unique if v not in GB_COLORS]
    if bad:
        max_dist = max(min(abs(int(v) - g) for g in GB_COLORS) for v in bad)
        print(f"  [{label}] Non-palette values detected "
              f"(max dist to palette: {max_dist}). Auto-snapping.")
        img = quantize_to_palette(img)
        print(f"  [{label}] After snap: {sorted(np.unique(img).tolist())}")
    return img


def render_palette(gray_img):
    """Convert grayscale palette image to BGR using the colour palette."""
    out_bgr = np.zeros((*gray_img.shape, 3), dtype=np.uint8)
    for val, bgr in BGR_PALETTE.items():
        out_bgr[gray_img == val] = bgr
    return out_bgr


def upscale(img, factor=4):
    """Nearest-neighbour upscale for diagnostic images."""
    return np.repeat(np.repeat(img, factor, axis=0), factor, axis=1)


def compare(result, reference, output_dir, stem):
    """
    Compare result against reference pixel-by-pixel, print diagnostics,
    and save diagnostic images.  Returns True if all pixels match.
    """
    out = Path(output_dir)

    total   = result.size
    matches = int((result == reference).sum())
    wrongs  = total - matches

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
    print(f"  {'Color':<22}  {'Result':>8}  {'Reference':>10}  {'Diff':>8}")
    for v in GB_COLORS:
        r_cnt = int((result    == v).sum())
        g_cnt = int((reference == v).sum())
        print(f"  {COLOR_NAMES[v]:<22}  {r_cnt:>8}  {g_cnt:>10}  {r_cnt-g_cnt:>+8}")

    # ── Confusion matrix ─────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"CONFUSION MATRIX  (rows = pipeline result, cols = reference)")
    print(f"{'─'*70}")
    hdr = f"  {'Result / Ref':<18}" + "".join(f"  {COLOR_NAMES[v]:>16}" for v in GB_COLORS) + "   TOTAL"
    print(hdr)
    for rv in GB_COLORS:
        row      = f"  {COLOR_NAMES[rv]:<18}"
        mask_r   = (result == rv)
        total_r  = int(mask_r.sum())
        for cv in GB_COLORS:
            cnt  = int((mask_r & (reference == cv)).sum())
            mark = " v" if rv == cv else ("  " if cnt == 0 else " X")
            row += f"  {cnt:>15}{mark}"
        row += f"  {total_r:>6}"
        print(row)

    # ── Error breakdown ───────────────────────────────────────
    if wrongs > 0:
        print(f"\n{'─'*70}")
        print(f"ERROR BREAKDOWN  (result -> reference)")
        print(f"{'─'*70}")
        for rv in GB_COLORS:
            for cv in GB_COLORS:
                if rv == cv:
                    continue
                cnt = int(((result == rv) & (reference == cv)).sum())
                if cnt:
                    print(f"  {COLOR_NAMES[rv]}  ->  {COLOR_NAMES[cv]} : {cnt} px")

    # ── Spatial distribution of errors ───────────────────────
    if wrongs > 0:
        err_mask = (result != reference)
        err_rows = err_mask.sum(axis=1)   # errors per row    (length 112)
        err_cols = err_mask.sum(axis=0)   # errors per column (length 128)

        print(f"\n{'─'*70}")
        print(f"SPATIAL DISTRIBUTION OF ERRORS")
        print(f"{'─'*70}")
        print(f"  Errors per row (0–111):")
        for r in range(112):
            if err_rows[r]:
                bar = "#" * min(int(err_rows[r]), 50)
                print(f"    row {r:3d} : {err_rows[r]:4d}  {bar}")
        print(f"  Errors per column (0–127):")
        for c in range(128):
            if err_cols[c]:
                bar = "#" * min(int(err_cols[c]), 50)
                print(f"    col {c:3d} : {err_cols[c]:4d}  {bar}")

    # ── Full pixel error list ─────────────────────────────────
    if wrongs > 0:
        print(f"\n{'─'*70}")
        print(f"FULL PIXEL ERROR LIST  ({wrongs} errors, sorted by row then column)")
        print(f"{'─'*70}")
        print(f"  {'row':>4}  {'col':>4}  {'result':>18}  {'reference':>18}")
        err_ys, err_xs = np.where(result != reference)
        order = np.lexsort((err_xs, err_ys))
        for idx in order:
            r, c = int(err_ys[idx]), int(err_xs[idx])
            print(f"  {r:>4}  {c:>4}  {COLOR_NAMES[int(result[r,c])]:>18}  {COLOR_NAMES[int(reference[r,c])]:>18}")

    # ── Diagnostic images ─────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"DIAGNOSTIC IMAGES  (in {output_dir})")
    print(f"{'─'*70}")

    result_bgr    = render_palette(result)
    reference_bgr = render_palette(reference)

    cv2.imwrite(str(out / f"{stem}_diag_result.png"),    upscale(result_bgr))
    cv2.imwrite(str(out / f"{stem}_diag_reference.png"), upscale(reference_bgr))
    print(f"  {stem}_diag_result.png     — pipeline output (colour palette)")
    print(f"  {stem}_diag_reference.png  — reference image (colour palette)")

    side = np.hstack([upscale(result_bgr), upscale(reference_bgr)])
    cv2.imwrite(str(out / f"{stem}_diag_side_by_side.png"), side)
    print(f"  {stem}_diag_side_by_side.png  — result (left) vs reference (right)")

    # Error map: white=correct, colour-coded by mismatch type
    err_bgr = np.full((*result.shape, 3), 255, dtype=np.uint8)
    error_colours = [
        # (result_val, ref_val, BGR)                   description
        (82,  165, (0,   128, 255)),   # DG->LG  orange
        (82,  255, (0,   0,   200)),   # DG->WH  dark red
        (82,  0,   (255, 200, 0  )),   # DG->BK  cyan
        (165, 82,  (128, 0,   128)),   # LG->DG  purple
        (165, 255, (0,   200, 255)),   # LG->WH  yellow
        (165, 0,   (0,   180, 0  )),   # LG->BK  green
        (255, 165, (255, 64,  0  )),   # WH->LG  blue
        (255, 82,  (128, 0,   0  )),   # WH->DG  navy
        (255, 0,   (255, 0,   255)),   # WH->BK  magenta
        (0,   82,  (128, 128, 0  )),   # BK->DG  teal
        (0,   165, (0,   255, 128)),   # BK->LG  lime
        (0,   255, (200, 200, 200)),   # BK->WH  light gray
    ]
    for rv, cv2_val, colour in error_colours:
        err_bgr[(result == rv) & (reference == cv2_val)] = colour
    cv2.imwrite(str(out / f"{stem}_diag_error_map.png"), upscale(err_bgr))
    print(f"  {stem}_diag_error_map.png  — white=correct, colours=error type")

    # ── Reprint summary ───────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"COMPARISON SUMMARY (reprint)")
    print(f"{'='*70}")
    print(f"  Total pixels : {total}")
    print(f"  Matching     : {matches}  ({100*matches/total:.2f}%)")
    print(f"  Different    : {wrongs}   ({100*wrongs/total:.2f}%)")
    for v in GB_COLORS:
        r_cnt = int((result    == v).sum())
        g_cnt = int((reference == v).sum())
        print(f"  {COLOR_NAMES[v]:<22}  {r_cnt:>8}  {g_cnt:>10}  {r_cnt-g_cnt:>+8}")

    return wrongs == 0


# ─────────────────────────────────────────────────────────────────────────────
# Stdout tee (terminal + log file)
# ─────────────────────────────────────────────────────────────────────────────

class _Tee:
    def __init__(self, log_path):
        self._terminal = sys.stdout
        self._log      = open(log_path, 'w', encoding='utf-8')

    def write(self, message):
        self._terminal.write(message)
        self._log.write(message)

    def flush(self):
        self._terminal.flush()
        self._log.flush()

    def close(self):
        self._log.close()

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
                        help="Hand-corrected 128x112 grayscale reference image "
                             "(0/82/165/255 palette values).")
    parser.add_argument("--output-dir", default="./test_output", metavar="DIR",
                        help="Where to write pipeline outputs and diagnostic images. "
                             "Default: ./test_output")
    parser.add_argument("--keep-intermediates", action="store_true",
                        help="Keep intermediate step files (_warp, _correct, _crop, "
                             "_sample) after the run.")

    # Pipeline tuning
    parser.add_argument("--scale",       type=int, default=8,
                        help="Pipeline scale factor (default: 8).")
    parser.add_argument("--threshold",   type=int, default=180,
                        help="Warp corner-detection threshold (default: 180).")
    parser.add_argument("--poly-degree", type=int, default=2,
                        help="Polynomial degree for light-correction surfaces (default: 2).")
    parser.add_argument("--dark-smooth", type=int, default=13,
                        help="Smoothing kernel size for dark surface (default: 13).")

    # Mode
    parser.add_argument("--grayscale", action="store_true",
                        help="Use the legacy grayscale pipeline. Colour mode is the default.")
    parser.add_argument("--color", action="store_true",
                        help="(no-op — colour mode is the default; kept for compatibility)")

    args = parser.parse_args()

    from gbcam_common import strip_step_suffix
    stem = strip_step_suffix(Path(args.input).stem)

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    log_path   = str(Path(args.output_dir) / f"{stem}.log")
    tee        = _Tee(log_path)
    sys.stdout = tee

    if not Path(args.input).exists():
        print(f"ERROR: input photo not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    if not Path(args.reference).exists():
        print(f"ERROR: reference image not found: {args.reference}", file=sys.stderr)
        sys.exit(1)

    color = not args.grayscale   # colour is the default

    try:
        gbcam_path = run_pipeline(
            input_path  = args.input,
            output_dir  = args.output_dir,
            scale       = args.scale,
            thresh_val  = args.threshold,
            poly_degree = args.poly_degree,
            dark_smooth = args.dark_smooth,
            color       = color,
            debug       = True,
        )
    except Exception as e:
        print(f"\nPIPELINE ERROR: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    result    = load_and_validate(gbcam_path,     "pipeline result")
    reference = load_and_validate(args.reference, "reference")

    passed = compare(result, reference, args.output_dir, stem)

    if not args.keep_intermediates:
        from gbcam_common import STEP_SUFFIX
        out     = Path(args.output_dir)
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
