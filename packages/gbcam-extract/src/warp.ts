/**
 * warp.ts — Perspective correction with inner-border refinement
 *
 * Ported from gbcam_warp.py (784 lines).
 *
 * Processing:
 *   1. Detect the four corners of the white filmstrip frame using brightness
 *      thresholding and contour analysis.
 *   2. Apply an initial perspective warp to (SCREEN_W*scale) x (SCREEN_H*scale).
 *   3. Two-pass inner-border refinement:
 *        Back-project corrected corners to the original photo and re-warp in a
 *        single pass — no black bars possible.
 */

import { type GBImageData, SCREEN_W, SCREEN_H, INNER_TOP, INNER_BOT, INNER_LEFT, INNER_RIGHT } from "./common.js";
import { getCV, withMats, imageDataToMat, matToImageData } from "./opencv.js";
import { makeCalibration, undistortBgr } from "./lens-distortion.js";
import {
  type DebugCollector,
  cloneImage,
  drawLine,
  drawPolyline,
  fillCircle,
} from "./debug.js";

// ─── Public interface ───

export interface WarpOptions {
  scale?: number;
  threshold?: number;
  /**
   * Estimate and apply per-image radial lens-distortion correction (k1)
   * before perspective warping. Default true.
   */
  correctLens?: boolean;
  debug?: DebugCollector;
}

export function warp(input: GBImageData, options?: WarpOptions): GBImageData {
  const scale = options?.scale ?? 8;
  const threshVal = options?.threshold ?? 180;
  const correctLens = options?.correctLens ?? true;
  const dbg = options?.debug;

  const cv = getCV();

  // Convert input to BGR Mat (opencv.js convention)
  // We manage Mat lifetimes manually here because of the iterative refinement loop
  const src = imageDataToMat(input);
  let bgr = new cv.Mat();
  cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
  src.delete();

  // pre-a — Lens-distortion correction (k1) search and apply.
  if (correctLens) {
    const lens = chooseAndApplyK1(bgr, scale, threshVal);
    if (dbg) {
      dbg.log(
        `[warp] lens-distortion: k1=${lens.k1.toFixed(4)} ` +
          `score=${lens.score.toFixed(2)} ` +
          `(searched ${lens.evaluated} candidates)`,
      );
      dbg.setMetric("warp", "lensDistortion", {
        k1: Number(lens.k1.toFixed(4)),
        score: Number(lens.score.toFixed(3)),
        evaluated: lens.evaluated,
      });
    }
    bgr.delete();
    bgr = lens.bgrOut;
  }

  // a — Detect screen corners
  const detection = findScreenCornersWithMetrics(bgr, threshVal);
  const corners = detection.ordered;

  if (dbg) {
    dbg.log(
      `[warp] corner detection: area=${detection.area.toFixed(0)} ` +
        `aspect=${detection.aspect.toFixed(3)} ` +
        `(target ${(SCREEN_W / SCREEN_H).toFixed(3)}) ` +
        `thresh=${detection.thresh} score=${detection.score.toFixed(4)}`,
    );
    dbg.log(
      `[warp] detected source corners (TL TR BR BL): ` +
        corners.map((c) => `(${Math.round(c[0])},${Math.round(c[1])})`).join(" "),
    );
    if (detection.score > 0.15) {
      dbg.log(`[warp] WARNING: quad quality is low — detection may be unreliable`);
    }

    // Render input photo with corners overlaid
    const overlay = cloneImage(input);
    const green: [number, number, number] = [0, 255, 0];
    const cornerRadius = Math.max(6, Math.round(Math.min(input.width, input.height) / 200));
    for (const [x, y] of corners) {
      fillCircle(overlay, x, y, cornerRadius, green);
    }
    const polyThick = Math.max(2, Math.round(cornerRadius / 4));
    drawPolyline(
      overlay,
      corners.map(([x, y]) => [x, y] as [number, number]),
      green,
      polyThick,
      true,
    );
    dbg.addImage("warp_a_corners", overlay);

    dbg.setMetrics("warp", {
      threshold: detection.thresh,
      contourArea: Math.round(detection.area),
      aspect: Number(detection.aspect.toFixed(4)),
      quadScore: Number(detection.score.toFixed(4)),
      sourceCorners: corners.map(([x, y]) => [Math.round(x), Math.round(y)]),
    });
  }

  // b — Initial perspective warp
  let { warped: currentWarped, M: currentM } = initialWarp(bgr, corners, scale);

  // c — Refine (pass 1)
  {
    const result = refineWarpWithMetrics(bgr, currentM, currentWarped, scale);
    if (dbg) recordRefinementMetrics(dbg, 1, result.metrics);
    currentM.delete();
    currentWarped.delete();
    currentM = result.M;
    currentWarped = result.refined;
  }

  // c — Refine (pass 2: multi-anchor homography over corners + dashes
  //                + inner-border points; corners weighted higher)
  {
    const result = refineWarpMultiAnchor(bgr, currentM, currentWarped, scale, corners);
    if (dbg) recordRefinementMetrics(dbg, 2, result.metrics);
    currentM.delete();
    currentWarped.delete();
    currentM = result.M;
    currentWarped = result.refined;
  }

  bgr.delete();
  currentM.delete();

  // Convert back to RGBA ImageData
  const rgba = new cv.Mat();
  cv.cvtColor(currentWarped, rgba, cv.COLOR_BGR2RGBA);
  const result = matToImageData(rgba);
  rgba.delete();

  if (dbg) {
    addInnerBorderResidualImage(dbg, currentWarped, result, scale);
  }

  currentWarped.delete();

  return result;
}

function addInnerBorderResidualImage(
  dbg: DebugCollector,
  warpedBgr: any,
  warpedRgba: GBImageData,
  scale: number,
): void {
  const cv = getCV();
  const H = warpedBgr.rows;
  const W = warpedBgr.cols;

  const rbCh = withMats((track, untrack) => {
    const rgb = track(new cv.Mat());
    cv.cvtColor(warpedBgr, rgb, cv.COLOR_BGR2RGB);
    const out = new cv.Mat(H, W, cv.CV_8UC1);
    const rgbData = rgb.data;
    const outData = out.data;
    for (let i = 0; i < H * W; i++) {
      const r = rgbData[i * 3];
      const b = rgbData[i * 3 + 2];
      outData[i] = Math.max(0, Math.min(255, r - b + 128));
    }
    return untrack(out);
  });

  const borderPoints = findBorderPoints(rbCh, scale);
  const corners = findBorderCorners(rbCh, scale);
  rbCh.delete();

  const overlay = cloneImage(warpedRgba);

  const expTop = INNER_TOP * scale;
  const expBottom = INNER_BOT * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;

  const green: [number, number, number] = [0, 255, 0];
  drawLine(overlay, expLeft, expTop, expRight, expTop, green, 1);
  drawLine(overlay, expLeft, expBottom, expRight, expBottom, green, 1);
  drawLine(overlay, expLeft, expTop, expLeft, expBottom, green, 1);
  drawLine(overlay, expRight, expTop, expRight, expBottom, green, 1);

  const red: [number, number, number] = [255, 0, 0];
  for (const [x, y] of [
    ...borderPoints.top,
    ...borderPoints.bottom,
    ...borderPoints.left,
    ...borderPoints.right,
  ]) {
    fillCircle(overlay, x, y, 1, red);
  }

  const yellow: [number, number, number] = [255, 255, 0];
  for (const [x, y] of [corners.TL, corners.TR, corners.BR, corners.BL]) {
    fillCircle(overlay, x, y, 3, yellow);
  }

  dbg.addImage("warp_b_inner_border_residual", overlay);
}

