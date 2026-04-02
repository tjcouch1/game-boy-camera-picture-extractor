#!/usr/bin/env python3
"""
Debug spatial color transformation - check if the deltas make sense.
"""
import numpy as np
import cv2
from pathlib import Path

def _load_frame_ascii():
    """Load frame_ascii.txt and return a 160×144 grid with color indices (0-3)."""
    frame_path = Path(__file__).resolve().parent.parent.parent / 'supporting-materials' / 'frame_ascii.txt'
    if not frame_path.exists():
        return None
    try:
        with open(frame_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        frame = []
        for line in lines:
            line = line.rstrip('\n\r')
            row = []
            for char in line:
                if char == ' ':
                    row.append(0)  # yellow
                elif char == '·':
                    row.append(1)  # red
                elif char == '▓':
                    row.append(2)  # blue
                elif char == '█':
                    row.append(3)  # black
                else:
                    row.append(0)
            if len(row) == 160:
                frame.append(row)
        if len(frame) == 144:
            return frame
    except Exception:
        pass
    return None

FRAME_TARGETS = {
    0: np.array([255.0, 255.0, 165.0]),  # yellow
    1: np.array([255.0, 148.0, 148.0]),  # red
    2: np.array([148.0, 148.0, 255.0]),  # blue
    3: np.array([0.0, 0.0, 0.0]),        # black
}

frame = _load_frame_ascii()
_repo_root = str(Path(__file__).resolve().parent.parent.parent)
warp_path = _repo_root + "/test-output/zelda-poster-3/zelda-poster-3_warp.png"

bgr = cv2.imread(str(warp_path))
rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)

scale = 8
H, W = rgb.shape[:2]

# Sample a few frame pixels and check the deltas
print("Checking delta calculations:")
print()

for gy in [5, 70, 140]:  # top, middle, right
    gx = 80  # middle-ish
    if frame[gy][gx] == 0:  # yellow
        color_name = "yellow"
    else:
        color_name = ["", "red", "blue", "black"][frame[gy][gx]]
    
    y_center = gy * scale + scale // 2
    x_center = gx * scale + scale // 2
    
    current = rgb[y_center, x_center, :]
    target = FRAME_TARGETS[frame[gy][gx]]
    delta = target - current
    
    print(f"gy={gy:3d} gx={gx:3d} ({color_name})")
    print(f"  Current: {tuple(current)}")
    print(f"  Target:  {tuple(target)}")
    print(f"  Delta:   {tuple(delta)}")
    print(f"  After adding delta: {tuple(current + delta)}")
    print()
