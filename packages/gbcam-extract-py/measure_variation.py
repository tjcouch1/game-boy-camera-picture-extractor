#!/usr/bin/env python3
import cv2
import numpy as np
from pathlib import Path

_REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)

tests = ['thing-1', 'thing-2', 'thing-3', 'zelda-poster-1', 'zelda-poster-2', 'zelda-poster-3']
print('Per-image color variation (std dev) in corrected camera area:\n')
print('Test            | R-std | G-std | B-std | Total Variation')
print('-' * 70)

for t in tests:
    path = f'{_REPO_ROOT}/test-output/{t}/{t}_correct.png'
    img = cv2.imread(path)
    if img is None:
        continue
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(float)
    cam = rgb[128*8:128*8+112*8, 128*8:128*8+128*8, :]
    r_std = cam[:,:,0].std()
    g_std = cam[:,:,1].std()
    b_std = cam[:,:,2].std()
    total = r_std + g_std + b_std
    print(f'{t:15} | {r_std:5.1f} | {g_std:5.1f} | {b_std:5.1f} | {total:5.1f}')