// ─── Dash positions ───
//
// The frame contains 17 horizontal dashes along top/bottom edges and 14 vertical
// dashes along left/right edges. Corner dashes are fused with the adjacent edge
// dashes. We use only the *interior* dashes (skipping corner-fused first/last
// dashes on each side) as anchor points: 15 + 15 + 12 + 12 = 54 anchors.
//
// Centres extracted directly from `supporting-materials/Frame 02.png` and given
// in image-pixel-edge units, where pixel index N occupies coordinates [N, N+1)
// and the centre of pixel N is N + 0.5. To map to warp-space coordinates,
// multiply by `scale`.

/** Interior horizontal dash centres along top/bottom edges. */
const DASH_INTERIOR_TOP_BOTTOM_X = [
  12.5, 22.5, 32, 42, 51.5, 60.5, 70.5, 80, 90, 100.5, 110.5, 120, 130, 139.5, 148.5,
] as const;
/** Interior vertical dash centres along the left edge. */
const DASH_INTERIOR_LEFT_Y = [
  19.5, 29.5, 39.5, 48.5, 58, 68, 77.5, 87.5, 96.5, 106, 116, 125.5,
] as const;
/** Interior vertical dash centres along the right edge (asymmetric vs left). */
const DASH_INTERIOR_RIGHT_Y = [
  15, 24.5, 35, 45, 55, 64.5, 75, 85, 95, 104.5, 115, 125,
] as const;
/** Centre of horizontal dashes (rows 6–7, image-pixel-edge units). */
const DASH_TOP_Y = 7;
const DASH_BOTTOM_Y = 138;
/** Centre of vertical dashes (cols 1–2 / 158, image-pixel-edge units). */
const DASH_LEFT_X = 2;
const DASH_RIGHT_X = 158;

export interface DetectedDashes {
  top: Array<{ expected: [number, number]; detected: [number, number] | null }>;
  bottom: Array<{ expected: [number, number]; detected: [number, number] | null }>;
  left: Array<{ expected: [number, number]; detected: [number, number] | null }>;
  right: Array<{ expected: [number, number]; detected: [number, number] | null }>;
}

/**
 * Detect interior dash centres on a warped image. Returns expected and detected
 * positions in *warp-space coordinates* (GB pixel × scale).
 *
 * Detection: for each side, dashes are pure black (lowest grayscale value) on
 * a frame strip that is otherwise white (#FFFFA5) or dark gray (#9494FF). We
 * find the column- or row-argmin of grayscale within a small window centred
 * on the expected position.
 */
export function detectDashesOnWarp(warped: any, scale: number): DetectedDashes {
  const cv = getCV();

  const gray = new cv.Mat();
  cv.cvtColor(warped, gray, cv.COLOR_BGR2GRAY);

  // Dash centres are given in image-pixel-edge units; multiply by scale to
  // map into warp-space coordinates.
  const toImg = (p: number): number => p * scale;

  const halfWindow = Math.max(2, Math.round(scale * 2)); // ±2 GB pixels
  const stripHalf = Math.round(scale * 0.75); // ±0.75 GB pixel band orthogonal to scan

  const topImgY = toImg(DASH_TOP_Y);
  const bottomImgY = toImg(DASH_BOTTOM_Y);
  const leftImgX = toImg(DASH_LEFT_X);
  const rightImgX = toImg(DASH_RIGHT_X);

  const rowsForTop: [number, number] = [
    Math.max(0, Math.round(topImgY - stripHalf)),
    Math.min(gray.rows, Math.round(topImgY + stripHalf) + 1),
  ];
  const rowsForBottom: [number, number] = [
    Math.max(0, Math.round(bottomImgY - stripHalf)),
    Math.min(gray.rows, Math.round(bottomImgY + stripHalf) + 1),
  ];
  const colsForLeft: [number, number] = [
    Math.max(0, Math.round(leftImgX - stripHalf)),
    Math.min(gray.cols, Math.round(leftImgX + stripHalf) + 1),
  ];
  const colsForRight: [number, number] = [
    Math.max(0, Math.round(rightImgX - stripHalf)),
    Math.min(gray.cols, Math.round(rightImgX + stripHalf) + 1),
  ];

  const top: DetectedDashes["top"] = [];
  for (const gbx of DASH_INTERIOR_TOP_BOTTOM_X) {
    const expectedX = toImg(gbx);
    const detectedX = findArgminAlongCol(
      gray, rowsForTop[0], rowsForTop[1], expectedX, halfWindow,
    );
    top.push({
      expected: [expectedX, topImgY],
      detected: detectedX === null ? null : [detectedX, topImgY],
    });
  }

  const bottom: DetectedDashes["bottom"] = [];
  for (const gbx of DASH_INTERIOR_TOP_BOTTOM_X) {
    const expectedX = toImg(gbx);
    const detectedX = findArgminAlongCol(
      gray, rowsForBottom[0], rowsForBottom[1], expectedX, halfWindow,
    );
    bottom.push({
      expected: [expectedX, bottomImgY],
      detected: detectedX === null ? null : [detectedX, bottomImgY],
    });
  }

  const left: DetectedDashes["left"] = [];
  for (const gby of DASH_INTERIOR_LEFT_Y) {
    const expectedY = toImg(gby);
    const detectedY = findArgminAlongRow(
      gray, colsForLeft[0], colsForLeft[1], expectedY, halfWindow,
    );
    left.push({
      expected: [leftImgX, expectedY],
      detected: detectedY === null ? null : [leftImgX, detectedY],
    });
  }

  const right: DetectedDashes["right"] = [];
  for (const gby of DASH_INTERIOR_RIGHT_Y) {
    const expectedY = toImg(gby);
    const detectedY = findArgminAlongRow(
      gray, colsForRight[0], colsForRight[1], expectedY, halfWindow,
    );
    right.push({
      expected: [rightImgX, expectedY],
      detected: detectedY === null ? null : [rightImgX, detectedY],
    });
  }

  gray.delete();
  return { top, bottom, left, right };
}

/**
 * Threshold (grayscale 0–255) below which a sample contributes weight to the
 * dash centroid. Empirically: dash interiors are < 100, frame ≥ 150.
 */
const DASH_DARK_THRESHOLD = 130;

/**
 * Compute the dark-weighted centroid of a 1D profile, treating values below
 * `threshold` as the "dark region" with weight = (threshold - value). This is
 * robust to argmin instability when the dash interior is approximately flat.
 * Returns the sub-pixel index in profile coordinates, or null if no sample
 * falls below threshold.
 */
function darkCentroid(profile: number[], threshold: number): number | null {
  let sumW = 0;
  let sumWI = 0;
  for (let i = 0; i < profile.length; i++) {
    const w = Math.max(0, threshold - profile[i]);
    sumW += w;
    sumWI += w * i;
  }
  if (sumW < 1) return null;
  return sumWI / sumW;
}

