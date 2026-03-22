#!/usr/bin/env python3
"""
gbcam_quantize.py — Quantize step: map to 4 GB Camera colors

Takes the 128x112 per-pixel colour samples from the sample step and produces
the final 128x112 Game Boy Camera image by mapping each sample to the nearest
of the four original palette colors:

    #000000  ->  0    (BK, black)
    #9494FF  ->  82   (DG, dark gray / blue)
    #FF9494  ->  165  (LG, light gray / pink)
    #FFFFA5  ->  255  (WH, white / yellow)

Classification uses k-means clustering in the RG plane with three refinements:

  1. Global k-means (4 clusters) in RG space with fixed warm initialisation.
  2. G-valley LG/WH refinement: pixel bleeding from the bright R subpixel
     inflates the measured G of LG pixels near WH areas, causing the simple
     k-means midpoint to over-classify LG as WH.  A Gaussian-smoothed histogram
     valley among high-R pixels (R > 190) in the range [LG_centre_G, WH_centre_G]
     gives a more accurate threshold, applied globally and per strip.
  3. Strip k-means: overlapping 32-column strips each run their own k-means
     (initialised from the global centres) to adapt to the lateral front-light
     gradient.  Each strip also applies its own G-valley threshold.  Strip
     results override the global label only when ALL covering strips agree.

Input:  <stem>_sample.png  — from the sample step (128x112 colour PNG)
Output: <stem>_gbcam.png   — 128x112 grayscale PNG, values exactly 0/82/165/255
        <stem>_gbcam_rgb.png — 128x112 colour PNG using new RGB palette

Standalone usage:
  python gbcam_quantize.py sample_file.png [...]  [options]
  python gbcam_quantize.py --dir ./sample_outputs [options]

Options:
  --output-dir DIR    Output directory (default: same dir as input)
  --no-kmeans         Skip k-means; use fixed nearest-RG instead
  --scale N           Unused (kept for CLI compatibility)
  --debug             Save 8x upscaled debug image
"""

import cv2
import numpy as np
from PIL import Image
import argparse
import sys
import traceback
from pathlib import Path
from itertools import permutations

from gbcam_common import (
    GB_COLORS, CAM_W, CAM_H, STEP_SUFFIX,
    log, set_verbose, save_debug, collect_inputs,
    make_output_path, strip_step_suffix,
)

SUFFIX = STEP_SUFFIX["quantize"]

# New screen palette: BK=#000000  DG=#9494FF  LG=#FF9494  WH=#FFFFA5
COLOR_PALETTE_RGB = np.array([
    [  0,   0,   0],   # BK
    [148, 148, 255],   # DG
    [255, 148, 148],   # LG
    [255, 255, 165],   # WH
], dtype=np.uint8)


# ---------------------------------------------------------------------------
# G-valley threshold for LG / WH separation
# ---------------------------------------------------------------------------

def _g_valley_threshold(g_vals, lg_center_g, wh_center_g):
    """
    Find the G-axis threshold that best separates the LG cluster (low G) from
    the WH cluster (high G) among high-R pixels (R > 190).

    The true LG/WH boundary is obscured by pixel bleeding: LG pixels near
    bright WH regions have G inflated well above the LG cluster centre.  Using
    the simple k-means midpoint therefore over-classifies LG as WH.

    Strategy: build a Gaussian-smoothed histogram of G values in the range
    [lg_center_g, wh_center_g], search for the valley (density minimum) in the
    upper third of that range (to avoid the dense LG body), and use that as the
    threshold.  Falls back to a bias toward the WH side if the histogram is too
    sparse for reliable valley detection.

    Parameters
    ----------
    g_vals       : 1-D array of G values among high-R pixels
    lg_center_g  : G coordinate of the LG cluster centre
    wh_center_g  : G coordinate of the WH cluster centre

    Returns
    -------
    float threshold T such that G >= T -> WH, G < T -> LG
    """
    from scipy.ndimage import gaussian_filter1d

    lo = int(lg_center_g) + 1
    hi = int(wh_center_g)
    if hi <= lo + 4:
        return (lg_center_g + wh_center_g) / 2.0

    hist, edges = np.histogram(g_vals, bins=np.arange(lo, hi + 2))
    if hist.sum() < 10:
        return (lg_center_g + wh_center_g) / 2.0

    smooth = gaussian_filter1d(hist.astype(float), sigma=3.0)

    # Only search the upper third of the range (near WH side) to avoid
    # picking up the dense LG body as the valley minimum.
    search_lo = len(smooth) * 2 // 3
    valley_idx = search_lo + int(np.argmin(smooth[search_lo:]))
    threshold  = float(edges[valley_idx])

    log(f"  G-valley threshold: {threshold:.1f}"
        f"  (LG centre {lg_center_g:.1f}, WH centre {wh_center_g:.1f})")
    return threshold


