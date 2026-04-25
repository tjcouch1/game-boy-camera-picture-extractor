#!/usr/bin/env python3
"""
Detailed spatial analysis of the color correction issue.
"""
import cv2
import numpy as np
from pathlib import Path

def analyze_detailed(img_path):
    """Analyze color correction in detail with spatial breakdown."""
    img = cv2.imread(str(img_path))
    if img is None:
        print(f"Cannot read {img_path}")
        return
    
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    
    print(f"\nDetailed analysis of: {img_path.name}")
    print(f"Image size: {w}x{h} px")
    print("="*100)
    
    scale = 8
    # Target colors
    target_wh = (255, 255, 165)  # #FFFFA5
    target_dg = (148, 148, 255)  # #9494FF
    
    # Measure mean color in regions to find the spatial pattern
    regions = {
        "Top-left": (0, 0, 8*scale, 8*scale),
        "Top-mid": (76*scale, 0, 84*scale, 8*scale),
        "Top-right": (152*scale, 0, 160*scale, 8*scale),
        "Mid-left": (0, 72*scale, 8*scale, 80*scale),
        "Mid-mid": (76*scale, 72*scale, 84*scale, 80*scale),
        "Mid-right": (152*scale, 72*scale, 160*scale, 80*scale),
        "Bot-left": (0, 136*scale, 8*scale, 144*scale),
        "Bot-mid": (76*scale, 136*scale, 84*scale, 144*scale),
        "Bot-right": (152*scale, 136*scale, 160*scale, 144*scale),
    }
    
    print("\nFrame region color analysis (from yellow frame strip):")
    print(f"{'Region':<20} {'R':<8} {'G':<8} {'B':<8} {'Target':<20} {'RG-dist':<10}")
    print("-"*100)
    
    for name, (x1, y1, x2, y2) in regions.items():
        if x2 <= w and y2 <= h:
            region = img_rgb[y1:y2, x1:x2, :]
            mean_rgb = region.mean(axis=(0, 1)).astype(int)
            r_g_only = (mean_rgb[0], mean_rgb[1])
            target_rg = (target_wh[0], target_wh[1])
            dist_rg = np.sqrt((r_g_only[0] - target_rg[0])**2 + (r_g_only[1] - target_rg[1])**2)
            print(f"{name:<20} {mean_rgb[0]:<8} {mean_rgb[1]:<8} {mean_rgb[2]:<8} {str(target_wh):<20} {dist_rg:<10.1f}")
    
    # Check dark border
    print("\n\nInner border region color analysis (should be #9494FF):")
    print(f"{'Region':<20} {'R':<8} {'G':<8} {'B':<8} {'Target':<20} {'Color-dist':<10}")
    print("-"*100)
    
    border_regions = {
        "Left-top": (15*scale, 30*scale, 17*scale, 38*scale),
        "Left-bot": (15*scale, 100*scale, 17*scale, 108*scale),
        "Right-top": (143*scale, 30*scale, 145*scale, 38*scale),
        "Right-bot": (143*scale, 100*scale, 145*scale, 108*scale),
        "Top-left": (30*scale, 15*scale, 38*scale, 17*scale),
        "Top-right": (100*scale, 15*scale, 108*scale, 17*scale),
        "Bot-left": (30*scale, 128*scale, 38*scale, 130*scale),
        "Bot-right": (100*scale, 128*scale, 108*scale, 130*scale),
    }
    
    for name, (x1, y1, x2, y2) in border_regions.items():
        if x2 <= w and y2 <= h:
            region = img_rgb[y1:y2, x1:x2, :]
            mean_rgb = region.mean(axis=(0, 1)).astype(int)
            dist = np.sqrt(sum((m - t)**2 for m, t in zip(mean_rgb, target_dg)))
            print(f"{name:<20} {mean_rgb[0]:<8} {mean_rgb[1]:<8} {mean_rgb[2]:<8} {str(target_dg):<20} {dist:<10.1f}")
    
    # Analyze the problematic right side more closely
    print("\n\nDetailed right-side analysis (the magenta issue):")
    print(f"{'Column':<15} {'R':<8} {'G':<8} {'B':<8} {'Issue':<30}")
    print("-"*100)
    
    for gx in [145, 150, 155, 159]:
        x_px = gx * scale + scale // 2
        if x_px < w:
            col = img_rgb[:, x_px:x_px+2, :].mean(axis=1).astype(int)
            mean_col = col.mean(axis=0)
            issue = "OK" if mean_col[1] > 200 else f"G={mean_col[1]} too low"
            print(f"GB-col {gx:<10} {mean_col[0]:<8} {mean_col[1]:<8} {mean_col[2]:<8} {issue:<30}")


if __name__ == "__main__":
    test_dir = Path(__file__).resolve().parent.parent.parent / "test-output"
    for img_path in sorted(test_dir.glob("zelda-poster-3/*_correct.png")):
        analyze_detailed(img_path)