/**
 * Search for the dash centre along a column-direction profile (vary x, mean
 * over a row band). Returns sub-pixel x position, or null on failure.
 */
function findArgminAlongCol(
  gray: any,
  rowStart: number,
  rowEnd: number,
  expectedCol: number,
  halfWindow: number,
): number | null {
  const colStart = Math.max(0, Math.floor(expectedCol - halfWindow));
  const colEnd = Math.min(gray.cols, Math.ceil(expectedCol + halfWindow) + 1);
  if (colStart >= colEnd || rowStart >= rowEnd) return null;
  const profile: number[] = [];
  for (let c = colStart; c < colEnd; c++) {
    let sum = 0;
    let n = 0;
    for (let r = rowStart; r < rowEnd; r++) {
      sum += gray.ucharAt(r, c);
      n++;
    }
    profile.push(n > 0 ? sum / n : 0);
  }
  const idx = darkCentroid(profile, DASH_DARK_THRESHOLD);
  return idx === null ? null : colStart + idx;
}

/**
 * Search for the dash centre along a row-direction profile (vary y, mean over
 * a column band). Returns sub-pixel y position, or null on failure.
 */
function findArgminAlongRow(
  gray: any,
  colStart: number,
  colEnd: number,
  expectedRow: number,
  halfWindow: number,
): number | null {
  const rowStart = Math.max(0, Math.floor(expectedRow - halfWindow));
  const rowEnd = Math.min(gray.rows, Math.ceil(expectedRow + halfWindow) + 1);
  if (rowStart >= rowEnd || colStart >= colEnd) return null;
  const profile: number[] = [];
  for (let r = rowStart; r < rowEnd; r++) {
    let sum = 0;
    let n = 0;
    for (let c = colStart; c < colEnd; c++) {
      sum += gray.ucharAt(r, c);
      n++;
    }
    profile.push(n > 0 ? sum / n : 0);
  }
  const idx = darkCentroid(profile, DASH_DARK_THRESHOLD);
  return idx === null ? null : rowStart + idx;
}

// ─── Refinement metrics recorder ───

interface RefineMetrics {
  edgeCurvatures: { top: number; bottom: number; left: number; right: number };
  cornerErrors: {
    TL: [number, number];
    TR: [number, number];
    BR: [number, number];
    BL: [number, number];
  };
  residual: { maxCornerErr: number; meanEdgeCurv: number };
  refined: boolean;
}

function recordRefinementMetrics(
  dbg: DebugCollector,
  passNum: number,
  m: RefineMetrics,
): void {
  const ec = m.edgeCurvatures;
  dbg.log(
    `[warp] pass ${passNum} edge curvatures: ` +
      `top=${ec.top.toFixed(2)} bot=${ec.bottom.toFixed(2)} ` +
      `left=${ec.left.toFixed(2)} right=${ec.right.toFixed(2)}` +
      (m.refined ? "" : "  (refinement failed; using prior warp)"),
  );
  const ce = m.cornerErrors;
  dbg.log(
    `[warp] pass ${passNum} corner errors: ` +
      `TL=(${ce.TL[0].toFixed(1)},${ce.TL[1].toFixed(1)}) ` +
      `TR=(${ce.TR[0].toFixed(1)},${ce.TR[1].toFixed(1)}) ` +
      `BR=(${ce.BR[0].toFixed(1)},${ce.BR[1].toFixed(1)}) ` +
      `BL=(${ce.BL[0].toFixed(1)},${ce.BL[1].toFixed(1)})`,
  );
  const r = m.residual;
  dbg.log(
    `[warp] pass${passNum} residual: ` +
      `maxCornerErr=${r.maxCornerErr.toFixed(2)} ` +
      `meanEdgeCurv=${r.meanEdgeCurv.toFixed(2)}`,
  );
  dbg.setMetric("warp", `pass${passNum}`, {
    edgeCurvatures: ec,
    cornerErrors: ce,
    residual: r,
    refined: m.refined,
  });
}

// ─── 1D Gaussian filter (replaces scipy.ndimage.gaussian_filter1d) ───

function gaussianFilter1d(input: number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 4);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const n = input.length;
  const output: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let val = 0;
    for (let k = 0; k < kernel.length; k++) {
      let j = i + (k - radius);
      // Reflect at boundaries
      if (j < 0) j = -j;
      if (j >= n) j = 2 * n - 2 - j;
      j = Math.max(0, Math.min(n - 1, j));
      val += input[j] * kernel[k];
    }
    output[i] = val;
  }
  return output;
}

// ─── Corner detection ───

type Point = [number, number];
type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL

function orderCorners(pts: Point[]): Corners {
  // Sum heuristic: TL has smallest x+y, BR has largest
  // Diff heuristic: TR has smallest x-y, BL has largest
  const sums = pts.map(([x, y]) => x + y);
  const diffs = pts.map(([x, y]) => x - y);

  const tlIdx = sums.indexOf(Math.min(...sums));
  const brIdx = sums.indexOf(Math.max(...sums));
  const trIdx = diffs.indexOf(Math.max(...diffs)); // numpy diff is col1-col0 = x-y for [x,y]; wait...

  // In Python: diff = np.diff(pts, axis=1).ravel() which for [[x,y]] gives [y-x]
  // Actually np.diff([[x,y]], axis=1) = [[y-x]], so diff = y-x
  // argmin(diff) = smallest y-x = largest x-y => TR (top-right: large x, small y)
  // argmax(diff) = largest y-x = smallest x-y => BL (bottom-left: small x, large y)
  // Let me re-derive:
  // np.diff(pts, axis=1) computes pts[:,1] - pts[:,0] = y - x for each point
  const yMinusX = pts.map(([x, y]) => y - x);
  const trIdx2 = yMinusX.indexOf(Math.min(...yMinusX)); // smallest y-x => TR
  const blIdx = yMinusX.indexOf(Math.max(...yMinusX));   // largest y-x => BL

  return [pts[tlIdx], pts[trIdx2], pts[brIdx], pts[blIdx]];
}

function scoreQuad(ordered: Corners, imgW: number, imgH: number, targetAspect = 160 / 144): number {
  const [TL, TR, BR, BL] = ordered;
  const top = Math.hypot(TR[0] - TL[0], TR[1] - TL[1]);
  const bot = Math.hypot(BR[0] - BL[0], BR[1] - BL[1]);
  const left = Math.hypot(BL[0] - TL[0], BL[1] - TL[1]);
  const right = Math.hypot(BR[0] - TR[0], BR[1] - TR[1]);
  const wAvg = (top + bot) / 2;
  const hAvg = (left + right) / 2;
  if (hAvg < 10) return 1e9;
  const aspectErr = Math.abs(wAvg / hAvg / targetAspect - 1.0);
  const parallelErr =
    Math.abs(top - bot) / Math.max(wAvg, 1) +
    Math.abs(left - right) / Math.max(hAvg, 1);
  const margin = 5;
  let clips = 0;
  if (TL[0] < margin) clips++;
  if (TL[1] < margin) clips++;
  if (TR[0] > imgW - margin) clips++;
  if (TR[1] < margin) clips++;
  if (BR[0] > imgW - margin) clips++;
  if (BR[1] > imgH - margin) clips++;
  if (BL[0] < margin) clips++;
  if (BL[1] > imgH - margin) clips++;
  return aspectErr * 2.0 + parallelErr + clips * 0.1;
}