def _apply_g_valley(labels, flat_rg, samples_g, g_thresh):
    """
    Re-classify high-R pixels (R > 190) that are currently labelled LG or WH
    using a G threshold: G >= g_thresh -> WH (3), else -> LG (2).

    Operates on a flat label array in-place and returns the number changed.
    """
    changed = 0
    for idx in range(len(labels)):
        if flat_rg[idx, 0] > 190 and labels[idx] in (2, 3):
            new = 3 if samples_g[idx] >= g_thresh else 2
            if labels[idx] != new:
                labels[idx] = new
                changed += 1
    return changed


# ---------------------------------------------------------------------------
# Main classification
# ---------------------------------------------------------------------------

def _classify_color(samples_rgb, init_centers=None):
    """
    Classify 128x112 corrected samples into BK / DG / LG / WH.

    Pipeline:
      1. Global k-means in RG space with warm initialisation.
      2. G-valley refinement of the LG/WH boundary among high-R pixels.
      3. Strip k-means (overlapping 32-column windows, step=16) with
         per-strip G-valley refinement.
      4. Ensemble: strip result overrides global only when all covering
         strips for a column agree with each other against the global label.

    Returns
    -------
    labels : (112, 128) uint8  -- palette index 0=BK 1=DG 2=LG 3=WH
    method : str               -- description of path taken
    """
    flat_rg = samples_rgb[:, :, :2].reshape(-1, 2).astype(np.float32)
    flat    = samples_rgb.reshape(-1, 3)
    names   = ["BK", "DG", "LG", "WH"]

    try:
        from sklearn.cluster import KMeans

        # ── Step 1: global k-means in RG space ──────────────────────────────
        init = np.array([[80, 20], [148, 148], [240, 148], [250, 250]],
                        dtype=np.float32)
        km = KMeans(n_clusters=4, init=init, n_init=1,
                    max_iter=300, random_state=42)
        cluster_labels = km.fit_predict(flat_rg)
        centers_rg     = km.cluster_centers_
        targets_rg     = COLOR_PALETTE_RGB[:, :2].astype(np.float32)

        # Optimal assignment of clusters to palette colours
        dist_matrix = np.array([
            [np.linalg.norm(centers_rg[i] - targets_rg[j])
             for j in range(4)] for i in range(4)
        ])
        best_perm, best_cost = None, float("inf")
        for perm in permutations(range(4)):
            cost = sum(dist_matrix[i, perm[i]] for i in range(4))
            if cost < best_cost:
                best_cost, best_perm = cost, perm
        cluster_to_palette = np.array(best_perm, dtype=int)
        labels_flat        = cluster_to_palette[cluster_labels]

        info = []
        for i, (name, cnt) in enumerate(
                zip(names, np.bincount(labels_flat, minlength=4))):
            if cnt > 0:
                m = flat[labels_flat == i].mean(axis=0)
                info.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log("  Global k-means RG: " + "  ".join(info))

        # ── Step 2: global G-valley LG/WH refinement ────────────────────────
        lg_km_idx = int(np.where(cluster_to_palette == 2)[0][0])
        wh_km_idx = int(np.where(cluster_to_palette == 3)[0][0])
        lg_cg     = float(centers_rg[lg_km_idx, 1])
        wh_cg     = float(centers_rg[wh_km_idx, 1])

        high_r_mask = flat_rg[:, 0] > 190
        g_high_r    = flat_rg[high_r_mask, 1]
        g_thresh    = _g_valley_threshold(g_high_r, lg_cg, wh_cg)

        labels_refined = labels_flat.copy()
        changed_valley = _apply_g_valley(labels_refined, flat_rg, flat_rg[:, 1], g_thresh)
        log(f"  G-valley refinement: changed {changed_valley} px")

        labels_2d = labels_refined.reshape(CAM_H, CAM_W)

        # Global cluster centres in palette order (used as strip init)
        global_centers_po = np.zeros((4, 2), dtype=np.float32)
        for pi in range(4):
            cidx = np.where(cluster_to_palette == pi)[0]
            global_centers_po[pi] = (centers_rg[cidx[0]] if len(cidx) > 0
                                     else targets_rg[pi])

        # ── Step 3: strip k-means with per-strip G-valley ───────────────────
        samples_rg   = samples_rgb[:, :, :2].astype(np.float32)
        strip_width  = 32
        step         = 16
        n_strips     = (CAM_W - strip_width) // step + 1
        strip_labels = np.full((CAM_H, CAM_W, n_strips), -1, dtype=np.int8)
        strip_cx     = np.zeros(n_strips, dtype=float)

        for s in range(n_strips):
            cs = s * step
            ce = min(cs + strip_width, CAM_W)
            strip_rg   = samples_rg[:, cs:ce, :].reshape(-1, 2)
            strip_r    = samples_rg[:, cs:ce, 0].ravel()
            strip_g    = samples_rg[:, cs:ce, 1].ravel()

            km_s = KMeans(n_clusters=4, init=global_centers_po,
                          n_init=1, max_iter=300, random_state=42)
            sl   = km_s.fit_predict(strip_rg)
            sc   = km_s.cluster_centers_

            dm = np.array([[np.linalg.norm(sc[i] - targets_rg[j])
                            for j in range(4)] for i in range(4)])
            best_p2, best_c2 = None, float("inf")
            for perm in permutations(range(4)):
                cost = sum(dm[i, perm[i]] for i in range(4))
                if cost < best_c2:
                    best_c2, best_p2 = cost, perm
            c2p = np.array(best_p2, dtype=int)
            sl_palette = c2p[sl].copy()   # flat (H*strip_w,)

            # Per-strip G-valley for LG/WH
            s_lg_km = int(np.where(c2p == 2)[0][0]) if 2 in c2p else -1
            s_wh_km = int(np.where(c2p == 3)[0][0]) if 3 in c2p else -1
            if s_lg_km >= 0 and s_wh_km >= 0:
                s_lg_cg  = float(sc[s_lg_km, 1])
                s_wh_cg  = float(sc[s_wh_km, 1])
                s_g_high = strip_g[strip_r > 190]
                if len(s_g_high) >= 10:
                    s_thresh = _g_valley_threshold(s_g_high, s_lg_cg, s_wh_cg)
                    _apply_g_valley(sl_palette, strip_rg, strip_g, s_thresh)

            strip_labels[:, cs:ce, s] = sl_palette.reshape(CAM_H, ce - cs)
            strip_cx[s] = (cs + ce) / 2.0

        # ── Step 4: ensemble -- strip overrides global only if all agree ─────
        final_labels = labels_2d.copy()
        changed_strip = 0
        for x in range(CAM_W):
            covering = [s for s in range(n_strips)
                        if s * step <= x < min(s * step + strip_width, CAM_W)
                        and strip_labels[0, x, s] >= 0]
            if not covering:
                continue
            best_s = min(covering, key=lambda s: abs(strip_cx[s] - x))
            for y in range(CAM_H):
                global_l = int(labels_2d[y, x])
                strip_l  = int(strip_labels[y, x, best_s])
                if strip_l != global_l:
                    any_agree = any(int(strip_labels[y, x, s]) == global_l
                                    for s in covering)
                    if not any_agree:
                        final_labels[y, x] = strip_l
                        changed_strip += 1
        log(f"  Strip ensemble: {n_strips} strips, changed {changed_strip} px")

        info2 = []
        for i, (name, cnt) in enumerate(
                zip(names, np.bincount(final_labels.ravel(), minlength=4))):
            if cnt > 0:
                m = flat[final_labels.ravel() == i].mean(axis=0)
                info2.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log("  Final labels: " + "  ".join(info2))

        return final_labels.astype(np.uint8), "strip-kmeans-RG+G-valley"

    except Exception as e:
        # Fallback: nearest-neighbour in RG space
        log(f"  K-means failed ({e}), using nearest-RG")
        targets_rg = COLOR_PALETTE_RGB[:, :2].astype(np.float32)
        dists      = np.sum(
            (flat_rg[:, None, :] - targets_rg[None, :, :]) ** 2, axis=-1)
        labels_flat = np.argmin(dists, axis=1)
        return labels_flat.reshape(CAM_H, CAM_W).astype(np.uint8), "nearest-RG"


