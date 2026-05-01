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
    const candidates = findCandidates(binary, TOP_N_CANDIDATES);

    if (candidates.length === 0) {
      throw new Error(
        `[locate] No candidate quadrilaterals found at threshold=${BRIGHTNESS_THRESHOLD}. ` +
          `The Game Boy Screen may be too dark or the photo too distant.`,
      );
    }

    if (dbg) {
      const workingRgba = matToImageData(work.mat);
      // Chosen index is unknown until validation runs (Task 7). Draw all
      // candidates as red here; Task 7 overwrites this debug image with
      // the chosen candidate highlighted in green.
      dbg.addImage("locate_b_candidates", drawCandidates(workingRgba, candidates, -1));
      dbg.log(
        `[locate] found ${candidates.length} candidate(s); ` +
          `top score=${candidates[0].score.toFixed(3)}`,
      );
      dbg.setMetric("locate", "candidateCount", candidates.length);
    }

    // ── 2c. Validate candidates against Frame 02 ──
    // (added in Task 7)

    // ── 2d. Map back, expand, rotate, crop ──
    // (added in Task 8; for now, return passthrough)

    return cloneImage(input);
  });
}

// ─── Helpers ───

type Point = [number, number];
type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL

interface Candidate {
  /** Corners ordered TL, TR, BR, BL in working-resolution pixel coords. */
  corners: Corners;
  /** Width/height from the candidate's minAreaRect, sorted so width >= height. */
  width: number;
  height: number;
  area: number;
  /** Composite score (lower = better fit to expected screen shape). */
  score: number;
}

/**
 * Compute the four vertices of a `cv.minAreaRect` result. OpenCV.js doesn't
 * expose `cv.boxPoints`, so we compute the points from the rect's `center`,
 * `size`, and `angle` (degrees) ourselves.
 */
function rotatedRectPoints(rect: { center: { x: number; y: number }; size: { width: number; height: number }; angle: number }): Point[] {
  const { center, size, angle } = rect;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = size.width / 2;
  const hh = size.height / 2;
  const local: Point[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([x, y]) => [
    center.x + x * cos - y * sin,
    center.y + x * sin + y * cos,
  ]);
}

/**
 * Order four points TL, TR, BR, BL using the same sum/diff heuristic that
 * warp.ts uses, so detected corners are consistent across the codebase.
 */
function orderCornersTLTRBRBL(pts: Point[]): Corners {
  const sums = pts.map(([x, y]) => x + y);
  const yMinusX = pts.map(([x, y]) => y - x);
  const tlIdx = sums.indexOf(Math.min(...sums));
  const brIdx = sums.indexOf(Math.max(...sums));
  const trIdx = yMinusX.indexOf(Math.min(...yMinusX));
  const blIdx = yMinusX.indexOf(Math.max(...yMinusX));
  return [pts[tlIdx], pts[trIdx], pts[brIdx], pts[blIdx]];
}

/**
 * Find candidate quads in a binary (already-thresholded) working-resolution
 * image. Returns up to `topN` candidates ranked by score (lower is better).
 */
function findCandidates(binary: any, topN: number): Candidate[] {
  const cv = getCV();
  const imgArea = binary.cols * binary.rows;
  const minArea = imgArea * MIN_CANDIDATE_AREA_FRAC;

  return withMats((track) => {
    const contours = track(new cv.MatVector());
    const hierarchy = track(new cv.Mat());
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates: Candidate[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < minArea) continue;

      const rect = cv.minAreaRect(contour);
      // OpenCV.js doesn't expose cv.boxPoints as a free function — compute
      // the four vertices of the rotated rectangle manually from its
      // (center, size, angle) representation.
      const pts = rotatedRectPoints(rect);
      const corners = orderCornersTLTRBRBL(pts);

      const w = rect.size.width;
      const h = rect.size.height;
      const longSide = Math.max(w, h);
      const shortSide = Math.max(Math.min(w, h), 1);
      const aspect = longSide / shortSide;
      const aspectErr = Math.abs(aspect / TARGET_ASPECT - 1);

      // Quad-ness: how close the contour's area is to the minAreaRect's area.
      // Genuine rectangles fill their minAreaRect tightly.
      const rectArea = w * h;
      const fillRatio = rectArea > 0 ? area / rectArea : 0;
      const quadnessErr = Math.max(0, 1 - fillRatio);

      const score = aspectErr * 1.5 + quadnessErr * 1.0;

      candidates.push({
        corners,
        width: longSide,
        height: shortSide,
        area,
        score,
      });
    }

    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, topN);
  });
}

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

/**
 * Draw all candidates on a copy of the working-resolution photo. The
 * `chosen` candidate (index into `candidates`, or -1 for none) is drawn in
 * green; all others in red. Each is labeled with its score.
 */
function drawCandidates(
  workingRgba: GBImageData,
  candidates: Candidate[],
  chosen: number,
): GBImageData {
  // We avoid pulling in font rendering — just a polyline per candidate is
  // enough for visual debugging. Scores appear in the structured JSON metrics.
  const out = cloneImage(workingRgba);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const color: [number, number, number] = i === chosen ? [0, 255, 0] : [255, 0, 0];
    drawPolylineRGBA(out, c.corners, color, 2, true);
  }
  return out;
}

function drawPolylineRGBA(
  img: GBImageData,
  pts: Point[],
  color: [number, number, number],
  thickness: number,
  closed: boolean,
): void {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (i === n - 1 && !closed) break;
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    drawLineRGBA(img, x0, y0, x1, y1, color, thickness);
  }
}

function drawLineRGBA(
  img: GBImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
  thickness: number,
): void {
  // Bresenham with a thickness pad
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const steps = Math.max(dx, dy);
  const r = Math.max(1, Math.floor(thickness / 2));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let dyp = -r; dyp <= r; dyp++) {
      for (let dxp = -r; dxp <= r; dxp++) {
        const px = x + dxp;
        const py = y + dyp;
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
        const idx = (py * img.width + px) * 4;
        img.data[idx] = color[0];
        img.data[idx + 1] = color[1];
        img.data[idx + 2] = color[2];
        img.data[idx + 3] = 255;
      }
    }
  }
}