interface CornerDetection {
  ordered: Corners;
  score: number;
  thresh: number;
  area: number;
  aspect: number;
}

function findScreenCorners(bgr: any, threshVal: number): Corners {
  return findScreenCornersWithMetrics(bgr, threshVal).ordered;
}

function findScreenCornersWithMetrics(bgr: any, threshVal: number): CornerDetection {
  const cv = getCV();

  return withMats((track, _untrack) => {
    const gray = track(new cv.Mat());
    cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
    const imgH = gray.rows;
    const imgW = gray.cols;

    const kernel = track(cv.Mat.ones(7, 7, cv.CV_8U));

    let best: { score: number; ordered: Corners; thresh: number; area: number; aspect: number } | null = null;

    for (let thresh = threshVal; thresh > 114; thresh -= 5) {
      const binary = track(new cv.Mat());
      cv.threshold(gray, binary, thresh, 255, cv.THRESH_BINARY);

      const closed = track(new cv.Mat());
      cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);

      const contours = track(new cv.MatVector());
      const hierarchy = track(new cv.Mat());
      cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      if (contours.size() === 0) continue;

      // Find largest contour by area
      let largestIdx = 0;
      let largestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const a = cv.contourArea(contours.get(i));
        if (a > largestArea) {
          largestArea = a;
          largestIdx = i;
        }
      }

      const largest = contours.get(largestIdx);
      const area = largestArea;
      if (area < 1000) continue;

      const hull = track(new cv.Mat());
      cv.convexHull(largest, hull);

      const peri = cv.arcLength(hull, true);

      let quad: Point[] | null = null;
      for (const eps of [0.02, 0.03, 0.05, 0.01, 0.10]) {
        const approx = track(new cv.Mat());
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          quad = [];
          for (let i = 0; i < 4; i++) {
            quad.push([approx.intPtr(i, 0)[0], approx.intPtr(i, 0)[1]]);
          }
          break;
        }
      }

      if (quad === null) {
        const rect = cv.boundingRect(largest);
        quad = [
          [rect.x, rect.y],
          [rect.x + rect.width, rect.y],
          [rect.x + rect.width, rect.y + rect.height],
          [rect.x, rect.y + rect.height],
        ];
      }

      const ordered = orderCorners(quad);
      const score = scoreQuad(ordered, imgW, imgH);

      if (best === null || score < best.score) {
        const r = cv.boundingRect(largest);
        const aspect = r.height ? r.width / r.height : 0;
        best = { score, ordered, thresh, area, aspect };
      }

      if (score < 0.05) break;
    }

    if (best === null) {
      throw new Error("No bright contour found -- try adjusting threshold");
    }

    return best;
  });
}

// ─── Initial warp ───

interface WarpResult {
  warped: any; // cv.Mat (BGR)
  M: any;      // cv.Mat (3x3 perspective matrix)
}

function initialWarp(bgr: any, corners: Corners, scale: number): WarpResult {
  const cv = getCV();
  const W = SCREEN_W * scale;
  const H = SCREEN_H * scale;

  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0][0], corners[0][1],
    corners[1][0], corners[1][1],
    corners[2][0], corners[2][1],
    corners[3][0], corners[3][1],
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    W - 1, 0,
    W - 1, H - 1,
    0, H - 1,
  ]);

  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  srcPts.delete();
  dstPts.delete();

  const warped = new cv.Mat();
  const dsize = new cv.Size(W, H);
  cv.warpPerspective(bgr, warped, M, dsize, cv.INTER_LANCZOS4);

  return { warped, M };
}

// ─── Sub-pixel inner-border edge detection ───

function firstDarkFromFrame(profile: number[], smoothSigma = 1.5): number {
  const p = gaussianFilter1d(profile, smoothSigma);
  // Compute diff
  const d: number[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    d.push(p[i + 1] - p[i]);
  }
  // Find argmin
  let k = 0;
  let minVal = d[0];
  for (let i = 1; i < d.length; i++) {
    if (d[i] < minVal) {
      minVal = d[i];
      k = i;
    }
  }
  // Quadratic interpolation
  let delta = 0.0;
  if (k > 0 && k < d.length - 1) {
    const d0 = d[k - 1];
    const d1 = d[k];
    const d2 = d[k + 1];
    const denom = d0 - 2.0 * d1 + d2;
    if (Math.abs(denom) > 1e-10) {
      delta = Math.max(-1.0, Math.min(1.0, 0.5 * (d0 - d2) / denom));
    }
  }
  return k + 1 + delta;
}

// ─── Helper: extract a sub-region mean along an axis from a grayscale Mat ───

/**
 * Compute column means of a grayscale Mat sub-region (mean along axis=0 → one value per column).
 */
function colMeans(mat: any, r1: number, r2: number, c1: number, c2: number): number[] {
  const result: number[] = [];
  for (let c = c1; c < c2; c++) {
    let sum = 0;
    let count = 0;
    for (let r = r1; r < r2; r++) {
      sum += mat.ucharAt(r, c);
      count++;
    }
    result.push(count > 0 ? sum / count : 0);
  }
  return result;
}

/**
 * Compute row means of a grayscale Mat sub-region (mean along axis=1 → one value per row).
 */
function rowMeans(mat: any, r1: number, r2: number, c1: number, c2: number): number[] {
  const result: number[] = [];
  for (let r = r1; r < r2; r++) {
    let sum = 0;
    let count = 0;
    for (let c = c1; c < c2; c++) {
      sum += mat.ucharAt(r, c);
      count++;
    }
    result.push(count > 0 ? sum / count : 0);
  }
  return result;
}

// ─── Find border corners ───

type CornerPts = { TL: Point; TR: Point; BR: Point; BL: Point };