# ---------------------------------------------------------------------------
# File processing
# ---------------------------------------------------------------------------

def _process_file_color(input_path, output_path,
                        smooth=True, debug=False, debug_dir=None):
    """
    Colour-mode quantisation.

    Loads the 3-channel BGR sample image from the sample step, classifies
    each pixel using _classify_color, and writes:
      <stem>_gbcam.png     -- 128x112 grayscale, values 0/82/165/255
      <stem>_gbcam_rgb.png -- 128x112 colour using new RGB palette
    """
    stem = Path(input_path).stem
    log("\n" + "=" * 60, always=True)
    log(f"[quantize/color] {input_path}", always=True)

    bgr = cv2.imread(str(input_path))
    if bgr is None:
        raise RuntimeError(f"Cannot read image: {input_path}")
    if bgr.shape[:2] != (CAM_H, CAM_W):
        raise RuntimeError(
            f"Unexpected size {bgr.shape[1]}x{bgr.shape[0]}; "
            f"expected {CAM_W}x{CAM_H}.")

    samples_rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    log(f"  Loaded {CAM_W}x{CAM_H} colour sample")
    log(f"  R: {samples_rgb[:,:,0].min():.0f}-{samples_rgb[:,:,0].max():.0f}  "
        f"G: {samples_rgb[:,:,1].min():.0f}-{samples_rgb[:,:,1].max():.0f}  "
        f"B: {samples_rgb[:,:,2].min():.0f}-{samples_rgb[:,:,2].max():.0f}")

    labels, method = _classify_color(samples_rgb)
    log(f"  Classification: {method}")

    GRAY_VALS = np.array([0, 82, 165, 255], dtype=np.uint8)
    out_gray  = GRAY_VALS[labels]
    out_rgb   = COLOR_PALETTE_RGB[labels]

    # Save grayscale output
    Image.fromarray(out_gray, "L").save(str(output_path))
    log(f"  Saved -> {output_path}  (grayscale palette)", always=True)

    # Save colour output alongside
    out_path = Path(output_path)
    rgb_path = out_path.parent / (
        strip_step_suffix(out_path.stem) + STEP_SUFFIX["quantize"] + "_rgb.png")
    cv2.imwrite(str(rgb_path), cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR))
    log(f"  Saved -> {rgb_path}  (new RGB palette)", always=True)

    # Colour distribution
    names = ["BK", "DG", "LG", "WH"]
    for i, name in enumerate(names):
        cnt = int((labels == i).sum())
        log(f"  {name}: {cnt:5d} px  ({100*cnt/labels.size:5.1f}%)")

    if debug and debug_dir and stem:
        big = np.repeat(np.repeat(out_gray, 8, axis=0), 8, axis=1)
        save_debug(big, debug_dir, stem, "quantize_color_a_gray_8x")
        big_rgb = np.repeat(np.repeat(out_rgb, 8, axis=0), 8, axis=1)
        save_debug(cv2.cvtColor(big_rgb, cv2.COLOR_RGB2BGR),
                   debug_dir, stem, "quantize_color_b_rgb_8x")


