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
  2. Strip k-means: overlapping 32-column strips each run their own k-means
     (initialised from the global centres) to adapt to the lateral front-light
     gradient.  Strip results override the global label only when ALL covering
     strips agree.
  3. G-valley LG/WH refinement (applied AFTER the strip ensemble): pixel
     bleeding from the bright R subpixel inflates the measured G of LG pixels
     near WH areas, causing the strip k-means to over-classify LG as WH.  A
     Gaussian-smoothed histogram valley among high-R pixels (R > 190) in the
     range [LG_centre_G, WH_centre_G] gives a more accurate threshold, applied
     globally as a final pass so that strip decisions cannot override it.

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
from pathlib import Path
from itertools import permutations
from gbcam_common import (GB_COLORS, CAM_W, CAM_H, STEP_SUFFIX,
                           log, set_verbose, save_debug, collect_inputs,
                           make_output_path, strip_step_suffix, _rel)
SUFFIX = STEP_SUFFIX["quantize"]

COLOR_PALETTE_RGB = np.array([
    [  0,   0,   0],
    [148, 148, 255],
    [255, 148, 148],
    [255, 255, 165],
], dtype=np.uint8)

def _g_valley_threshold(g_vals, lg_center_g, wh_center_g):
    """
    Find the G-axis threshold that best separates the LG cluster (low G) from the
    WH cluster (high G) among high-R pixels.

    The true LG/WH boundary in G is obscured by pixel bleeding: LG pixels near
    bright WH regions have G inflated well above the LG cluster centre. Using the
    simple k-means midpoint (lg_center_g + wh_center_g) / 2 therefore under-counts
    LG and over-counts WH.

    Strategy: build a smooth histogram of G values in the range
    [lg_center_g, wh_center_g], find the valley (density minimum) within it, and
    use that as the threshold.  Falls back to (midpoint + wh_center_g) / 2 -- a
    bias toward the WH side -- if the histogram is too sparse for valley detection.
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
    # Start search from upper 2/3 of range to avoid the dense LG body.
    search_lo = len(smooth) * 2 // 3
    valley_idx = search_lo + int(np.argmin(smooth[search_lo:]))

    # If the search was boundary-constrained (minimum is at search_lo itself),
    # the true valley lies lower in the range than the restrictive window allows.
    # Retry from the lower 1/3 point -- this still stays well above the LG body
    # peak (near LG_centre) while admitting valleys in the middle of the range.
    if valley_idx == search_lo:
        wider_lo = max(len(smooth) // 3, 1)
        valley_idx = wider_lo + int(np.argmin(smooth[wider_lo:]))

    threshold = float(edges[valley_idx])
    log(f"  G-valley threshold: {threshold:.1f}  (LG centre {lg_center_g:.1f}, WH centre {wh_center_g:.1f})")
    return threshold


def _classify_color(samples_rgb, init_centers=None):
    """
    Classify 128x112 corrected samples into BK/DG/LG/WH.

    Two-stage approach:
      1. Global k-means in RG space finds the four cluster centres.
      2. WH vs LG boundary is refined using G-valley detection among
         high-R pixels (R > 190).  This corrects for the systematic
         over-classification of LG pixels as WH caused by pixel bleeding
         from the bright R subpixel inflating the measured G of LG pixels.
      3. Strip k-means (column-wise) handles lateral front-light gradient.
    """
    flat_rg = samples_rgb[:,:,:2].reshape(-1,2).astype(np.float32)
    flat = samples_rgb.reshape(-1,3)
    try:
        from sklearn.cluster import KMeans
        init_centers = np.array([[80,20],[148,148],[240,148],[250,250]],dtype=np.float32)
        kmeans = KMeans(n_clusters=4, init=init_centers, n_init=1, max_iter=300, random_state=42)
        cluster_labels = kmeans.fit_predict(flat_rg)
        centers_rg = kmeans.cluster_centers_
        targets_rg = COLOR_PALETTE_RGB[:,:2].astype(np.float32)
        dist_matrix = np.zeros((4,4))
        for i in range(4):
            for j in range(4):
                dist_matrix[i,j] = np.linalg.norm(centers_rg[i]-targets_rg[j])
        best_perm=None; best_cost=float("inf")
        for perm in permutations(range(4)):
            cost=sum(dist_matrix[i,perm[i]] for i in range(4))
            if cost<best_cost: best_cost=cost; best_perm=perm
        cluster_to_palette=np.array(best_perm,dtype=int)
        labels_flat=cluster_to_palette[cluster_labels]
        names=["BK","DG","LG","WH"]
        counts=np.bincount(labels_flat,minlength=4)
        info=[]
        for i,(name,cnt) in enumerate(zip(names,counts)):
            if cnt>0:
                m=flat[labels_flat==i].mean(axis=0)
                info.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log(f"  Global k-means RG: "+"  ".join(info))

        labels_2d = labels_flat.reshape(CAM_H, CAM_W)
        samples_rg=samples_rgb[:,:,:2].astype(np.float32)
        global_centers_po=np.zeros((4,2),dtype=np.float32)
        for pi in range(4):
            cidx=np.where(cluster_to_palette==pi)[0]
            global_centers_po[pi]=centers_rg[cidx[0]] if len(cidx)>0 else targets_rg[pi]

        # ── Strip k-means for lateral gradient ────────────────────────────
        strip_width=32; step=16
        n_strips=(CAM_W-strip_width)//step+1
        strip_labels=np.full((CAM_H,CAM_W,n_strips),-1,dtype=np.int8)
        strip_centers_col=np.zeros(n_strips,dtype=float)
        for s in range(n_strips):
            col_start=s*step; col_end=min(col_start+strip_width,CAM_W)
            strip_data=samples_rg[:,col_start:col_end,:].reshape(-1,2)
            km_strip=KMeans(n_clusters=4,init=global_centers_po,n_init=1,max_iter=300,random_state=42)
            sl=km_strip.fit_predict(strip_data); sc=km_strip.cluster_centers_
            dm=np.zeros((4,4))
            for i in range(4):
                for j in range(4): dm[i,j]=np.linalg.norm(sc[i]-targets_rg[j])
            best_p2=None; best_c2=float("inf")
            for perm in permutations(range(4)):
                cost=sum(dm[i,perm[i]] for i in range(4))
                if cost<best_c2: best_c2=cost; best_p2=perm
            c2p=np.array(best_p2,dtype=int)
            sl_palette=c2p[sl].reshape(CAM_H,col_end-col_start)
            strip_labels[:,col_start:col_end,s]=sl_palette
            strip_centers_col[s]=(col_start+col_end)/2.0

        final_labels=labels_2d.copy(); changed=0
        for x in range(CAM_W):
            covering_strips=[s for s in range(n_strips)
                             if s*step<=x<min(s*step+strip_width,CAM_W) and strip_labels[0,x,s]>=0]
            if not covering_strips: continue
            best_strip=min(covering_strips,key=lambda s:abs(strip_centers_col[s]-x))
            for y in range(CAM_H):
                global_l=int(labels_2d[y,x]); strip_l=int(strip_labels[y,x,best_strip])
                if strip_l!=global_l:
                    any_agree=any(int(strip_labels[y,x,s])==global_l for s in covering_strips)
                    if not any_agree:
                        final_labels[y,x]=strip_l; changed+=1
        log(f"  Strip ensemble: {n_strips} strips, changed {changed} px")

        # ── G-valley WH/LG refinement (applied AFTER strip ensemble) ──────
        # LG and WH both have high R (>190). The strip k-means can push LG
        # pixels with bleeding-inflated G into WH. Re-apply the G-valley
        # threshold globally on final_labels so strips cannot undo it.
        lg_idx = int(np.where(cluster_to_palette == 2)[0][0])
        wh_idx = int(np.where(cluster_to_palette == 3)[0][0])
        lg_cg = float(centers_rg[lg_idx, 1])
        wh_cg = float(centers_rg[wh_idx, 1])

        high_r_flat = samples_rg.reshape(-1, 2)[:, 0] > 190
        g_high_r = samples_rg.reshape(-1, 2)[high_r_flat, 1]
        g_thresh = _g_valley_threshold(g_high_r, lg_cg, wh_cg)

        final_flat = final_labels.ravel()
        r_flat = samples_rg[:, :, 0].ravel()
        g_flat = samples_rg[:, :, 1].ravel()
        changed_valley = 0
        for idx in range(len(final_flat)):
            if r_flat[idx] > 190 and (final_flat[idx] == 2 or final_flat[idx] == 3):
                new_lbl = 3 if g_flat[idx] >= g_thresh else 2
                if new_lbl != final_flat[idx]:
                    final_flat[idx] = new_lbl
                    changed_valley += 1
        final_labels = final_flat.reshape(CAM_H, CAM_W)
        log(f"  G-valley refinement (post-strip): threshold={g_thresh:.1f}, changed {changed_valley} px")

        counts2=np.bincount(final_labels.ravel(),minlength=4)
        info2=[]
        for i,(name,cnt) in enumerate(zip(names,counts2)):
            if cnt>0:
                m=flat[final_labels.ravel()==i].mean(axis=0)
                info2.append(f"{name}({cnt})~(R{int(m[0])},G{int(m[1])},B{int(m[2])})")
        log(f"  Final labels: "+"  ".join(info2))

        return final_labels.astype(np.uint8), "strip-kmeans-RG+G-valley"
    except Exception as e:
        log(f"  K-means failed ({e}), using nearest-RG")
        targets_rg=COLOR_PALETTE_RGB[:,:2].astype(np.float32)
        dists=np.sum((flat_rg[:,None,:]-targets_rg[None,:,:])**2,axis=-1)
        labels_flat=np.argmin(dists,axis=1)
        return labels_flat.reshape(112,128).astype(np.uint8), "nearest-RG"

def _process_file_color(input_path, output_path, smooth=True, debug=False, debug_dir=None):
    from pathlib import Path as _Path
    stem_p=_Path(input_path); stem=stem_p.stem
    log("\n" + "="*60, always=True)
    log(f"[quantize/color] {_rel(input_path)}", always=True)
    bgr=cv2.imread(str(input_path))
    if bgr is None: raise RuntimeError(f"Cannot read: {input_path}")
    if bgr.shape[:2]!=(CAM_H,CAM_W):
        raise RuntimeError(f"Unexpected size {bgr.shape[1]}x{bgr.shape[0]}")
    img_rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
    samples_rgb=img_rgb.astype(np.float32)
    log(f"  Loaded {CAM_W}x{CAM_H} colour sample")
    labels,method=_classify_color(samples_rgb)
    log(f"  Classification: {method}")
    GRAY_VALS=np.array([0,82,165,255],dtype=np.uint8)
    out_gray=GRAY_VALS[labels]
    out_rgb=COLOR_PALETTE_RGB[labels]
    Image.fromarray(out_gray,"L").save(str(output_path))
    log(f"  Saved -> {_rel(output_path)}",always=True)
    out_path=_Path(output_path)
    rgb_path=out_path.parent/(strip_step_suffix(out_path.stem)+STEP_SUFFIX["quantize"]+"_rgb.png")
    cv2.imwrite(str(rgb_path),cv2.cvtColor(out_rgb,cv2.COLOR_RGB2BGR))
    log(f"  Saved -> {_rel(rgb_path)}",always=True)
    names=["BK","DG","LG","WH"]
    for i,(gv,name) in enumerate(zip([0,82,165,255],names)):
        cnt=int((labels==i).sum()); log(f"  {name}: {cnt:5d} px ({100*cnt/labels.size:5.1f}%)")
    if debug and debug_dir and stem:
        big=np.repeat(np.repeat(out_gray,8,axis=0),8,axis=1)
        save_debug(big,debug_dir,stem,"quantize_color_a_gray_8x")

def process_file(input_path, output_path, use_kmeans=True, scale=8,
                 smooth=True, debug=False, debug_dir=None):
    _process_file_color(input_path, output_path, smooth=smooth, debug=debug, debug_dir=debug_dir)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("inputs",nargs="*"); parser.add_argument("--dir","-d")
    parser.add_argument("--output-dir","-o"); parser.add_argument("--scale",type=int,default=8)
    parser.add_argument("--no-kmeans",action="store_true"); parser.add_argument("--debug",action="store_true")
    args=parser.parse_args(); set_verbose(args.debug)
    files=collect_inputs(args.inputs,args.dir)
    if not files: sys.exit(1)
    debug_dir=(args.output_dir or ".")+"/debug" if args.debug else None
    errors=[]
    for f in files:
        out=make_output_path(f,args.output_dir,SUFFIX)
        try: process_file(f,out,debug=args.debug,debug_dir=debug_dir)
        except Exception as e:
            print(f"ERROR -- {f}: {e}",file=sys.stderr); errors.append(f)
    if errors: sys.exit(1)

if __name__=="__main__": main()