function findBorderCorners(channel: any, scale: number): CornerPts {
  const H = channel.rows;
  const W = channel.cols;
  const srch = 6 * scale;

  const midCol = Math.floor((INNER_LEFT + INNER_RIGHT) / 2) * scale;
  const midRow = Math.floor((INNER_TOP + INNER_BOT) / 2) * scale;

  const cLft: [number, number] = [Math.max(0, 10 * scale), midCol];
  const cRgt: [number, number] = [midCol, Math.min(W, 150 * scale)];

  const rTop: [number, number] = [Math.max(0, 10 * scale), midRow];
  const rBot: [number, number] = [midRow, Math.min(H, (SCREEN_H - 10) * scale)];

  function topY(c0: number, c1: number): number {
    const exp = INNER_TOP * scale;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeans(channel, r1, r2, c0, c1);
    return r1 + firstDarkFromFrame(profile);
  }

  function botY(c0: number, c1: number): number {
    const expFrame = (INNER_BOT + 1) * scale;
    const r1 = Math.max(0, expFrame - srch);
    const r2 = Math.min(H, expFrame + srch);
    const profile = rowMeans(channel, r1, r2, c0, c1);
    const reversed = [...profile].reverse();
    const idx = firstDarkFromFrame(reversed);
    return (r2 - 1) - idx - (scale - 1);
  }

  function leftX(r0: number, r1_: number): number {
    const exp = INNER_LEFT * scale;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeans(channel, r0, r1_, c1, c2);
    return c1 + firstDarkFromFrame(profile);
  }

  function rightX(r0: number, r1_: number): number {
    const expFrame = (INNER_RIGHT + 1) * scale;
    const c1 = Math.max(0, expFrame - srch);
    const c2 = Math.min(W, expFrame + srch);
    const profile = colMeans(channel, r0, r1_, c1, c2);
    const reversed = [...profile].reverse();
    const idx = firstDarkFromFrame(reversed);
    return (c2 - 1) - idx - (scale - 1);
  }

  const tlY = topY(cLft[0], cLft[1]);
  const trY = topY(cRgt[0], cRgt[1]);
  const blY = botY(cLft[0], cLft[1]);
  const brY = botY(cRgt[0], cRgt[1]);
  const tlX = leftX(rTop[0], rTop[1]);
  const blX = leftX(rBot[0], rBot[1]);
  const trX = rightX(rTop[0], rTop[1]);
  const brX = rightX(rBot[0], rBot[1]);

  return {
    TL: [tlX, tlY],
    TR: [trX, trY],
    BR: [brX, brY],
    BL: [blX, blY],
  };
}

// ─── Find border points (multi-point edge detection for curvature) ───

interface BorderPoints {
  top: Point[];
  right: Point[];
  bottom: Point[];
  left: Point[];
}

function findBorderPoints(channel: any, scale: number): BorderPoints {
  const H = channel.rows;
  const W = channel.cols;
  const srch = 6 * scale;

  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;
  const expTop = INNER_TOP * scale;
  const expBottom = INNER_BOT * scale;

  const points: BorderPoints = { top: [], right: [], bottom: [], left: [] };

  // linspace helper
  const linspace = (start: number, end: number, n: number): number[] => {
    if (n <= 1) return [start];
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      result.push(start + (end - start) * i / (n - 1));
    }
    return result;
  };

  // Top edge at 9 points
  for (const colFrac of linspace(0, 1, 9)) {
    let col = Math.floor(expLeft + (expRight - expLeft) * colFrac);
    col = Math.max(0, Math.min(col, W - 1));
    const r1 = Math.max(0, expTop - srch);
    const r2 = Math.min(H, expTop + srch);
    if (r1 < r2) {
      const profile: number[] = [];
      for (let r = r1; r < r2; r++) {
        profile.push(channel.ucharAt(r, col));
      }
      const yPos = r1 + firstDarkFromFrame(profile);
      points.top.push([col, yPos]);
    }
  }

  // Bottom edge at 9 points
  for (const colFrac of linspace(0, 1, 9)) {
    let col = Math.floor(expLeft + (expRight - expLeft) * colFrac);
    col = Math.max(0, Math.min(col, W - 1));
    const r1 = Math.max(0, expBottom - srch);
    const r2 = Math.min(H, expBottom + srch);
    if (r1 < r2) {
      const profile: number[] = [];
      for (let r = r1; r < r2; r++) {
        profile.push(channel.ucharAt(r, col));
      }
      const reversed = [...profile].reverse();
      const idx = firstDarkFromFrame(reversed);
      const yPos = (r2 - 1) - idx - (scale - 1);
      points.bottom.push([col, yPos]);
    }
  }

  // Left edge at 9 points
  for (const rowFrac of linspace(0, 1, 9)) {
    let row = Math.floor(expTop + (expBottom - expTop) * rowFrac);
    row = Math.max(0, Math.min(row, H - 1));
    const c1 = Math.max(0, expLeft - srch);
    const c2 = Math.min(W, expLeft + srch);
    if (c1 < c2) {
      const profile: number[] = [];
      for (let c = c1; c < c2; c++) {
        profile.push(channel.ucharAt(row, c));
      }
      const xPos = c1 + firstDarkFromFrame(profile);
      points.left.push([xPos, row]);
    }
  }

  // Right edge at 9 points
  for (const rowFrac of linspace(0, 1, 9)) {
    let row = Math.floor(expTop + (expBottom - expTop) * rowFrac);
    row = Math.max(0, Math.min(row, H - 1));
    const c1 = Math.max(0, expRight - srch);
    const c2 = Math.min(W, expRight + srch);
    if (c1 < c2) {
      const profile: number[] = [];
      for (let c = c1; c < c2; c++) {
        profile.push(channel.ucharAt(row, c));
      }
      const reversed = [...profile].reverse();
      const idx = firstDarkFromFrame(reversed);
      const xPos = (c2 - 1) - idx - (scale - 1);
      points.right.push([xPos, row]);
    }
  }

  return points;
}

// ─── Validate inner border (diagnostic) ───

function validateInnerBorder(_warped: any, _scale: number, _passNum: number): void {
  // Diagnostic logging only — validation results are not used for control flow.
  // In the TypeScript port we keep this as a no-op stub; real validation
  // happens visually (debug images) or in integration tests.
}

// ─── Verify dash positions (diagnostic) ───

function verifyDashPositions(_warped: any, _scale: number): void {
  // Diagnostic logging only — verification results are not used for control flow.
}

// ─── Refine warp (back-projection refinement) ───

interface RefineResult {
  refined: any; // cv.Mat (BGR)
  M: any;       // cv.Mat (3x3)
}

interface RefineResultWithMetrics extends RefineResult {
  metrics: RefineMetrics;
}