def process_file(input_path, output_path, use_kmeans=True, scale=8,
                 smooth=True, debug=False, debug_dir=None):
    _process_file_color(input_path, output_path,
                        smooth=smooth, debug=debug, debug_dir=debug_dir)


# ---------------------------------------------------------------------------
# Standalone CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Quantize step: map samples to 4 GB Camera colors",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("inputs", nargs="*",
                        help="Sample-step output files (*_sample.png) to quantize.")
    parser.add_argument("--dir", "-d", metavar="DIR",
                        help="Directory of sample-step outputs to glob.")
    parser.add_argument("--output-dir", "-o", metavar="DIR",
                        help="Where to write *_gbcam.png outputs. Default: same "
                             "directory as each input file.")
    parser.add_argument("--scale", type=int, default=8, metavar="N",
                        help="Unused; kept for CLI compatibility.")
    parser.add_argument("--no-kmeans", action="store_true",
                        help="Skip k-means; fall back to fixed nearest-RG "
                             "classification.")
    parser.add_argument("--no-smooth", action="store_true",
                        help="Unused; kept for CLI compatibility.")
    parser.add_argument("--debug", action="store_true",
                        help="Enable verbose logging and save 8x upscaled debug "
                             "images to <output-dir>/debug/.")
    args = parser.parse_args()
    set_verbose(args.debug)
    files = collect_inputs(args.inputs, args.dir)
    if not files:
        parser.print_help()
        print("\nError: no input files.", file=sys.stderr)
        sys.exit(1)
    debug_dir = (args.output_dir or ".") + "/debug" if args.debug else None
    errors = []
    for f in files:
        out = make_output_path(f, args.output_dir, SUFFIX)
        try:
            process_file(f, out, use_kmeans=not args.no_kmeans,
                         debug=args.debug, debug_dir=debug_dir)
        except Exception as e:
            print(f"ERROR -- {f}: {e}", file=sys.stderr)
            if args.debug:
                traceback.print_exc()
            errors.append(f)
    print(f"\nDone -- {len(files)-len(errors)} succeeded, {len(errors)} failed.")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
