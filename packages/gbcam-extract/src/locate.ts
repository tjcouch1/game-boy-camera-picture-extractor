/**
 * locate.ts — Find the Game Boy Screen within a full phone photo.
 *
 * The first step in the pipeline. Takes a full original photo (e.g. ~4032×1816
 * with the GBA SP somewhere inside) and produces an approximately upright crop
 * around the Game Boy Screen, suitable for the {@link warp} step.
 *
 * Algorithm: hybrid candidate generation + Frame 02 validation. Bright
 * quadrilateral candidates are generated at a downsampled working resolution,
 * then validated against Frame 02-specific structural features (inner-border
 * ring, surrounding LCD-black ring). The highest-scoring candidate is mapped
 * back to original-image coordinates, expanded by a proportional margin, and
 * extracted as an axis-aligned image.
 */

import type { GBImageData } from "./common.js";
import { type DebugCollector, cloneImage } from "./debug.js";
import { getCV, withMats, imageDataToMat, matToImageData } from "./opencv.js";

// ─── Tunables ───
//
// Starting values, tunable empirically against the corners.json unit test
// (Task 9). If detection fails on any of the test-input-full images, revisit
// these constants.

/** Target max dimension (px) of the working-resolution image. */
const WORKING_MAX_DIM = 1000;

/** Brightness threshold for candidate generation (0–255). */
const BRIGHTNESS_THRESHOLD = 180;

/** Minimum candidate area as a fraction of the working-resolution image area. */
const MIN_CANDIDATE_AREA_FRAC = 0.02;

/** Number of top-ranked candidates to validate. */
const TOP_N_CANDIDATES = 5;

/** Margin to expand the chosen rectangle by, as a fraction of its longest side. */
const MARGIN_RATIO = 0.06;

/** Minimum total validation score to accept a candidate (0–1). */
const MIN_VALIDATION_SCORE = 0.35;

/** Target screen aspect (160 / 144). */
const TARGET_ASPECT = 160 / 144;

// ─── Public interface ───

export interface LocateOptions {
  debug?: DebugCollector;
}

/**
 * Locate the Game Boy Screen within a full phone photo and produce an
 * approximately upright crop suitable for the {@link warp} step.
 *
 * Detection: generate candidate bright quadrilaterals at a downsampled
 * working resolution, validate each against Frame 02 features
 * (inner-border ring, surrounding LCD-black ring), pick the highest-
 * scoring candidate, expand by a proportional margin, and extract the
 * rotated rectangle in original-image pixel space (no resampling beyond
 * the rotation itself).
 *
 * Already-cropped inputs pass through cleanly: with no room to expand,
 * the margin step clamps to image bounds and the output is essentially
 * the input.
 *
 * @throws if no candidate passes minimum frame validation.
 */
export function locate(input: GBImageData, options?: LocateOptions): GBImageData {
  const dbg = options?.debug;

  const cv = getCV();
  const src = imageDataToMat(input);

  return withMats((track) => {
    track(src);

    // ── 2a. Downsample to working resolution ──
    const work = downsampleToWorking(src, WORKING_MAX_DIM);
    track(work.mat);

    // Threshold to binary at working resolution
    const gray = track(new cv.Mat());
    cv.cvtColor(work.mat, gray, cv.COLOR_RGBA2GRAY);
    const binary = track(new cv.Mat());
    cv.threshold(gray, binary, BRIGHTNESS_THRESHOLD, 255, cv.THRESH_BINARY);

    if (dbg) {
      const binaryRgba = track(new cv.Mat());
      cv.cvtColor(binary, binaryRgba, cv.COLOR_GRAY2RGBA);
      dbg.addImage("locate_a_thresholded", matToImageData(binaryRgba));
      dbg.log(
        `[locate] working-res ${work.mat.cols}×${work.mat.rows} ` +
          `(scale=${work.scale.toFixed(3)} from ${input.width}×${input.height}); ` +
          `threshold=${BRIGHTNESS_THRESHOLD}`,
      );
      dbg.setMetric("locate", "workingDim", [work.mat.cols, work.mat.rows]);
      dbg.setMetric("locate", "threshold", BRIGHTNESS_THRESHOLD);
    }

    // ── 2b. Generate candidate quads ──
    // (added in Task 6)

    // ── 2c. Validate candidates against Frame 02 ──
    // (added in Task 7)

    // ── 2d. Map back, expand, rotate, crop ──
    // (added in Task 8; for now, return passthrough)

    return cloneImage(input);
  });
}

// ─── Helpers ───

/**
 * Downsample `src` so the longest side is at most `maxDim`. Returns the
 * downsampled Mat (caller is responsible for tracking/deletion via withMats)
 * and the scale factor (working-resolution px per original-image px) so
 * detected coordinates can be mapped back later.
 */
function downsampleToWorking(src: any, maxDim: number): { mat: any; scale: number } {
  const cv = getCV();
  const w = src.cols;
  const h = src.rows;
  const longest = Math.max(w, h);
  if (longest <= maxDim) {
    // No downsampling needed; clone so the caller's track/delete contract is uniform
    const out = new cv.Mat();
    src.copyTo(out);
    return { mat: out, scale: 1 };
  }
  const scale = maxDim / longest;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  const out = new cv.Mat();
  cv.resize(src, out, new cv.Size(newW, newH), 0, 0, cv.INTER_AREA);
  return { mat: out, scale };
}