function refineWarpWithMetrics(
  img: any,
  currentM: any,
  warped: any,
  scale: number,
): RefineResultWithMetrics {
  const cv = getCV();
  const H = warped.rows;
  const W = warped.cols;

  // Compute R-B channel: warm frame (#FFFFA5) -> HIGH; cool border (#9494FF) -> LOW
  // In BGR: frame is (165,255,255) so R=255, B=165 → R-B=90 + 128 = HIGH
  //         border is (255,148,148) so R=148, B=255 → R-B=-107 + 128 = LOW
  const rbCh = withMats((track, untrack) => {
    const rgb = track(new cv.Mat());
    cv.cvtColor(warped, rgb, cv.COLOR_BGR2RGB);

    // Create single-channel Mat for R-B+128
    const result = new cv.Mat(H, W, cv.CV_8UC1);
    const rgbData = rgb.data;
    const outData = result.data;
    for (let i = 0; i < H * W; i++) {
      const r = rgbData[i * 3];
      const b = rgbData[i * 3 + 2];
      outData[i] = Math.max(0, Math.min(255, r - b + 128));
    }
    return untrack(result);
  });

  // Get multi-point border detection
  const borderPoints = findBorderPoints(rbCh, scale);

  // Get corner detection
  const corners = findBorderCorners(rbCh, scale);
  rbCh.delete();

  const expTop = INNER_TOP * scale;
  const expBottom = INNER_BOT * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;

  // Analyze edge curvature
  const edgeCurvatures = {
    top: borderPoints.top.length > 0
      ? borderPoints.top.reduce((s, [, y]) => s + (y - expTop), 0) / borderPoints.top.length
      : 0,
    bottom: borderPoints.bottom.length > 0
      ? borderPoints.bottom.reduce((s, [, y]) => s + (y - expBottom), 0) / borderPoints.bottom.length
      : 0,
    left: borderPoints.left.length > 0
      ? borderPoints.left.reduce((s, [x]) => s + (x - expLeft), 0) / borderPoints.left.length
      : 0,
    right: borderPoints.right.length > 0
      ? borderPoints.right.reduce((s, [x]) => s + (x - expRight), 0) / borderPoints.right.length
      : 0,
  };

  // Pre-adjustment corner errors (relative to expected inner-border position)
  const cornerErrors = {
    TL: [corners.TL[0] - expLeft, corners.TL[1] - expTop] as [number, number],
    TR: [corners.TR[0] - expRight, corners.TR[1] - expTop] as [number, number],
    BR: [corners.BR[0] - expRight, corners.BR[1] - expBottom] as [number, number],
    BL: [corners.BL[0] - expLeft, corners.BL[1] - expBottom] as [number, number],
  };

  const maxCornerErr = Math.max(
    ...Object.values(cornerErrors).flat().map(Math.abs),
  );
  const meanEdgeCurv =
    (Math.abs(edgeCurvatures.top) +
      Math.abs(edgeCurvatures.bottom) +
      Math.abs(edgeCurvatures.left) +
      Math.abs(edgeCurvatures.right)) /
    4;
  const residual = {
    maxCornerErr: Number(maxCornerErr.toFixed(3)),
    meanEdgeCurv: Number(meanEdgeCurv.toFixed(3)),
  };

  // Adjust corners for edge curvature
  const corrScale = 0.45;
  const adjusted = {
    TL: [...corners.TL] as Point,
    TR: [...corners.TR] as Point,
    BR: [...corners.BR] as Point,
    BL: [...corners.BL] as Point,
  };

  if (Math.abs(edgeCurvatures.top) > 0.5) {
    adjusted.TL[1] -= edgeCurvatures.top * corrScale;
    adjusted.TR[1] -= edgeCurvatures.top * corrScale;
  }
  if (Math.abs(edgeCurvatures.bottom) > 0.5) {
    adjusted.BL[1] -= edgeCurvatures.bottom * corrScale;
    adjusted.BR[1] -= edgeCurvatures.bottom * corrScale;
  }
  if (Math.abs(edgeCurvatures.left) > 0.5) {
    adjusted.TL[0] -= edgeCurvatures.left * corrScale;
    adjusted.BL[0] -= edgeCurvatures.left * corrScale;
  }
  if (Math.abs(edgeCurvatures.right) > 0.5) {
    adjusted.TR[0] -= edgeCurvatures.right * corrScale;
    adjusted.BR[0] -= edgeCurvatures.right * corrScale;
  }

  // Compute correction homography and back-project
  try {
    const srcBrd = cv.matFromArray(4, 1, cv.CV_32FC2, [
      adjusted.TL[0], adjusted.TL[1],
      adjusted.TR[0], adjusted.TR[1],
      adjusted.BR[0], adjusted.BR[1],
      adjusted.BL[0], adjusted.BL[1],
    ]);
    const dstBrd = cv.matFromArray(4, 1, cv.CV_32FC2, [
      expLeft, expTop,
      expRight, expTop,
      expRight, expBottom,
      expLeft, expBottom,
    ]);

    const Hcorr = cv.getPerspectiveTransform(srcBrd, dstBrd);
    srcBrd.delete();
    dstBrd.delete();

    // Invert H_corr
    const HcorrInv = new cv.Mat();
    cv.invert(Hcorr, HcorrInv);
    Hcorr.delete();

    // Canvas corners in warped space
    const canvas = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      W - 1, 0,
      W - 1, H - 1,
      0, H - 1,
    ]);

    // Transform canvas through H_corr^-1
    const cornersInWarped = new cv.Mat();
    cv.perspectiveTransform(canvas, cornersInWarped, HcorrInv);
    HcorrInv.delete();
    canvas.delete();

    // Invert current M
    const MInv = new cv.Mat();
    cv.invert(currentM, MInv);

    // Transform to source coordinates
    const cornersInSrc = new cv.Mat();
    cv.perspectiveTransform(cornersInWarped, cornersInSrc, MInv);
    MInv.delete();
    cornersInWarped.delete();

    // Build new perspective transform from source corners to output canvas
    const srcCornerData = cornersInSrc.data32F;
    const srcCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      srcCornerData[0], srcCornerData[1],
      srcCornerData[2], srcCornerData[3],
      srcCornerData[4], srcCornerData[5],
      srcCornerData[6], srcCornerData[7],
    ]);
    cornersInSrc.delete();

    const dstCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      W - 1, 0,
      W - 1, H - 1,
      0, H - 1,
    ]);

    const Mnew = cv.getPerspectiveTransform(srcCorners, dstCorners);
    srcCorners.delete();
    dstCorners.delete();

    const refined = new cv.Mat();
    const dsize = new cv.Size(W, H);
    cv.warpPerspective(img, refined, Mnew, dsize, cv.INTER_LANCZOS4);

    return {
      refined,
      M: Mnew,
      metrics: {
        edgeCurvatures: {
          top: Number(edgeCurvatures.top.toFixed(3)),
          bottom: Number(edgeCurvatures.bottom.toFixed(3)),
          left: Number(edgeCurvatures.left.toFixed(3)),
          right: Number(edgeCurvatures.right.toFixed(3)),
        },
        cornerErrors: {
          TL: [Number(cornerErrors.TL[0].toFixed(2)), Number(cornerErrors.TL[1].toFixed(2))],
          TR: [Number(cornerErrors.TR[0].toFixed(2)), Number(cornerErrors.TR[1].toFixed(2))],
          BR: [Number(cornerErrors.BR[0].toFixed(2)), Number(cornerErrors.BR[1].toFixed(2))],
          BL: [Number(cornerErrors.BL[0].toFixed(2)), Number(cornerErrors.BL[1].toFixed(2))],
        },
        residual,
        refined: true,
      },
    };
  } catch {
    // Refinement failed — use current warp
    const Mcopy = currentM.clone();
    const warpedCopy = warped.clone();
    return {
      refined: warpedCopy,
      M: Mcopy,
      metrics: {
        edgeCurvatures: {
          top: Number(edgeCurvatures.top.toFixed(3)),
          bottom: Number(edgeCurvatures.bottom.toFixed(3)),
          left: Number(edgeCurvatures.left.toFixed(3)),
          right: Number(edgeCurvatures.right.toFixed(3)),
        },
        cornerErrors: {
          TL: [Number(cornerErrors.TL[0].toFixed(2)), Number(cornerErrors.TL[1].toFixed(2))],
          TR: [Number(cornerErrors.TR[0].toFixed(2)), Number(cornerErrors.TR[1].toFixed(2))],
          BR: [Number(cornerErrors.BR[0].toFixed(2)), Number(cornerErrors.BR[1].toFixed(2))],
          BL: [Number(cornerErrors.BL[0].toFixed(2)), Number(cornerErrors.BL[1].toFixed(2))],
        },
        residual,
        refined: false,
      },
    };
  }
}

// ─── Lens distortion search ───

