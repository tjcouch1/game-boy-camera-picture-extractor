# Plan to Fix Warp Step Border Alignment and Distortion

## Problem Summary

- The current warp step does not always align the inner blue border (16th pixel in from each edge) perfectly straight and at the correct position.
- This causes the border to be bent or misaligned, especially on the right and bottom edges, leading to pixel misalignment in the cropped output.

## Goals

- Ensure the `_warp.png` output has the blue border exactly at the 16th pixel in from each edge, with straight, one-pixel-thick borders and sharp corners.
- Ensure the `_crop.png` output has no border bleed and all image pixels are in the correct position and alignment.
- Improve test pass rates and visual accuracy.

## Plan

1. **Border Detection Diagnostics**
   - Write a script to analyze `_warp.png` outputs and detect the position and straightness of the blue border on all four sides.
   - Report deviations from the expected 16th pixel position and any bowing/bending.
   - Use this as a feedback tool for warp improvements.

2. **Improve Border Detection in Warp**
   - In `gbcam_warp.py`, enhance the sub-pixel detection of the blue border using color profile analysis along each edge.
   - Sample multiple points along each edge (not just corners) to detect curvature or bowing.
   - Fit lines to the detected border points for each edge and calculate the best-fit rectangle.

3. **Refined Homography Correction**
   - Use the detected border points to compute a correction homography that maps the detected (possibly bent) border to a perfect rectangle at the 16th pixel in.
   - Apply this refined homography in a second warp pass, so the output has the border exactly straight and in the right place.

4. **Corner and Edge Validation**
   - After the refined warp, validate that the border is now straight and at the correct position using the diagnostic script.
   - Log and visualize the detected vs. expected border positions for debugging.

5. **Test and Iterate**
   - Run the test suite (`python run_tests.py`) and inspect both the summary and visual results.
   - Use the diagnostic script to check for any remaining misalignments.
   - Iterate on the border detection and correction logic as needed.

6. **Optional: Crop Output Validation**
   - Optionally, write a script to check for blue border bleed in `_crop.png` outputs, but focus first on fixing the warp step.

## Acceptance Criteria

- All four borders in `_warp.png` are straight, one-pixel-thick, and exactly at the 16th pixel in from each edge.
- No border bleed or pixel misalignment in `_crop.png` outputs.
- Test suite passes with improved accuracy.
- Diagnostic script reports minimal deviation from expected border positions.
