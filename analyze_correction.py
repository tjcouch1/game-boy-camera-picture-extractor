#!/usr/bin/env python3
"""Analyze actual corrected RGB values across all test images."""

import cv2
import glob
import numpy as np
import os
from pathlib import Path

TEST_INPUT_DIR = "test-input"
TEST_OUTPUT_DIR = "test-output"
REFERENCE_SUFFIX = "-output-corrected.png"

tests = []
for ref_path in sorted(glob.glob(os.path.join(TEST_INPUT_DIR, f"*{REFERENCE_SUFFIX}"))):
    ref_filename = os.path.basename(ref_path)
    base_name = ref_filename[: -len(REFERENCE_SUFFIX)]
    input_files = sorted(
        f for ext in ("*.jpg", "*.png")
        for f in glob.glob(os.path.join(TEST_INPUT_DIR, f"{base_name}-{ext}"))
        if f != ref_path
    )
    for input_path in input_files:
        stem = os.path.splitext(os.path.basename(input_path))[0]
        tests.append((stem, ref_filename))

print('Actual corrected RGB values by color class:\n')
print('Test            | BK (target 0,0,0)  | DG (target 148,148,255) | LG (target 255,148,148) | WH (target 255,255,165)')
print('-' * 135)

for test_name, ref_name in tests:
    sample_path = f'test-output/{test_name}/{test_name}_sample.png'
    ref_path = f'test-input/{ref_name}'

    if not Path(sample_path).exists() or not Path(ref_path).exists():
        continue

    img = cv2.imread(sample_path)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    ref = cv2.imread(ref_path, cv2.IMREAD_GRAYSCALE)

    mbk = ref == 0
    mdg = ref == 82
    mlg = ref == 165
    mwh = ref == 255

    def format_rgb(mask):
        if mask.sum() == 0:
            return 'N/A'
        r = int(rgb[mask, 0].mean())
        g = int(rgb[mask, 1].mean())
        b = int(rgb[mask, 2].mean())
        return f'({r:3},{g:3},{b:3})'

    bk_str = format_rgb(mbk)
    dg_str = format_rgb(mdg)
    lg_str = format_rgb(mlg)
    wh_str = format_rgb(mwh)

    print(f'{test_name:15} | {bk_str:18} | {dg_str:23} | {lg_str:23} | {wh_str:23}')

print('\nTarget values:   | (  0,  0,  0)      | (148,148,255)           | (255,148,148)           | (255,255,165)')