const LENS_K1_RANGE: [number, number] = [-0.20, 0.05];
const LENS_COARSE_STEP = 0.025;
const LENS_FINE_STEP = 0.005;
const LENS_FINE_HALF_RANGE = 0.025;

interface LensResult {
  bgrOut: any;
  k1: number;
  score: number;
  evaluated: number;
}

function chooseAndApplyK1(bgr: any, scale: number, threshVal: number): LensResult {
  const W = bgr.cols;
  const H = bgr.rows;
  const { K } = makeCalibration(W, H);

  let evaluated = 0;
  let bestK1 = 0;
  let bestScore = Infinity;

  const evalAt = (k1: number): number | null => {
    evaluated++;
    let undistorted: any = null;
    try {
      undistorted = undistortBgr(bgr, K, k1);
      const score = scoreUndistortedFrame(undistorted, scale, threshVal);
      undistorted.delete();
      return score;
    } catch {
      if (undistorted) undistorted.delete();
      return null;
    }
  };

  for (let k1 = LENS_K1_RANGE[0]; k1 <= LENS_K1_RANGE[1] + 1e-9; k1 += LENS_COARSE_STEP) {
    const s = evalAt(k1);
    if (s !== null && s < bestScore) {
      bestScore = s;
      bestK1 = k1;
    }
  }

  const fineLo = Math.max(LENS_K1_RANGE[0], bestK1 - LENS_FINE_HALF_RANGE);
  const fineHi = Math.min(LENS_K1_RANGE[1], bestK1 + LENS_FINE_HALF_RANGE);
  for (let k1 = fineLo; k1 <= fineHi + 1e-9; k1 += LENS_FINE_STEP) {
    const s = evalAt(k1);
    if (s !== null && s < bestScore) {
      bestScore = s;
      bestK1 = k1;
    }
  }

  const bgrOut = Number.isFinite(bestScore) ? undistortBgr(bgr, K, bestK1) : bgr.clone();
  K.delete();
  return { bgrOut, k1: bestK1, score: bestScore, evaluated };
}

function scoreUndistortedFrame(bgr: any, scale: number, threshVal: number): number | null {
  const cv = getCV();

  let detection: CornerDetection;
  try {
    detection = findScreenCornersWithMetrics(bgr, threshVal);
  } catch {
    return null;
  }

  const initial = initialWarp(bgr, detection.ordered, scale);
  let score: number | null = null;
  try {
    const rb = withMats((track, untrack) => {
      const rgb = track(new cv.Mat());
      cv.cvtColor(initial.warped, rgb, cv.COLOR_BGR2RGB);
      const out = new cv.Mat(initial.warped.rows, initial.warped.cols, cv.CV_8UC1);
      const rgbData = rgb.data;
      const outData = out.data;
      for (let i = 0; i < initial.warped.rows * initial.warped.cols; i++) {
        const r = rgbData[i * 3];
        const b = rgbData[i * 3 + 2];
        outData[i] = Math.max(0, Math.min(255, r - b + 128));
      }
      return untrack(out);
    });
    const points = findBorderPoints(rb, scale);
    rb.delete();

    const expTop = INNER_TOP * scale;
    const expBot = INNER_BOT * scale;
    const expLeft = INNER_LEFT * scale;
    const expRight = INNER_RIGHT * scale;
    const meanDev = (
      pts: Array<[number, number]>,
      idx: 0 | 1,
      target: number,
    ): number => {
      if (pts.length === 0) return 0;
      let sum = 0;
      for (const p of pts) sum += p[idx] - target;
      return sum / pts.length;
    };
    const cTop = meanDev(points.top, 1, expTop);
    const cBot = meanDev(points.bottom, 1, expBot);
    const cLeft = meanDev(points.left, 0, expLeft);
    const cRight = meanDev(points.right, 0, expRight);
    score = Math.abs(cTop) + Math.abs(cBot) + Math.abs(cLeft) + Math.abs(cRight);
  } finally {
    initial.warped.delete();
    initial.M.delete();
  }
  return score;
}

// ─── Pass 2: multi-anchor homography refinement ───
//
// Builds (src, dst) anchor pairs from:
//   - 4 source corners → canvas corners (weighted 5×)
//   - 36 inner-border points → expected positions (weighted 2×)
//   - 54 detected dashes → expected positions (weighted 1×)
// Weights are implemented by point-repetition in the input matrices, since
// cv.findHomography doesn't expose a weight parameter. Uses cv.RANSAC with a
// 3-image-pixel reprojection threshold to reject mis-detections.
//
// All anchors except corners are detected on the warp-space output of pass 1
// (where residuals are < 1 GB pixel) and back-mapped to source via M_pass1^-1.

const MULTI_ANCHOR_RANSAC_THRESHOLD = 3.0;
const CORNER_WEIGHT = 5;
const BORDER_POINT_WEIGHT = 2;
const DASH_WEIGHT = 1;

function refineWarpMultiAnchor(
  img: any,
  currentM: any,
  warped: any,
  scale: number,
  sourceCorners: Corners,
): RefineResultWithMetrics {
  const cv = getCV();
  const Wc = warped.cols;
  const Hc = warped.rows;

  // 1. Detect dashes on the pass-1 warped output.
  const dashes = detectDashesOnWarp(warped, scale);

  // 2. Detect inner-border points on the pass-1 warped output.
  const rb = withMats((track, untrack) => {
    const rgb = track(new cv.Mat());
    cv.cvtColor(warped, rgb, cv.COLOR_BGR2RGB);
    const out = new cv.Mat(Hc, Wc, cv.CV_8UC1);
    const rgbData = rgb.data;
    const outData = out.data;
    for (let i = 0; i < Hc * Wc; i++) {
      const r = rgbData[i * 3];
      const b = rgbData[i * 3 + 2];
      outData[i] = Math.max(0, Math.min(255, r - b + 128));
    }
    return untrack(out);
  });
  const borderPoints = findBorderPoints(rb, scale);
  rb.delete();

  const expTop = INNER_TOP * scale;
  const expBot = INNER_BOT * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;

  // 3. Build (warpDetected, warpExpected) pairs for dashes + inner-border.
  const detectedXY: number[] = [];
  const expectedXY: number[] = [];

  for (const arr of [dashes.top, dashes.bottom, dashes.left, dashes.right]) {
    for (const d of arr) {
      if (d.detected !== null) {
        detectedXY.push(d.detected[0], d.detected[1]);
        expectedXY.push(d.expected[0], d.expected[1]);
      }
    }
  }
  const dashCount = detectedXY.length / 2;

  for (const [x, y] of borderPoints.top) {
    detectedXY.push(x, y);
    expectedXY.push(x, expTop);
  }
  for (const [x, y] of borderPoints.bottom) {
    detectedXY.push(x, y);
    expectedXY.push(x, expBot);
  }
  for (const [x, y] of borderPoints.left) {
    detectedXY.push(x, y);
    expectedXY.push(expLeft, y);
  }
  for (const [x, y] of borderPoints.right) {
    detectedXY.push(x, y);
    expectedXY.push(expRight, y);
  }
  const borderCount = detectedXY.length / 2 - dashCount;

  // 4. Map detected warp positions back to source coords.
  const totalNonCorner = detectedXY.length / 2;
  let sourceXY: number[] = [];
  if (totalNonCorner > 0) {
    const MInv = new cv.Mat();
    cv.invert(currentM, MInv);
    const detMat = cv.matFromArray(totalNonCorner, 1, cv.CV_32FC2, detectedXY);
    const srcMat = new cv.Mat();
    cv.perspectiveTransform(detMat, srcMat, MInv);
    sourceXY = Array.from(srcMat.data32F as Float32Array).slice(0, totalNonCorner * 2);
    detMat.delete();
    srcMat.delete();
    MInv.delete();
  }

  // 5. Build weighted anchor pairs by point repetition.
  const srcPts: number[] = [];
  const dstPts: number[] = [];
  // Corners (×CORNER_WEIGHT)
  const cornerSrc: [number, number][] = sourceCorners;
  const cornerDst: [number, number][] = [
    [0, 0], [Wc - 1, 0], [Wc - 1, Hc - 1], [0, Hc - 1],
  ];
  for (let i = 0; i < 4; i++) {
    for (let r = 0; r < CORNER_WEIGHT; r++) {
      srcPts.push(cornerSrc[i][0], cornerSrc[i][1]);
      dstPts.push(cornerDst[i][0], cornerDst[i][1]);
    }
  }
  // Dashes (×DASH_WEIGHT) — first dashCount entries
  for (let i = 0; i < dashCount; i++) {
    for (let r = 0; r < DASH_WEIGHT; r++) {
      srcPts.push(sourceXY[i * 2], sourceXY[i * 2 + 1]);
      dstPts.push(expectedXY[i * 2], expectedXY[i * 2 + 1]);
    }
  }
  // Inner-border points (×BORDER_POINT_WEIGHT)
  for (let i = 0; i < borderCount; i++) {
    const j = dashCount + i;
    for (let r = 0; r < BORDER_POINT_WEIGHT; r++) {
      srcPts.push(sourceXY[j * 2], sourceXY[j * 2 + 1]);
      dstPts.push(expectedXY[j * 2], expectedXY[j * 2 + 1]);
    }
  }
  const totalPairs = srcPts.length / 2;

  // 6. RANSAC homography fit.
  const srcMat = cv.matFromArray(totalPairs, 1, cv.CV_32FC2, srcPts);
  const dstMat = cv.matFromArray(totalPairs, 1, cv.CV_32FC2, dstPts);
  const inliersMask = new cv.Mat();
  let Hnew: any = null;
  let inlierCount = 0;
  let refinedOk = false;
  try {
    Hnew = cv.findHomography(
      srcMat, dstMat, cv.RANSAC, MULTI_ANCHOR_RANSAC_THRESHOLD, inliersMask,
    );
    if (Hnew && Hnew.rows === 3 && Hnew.cols === 3) {
      for (let i = 0; i < inliersMask.rows; i++) {
        if (inliersMask.ucharAt(i, 0) > 0) inlierCount++;
      }
      refinedOk = true;
    }
  } catch {
    refinedOk = false;
  }
  srcMat.delete();
  dstMat.delete();
  inliersMask.delete();

  let refined: any;
  let MOut: any;
  if (refinedOk) {
    refined = new cv.Mat();
    cv.warpPerspective(img, refined, Hnew, new cv.Size(Wc, Hc), cv.INTER_LANCZOS4);
    MOut = Hnew;
  } else {
    if (Hnew) Hnew.delete();
    refined = warped.clone();
    MOut = currentM.clone();
  }

  // 7. Compute final metrics on refined output.
  const metrics = computeBorderMetrics(refined, scale, refinedOk);

  return { refined, M: MOut, metrics };
}

function computeBorderMetrics(
  warpedBgr: any,
  scale: number,
  refinedOk: boolean,
): RefineMetrics {
  const cv = getCV();
  const H = warpedBgr.rows;
  const W = warpedBgr.cols;

  const rb = withMats((track, untrack) => {
    const rgb = track(new cv.Mat());
    cv.cvtColor(warpedBgr, rgb, cv.COLOR_BGR2RGB);
    const out = new cv.Mat(H, W, cv.CV_8UC1);
    const rgbData = rgb.data;
    const outData = out.data;
    for (let i = 0; i < H * W; i++) {
      const r = rgbData[i * 3];
      const b = rgbData[i * 3 + 2];
      outData[i] = Math.max(0, Math.min(255, r - b + 128));
    }
    return untrack(out);
  });
  const borderPoints = findBorderPoints(rb, scale);
  const corners = findBorderCorners(rb, scale);
  rb.delete();

  const expTop = INNER_TOP * scale;
  const expBot = INNER_BOT * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;

  const edgeCurvatures = {
    top: borderPoints.top.length > 0
      ? borderPoints.top.reduce((s, [, y]) => s + (y - expTop), 0) / borderPoints.top.length : 0,
    bottom: borderPoints.bottom.length > 0
      ? borderPoints.bottom.reduce((s, [, y]) => s + (y - expBot), 0) / borderPoints.bottom.length : 0,
    left: borderPoints.left.length > 0
      ? borderPoints.left.reduce((s, [x]) => s + (x - expLeft), 0) / borderPoints.left.length : 0,
    right: borderPoints.right.length > 0
      ? borderPoints.right.reduce((s, [x]) => s + (x - expRight), 0) / borderPoints.right.length : 0,
  };
  const cornerErrors = {
    TL: [corners.TL[0] - expLeft, corners.TL[1] - expTop] as [number, number],
    TR: [corners.TR[0] - expRight, corners.TR[1] - expTop] as [number, number],
    BR: [corners.BR[0] - expRight, corners.BR[1] - expBot] as [number, number],
    BL: [corners.BL[0] - expLeft, corners.BL[1] - expBot] as [number, number],
  };
  const maxCornerErr = Math.max(...Object.values(cornerErrors).flat().map(Math.abs));
  const meanEdgeCurv = (Math.abs(edgeCurvatures.top) + Math.abs(edgeCurvatures.bottom) +
    Math.abs(edgeCurvatures.left) + Math.abs(edgeCurvatures.right)) / 4;

  return {
    edgeCurvatures: {
      top: Number(edgeCurvatures.top.toFixed(3)),
      bottom: Number(edgeCurvatures.bottom.toFixed(3)),
      left: Number(edgeCurvatures.left.toFixed(3)),
      right: Number(edgeCurvatures.right.toFixed(3)),
    },
    cornerErrors: {
      TL: [Number(cornerErrors.TL[0].toFixed(2)), Number(cornerErrors.TL[1].toFixed(2))],
      TR: [Number(cornerErrors.TR[0].toFixed(2)), Number(cornerErrors.TR[1].toFixed(2))],
      BR: [Number(cornerErrors.BR[0].toFixed(2)), Number(cornerErrors.BR[1].toFixed(2))],
      BL: [Number(cornerErrors.BL[0].toFixed(2)), Number(cornerErrors.BL[1].toFixed(2))],
    },
    residual: {
      maxCornerErr: Number(maxCornerErr.toFixed(3)),
      meanEdgeCurv: Number(meanEdgeCurv.toFixed(3)),
    },
    refined: refinedOk,
  };
}

