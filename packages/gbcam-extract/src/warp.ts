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
import {
  type DebugCollector,
  cloneImage,
  drawLine,
  drawPolyline,
  fillCircle,
  strokeRect,
} from "./debug.js";

// ─── Public interface ───

export interface WarpOptions {
  scale?: number;
  threshold?: number;
  debug?: DebugCollector;
}

export function warp(input: GBImageData, options?: WarpOptions): GBImageData {
  const scale = options?.scale ?? 8;
  const threshVal = options?.threshold ?? 180;
  const dbg = options?.debug;

  const cv = getCV();

  // Convert input to BGR Mat (opencv.js convention)
  // We manage Mat lifetimes manually here because of the iterative refinement loop
  const src = imageDataToMat(input);
  const bgr = new cv.Mat();
  cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
  src.delete();

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

  // c — Refine (pass 2)
  {
    const result = refineWarpWithMetrics(bgr, currentM, currentWarped, scale);
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
    addDetectionDebugImage(dbg, currentWarped, result, scale);
    addBorderDetectionImage(dbg, currentWarped, result, scale);
  }

  currentWarped.delete();

  return result;
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
  dbg.setMetric("warp", `pass${passNum}`, {
    edgeCurvatures: ec,
    cornerErrors: ce,
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
        refined: false,
      },
    };
  }
}

// ─── Diagnostic functions and constants ported from current branch ───

const DASH_INTERIOR_TOP_BOTTOM_X = [
  21, 29, 37, 45, 53, 61, 69, 77, 85, 93, 101, 109, 117, 125, 133, 141, 149,
];
const DASH_INTERIOR_LEFT_Y = [
  26, 34, 42, 50, 58, 66, 74, 82, 90, 98, 106, 114, 122, 130,
];
const DASH_INTERIOR_RIGHT_Y = [
  26, 34, 42, 50, 58, 66, 74, 82, 90, 98, 106, 114, 122, 130,
];
const DASH_TOP_Y = 7;
const DASH_BOTTOM_Y = 138;
const DASH_LEFT_X = 2;
const DASH_RIGHT_X = 158;

const DASH_BK_MIN_CONTRAST = 30;
const DASH_BK_PROFILE_THRESH_FRAC_LONG = 0.5;
const DASH_BK_PROFILE_THRESH_FRAC_SHORT = 0.3;
const DASH_DARK_THRESHOLD = 130;

function addBorderDetectionImage(
  dbg: DebugCollector,
  warpedBgr: any,
  warpedRgba: GBImageData,
  scale: number,
): void {
  const points = detectInnerBorderThresholdCrossings(warpedBgr, scale);

  const overlay = cloneImage(warpedRgba);

  const green: [number, number, number] = [0, 255, 0];
  const magenta: [number, number, number] = [255, 0, 220];
  const yellow: [number, number, number] = [255, 255, 0];
  const cyan: [number, number, number] = [0, 200, 255];

  const setPx = (x: number, y: number, c: [number, number, number]) => {
    const idx = (Math.round(y) * overlay.width + Math.round(x)) * 4;
    if (idx >= 0 && idx < overlay.data.length - 3) {
      overlay.data[idx] = c[0];
      overlay.data[idx + 1] = c[1];
      overlay.data[idx + 2] = c[2];
      overlay.data[idx + 3] = 255;
    }
  };

  const expTop = INNER_TOP * scale;
  const expBot = (INNER_BOT + 1) * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = (INNER_RIGHT + 1) * scale;

  // Draw canonical rectangle (green dashed)
  const step = Math.max(2, Math.round(scale / 2));
  for (let x = expLeft; x <= expRight; x += step * 2) {
    for (let i = 0; i < step; i++) {
      setPx(x + i, expTop, green);
      setPx(x + i, expBot, green);
    }
  }
  for (let y = expTop; y <= expBot; y += step * 2) {
    for (let i = 0; i < step; i++) {
      setPx(expLeft, y + i, green);
      setPx(expRight, y + i, green);
    }
  }

  let sumAbsBias = 0;
  let maxAbsBias = 0;
  let nLargeBias = 0;

  const sideStats = {
    top: { n: 0, mean: 0, missing: 0 },
    bottom: { n: 0, mean: 0, missing: 0 },
    left: { n: 0, mean: 0, missing: 0 },
    right: { n: 0, mean: 0, missing: 0 },
  };

  const perPoint: Array<{ x: number; y: number; bias: number; side: string }> = [];

  for (const p of points) {
    const dx = p.detectedX - p.expectedX;
    const dy = p.detectedY - p.expectedY;
    const bias = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const absBias = Math.abs(bias);
    sumAbsBias += absBias;
    if (absBias > maxAbsBias) maxAbsBias = absBias;
    if (absBias > 1) nLargeBias++;

    let side = "";
    if (Math.abs(p.expectedY - expTop) < 0.5) side = "top";
    else if (Math.abs(p.expectedY - expBot) < 0.5) side = "bottom";
    else if (Math.abs(p.expectedX - expLeft) < 0.5) side = "left";
    else if (Math.abs(p.expectedX - expRight) < 0.5) side = "right";

    if (side) {
      sideStats[side as keyof typeof sideStats].n++;
      sideStats[side as keyof typeof sideStats].mean += bias;
      perPoint.push({ x: p.expectedX, y: p.expectedY, bias, side });
    }

    // Magenta cross at detected position
    for (let i = -1; i <= 1; i++) {
      setPx(p.detectedX + i, p.detectedY, magenta);
      setPx(p.detectedX, p.detectedY + i, magenta);
    }

    // Yellow line if bias > 1px
    if (absBias > 1) {
      drawLine(overlay, p.expectedX, p.expectedY, p.detectedX, p.detectedY, yellow);

    }

    // Cyan tick for contrast
    const tickLen = Math.max(1, Math.round(p.contrast / 50));
    const dir = Math.abs(p.expectedY - expTop) < 0.5 || Math.abs(p.expectedX - expLeft) < 0.5 ? 1 : -1;
    if (Math.abs(p.expectedY - expTop) < 0.5 || Math.abs(p.expectedY - expBot) < 0.5) {
      for (let i = 1; i <= tickLen; i++) setPx(p.expectedX, p.expectedY + dir * i, cyan);
    } else {
      for (let i = 1; i <= tickLen; i++) setPx(p.expectedX + dir * i, p.expectedY, cyan);
    }
  }

  for (const s of Object.values(sideStats)) {
    if (s.n > 0) s.mean /= s.n;
    s.missing = 33 - s.n; // N_POINTS = 33
  }

  dbg.addImage("warp_e_border_detection", overlay);

  const meanAbsBias = points.length > 0 ? sumAbsBias / points.length : 0;
  dbg.log(
    `[warp] border detection: n=${points.length}, ` +
      `meanAbsBias=${meanAbsBias.toFixed(2)} px, maxAbsBias=${maxAbsBias.toFixed(2)} px, ` +
      `${nLargeBias} with |bias|>1px ` +
      `(missing: T=${sideStats.top.missing}, B=${sideStats.bottom.missing}, ` +
      `L=${sideStats.left.missing}, R=${sideStats.right.missing})`,
  );
  dbg.setMetric("warp", "borderDetectionPostTps", {
    n: points.length,
    meanAbsBias: Number(meanAbsBias.toFixed(3)),
    maxAbsBias: Number(maxAbsBias.toFixed(3)),
    nLargeBias,
    perSide: sideStats,
    perPoint,
  });
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
  const magenta: [number, number, number] = [255, 0, 255];
  const yellow: [number, number, number] = [255, 255, 0];
  const green: [number, number, number] = [0, 255, 0];

  const expTop = INNER_TOP * scale;
  const expBot = INNER_BOT * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;

  // Draw expected inner border (green)
  strokeRect(overlay, expLeft, expTop, expRight - expLeft, expBot - expTop, green);

  // Draw detected corners (magenta)
  for (const pt of [corners.TL, corners.TR, corners.BR, corners.BL]) {
    fillCircle(overlay, pt[0], pt[1], 4, magenta);
  }

  // Draw border points (magenta dots) and residuals (yellow lines)
  const allPoints = [...borderPoints.top, ...borderPoints.right, ...borderPoints.bottom, ...borderPoints.left];
  for (const [x, y] of allPoints) {
    fillCircle(overlay, x, y, 2, magenta);
    // Find expected position
    let ex = x, ey = y;
    if (Math.abs(y - expTop) < 10 * scale) ey = expTop;
    else if (Math.abs(y - expBot) < 10 * scale) ey = expBot;
    else if (Math.abs(x - expLeft) < 10 * scale) ex = expLeft;
    else if (Math.abs(x - expRight) < 10 * scale) ex = expRight;

    if (Math.hypot(x - ex, y - ey) > 1) {
      drawLine(overlay, x, y, ex, ey, yellow);
    }
  }

  dbg.addImage("warp_b_inner_border_residual", overlay);
}

function addDetectionDebugImage(
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

  const corners = findBorderCorners(rbCh, scale);
  rbCh.delete();

  const dashes = detectDashesOnWarp(warpedBgr, scale);

  const overlay = cloneImage(warpedRgba);
  const green: [number, number, number] = [0, 255, 0];
  const magenta: [number, number, number] = [255, 0, 255];
  const yellow: [number, number, number] = [255, 255, 0];
  const cyan: [number, number, number] = [0, 255, 255];

  const expTop = INNER_TOP * scale;
  const expBot = INNER_BOT * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = INNER_RIGHT * scale;

  // Inner border corners
  for (const pt of [corners.TL, corners.TR, corners.BR, corners.BL]) {
    fillCircle(overlay, pt[0], pt[1], 5, magenta);
  }
  strokeRect(overlay, expLeft, expTop, expRight - expLeft, expBot - expTop, green);

  // Dashes
  const longHalf = Math.max(2, Math.round(scale * 4));
  const shortHalf = Math.max(2, Math.round(scale * 2));

  const allDashes = [...dashes.top, ...dashes.bottom, ...dashes.left, ...dashes.right];
  for (const d of allDashes) {
    const [ex, ey] = d.centroidExpected;
    // Expected (green cross)
    drawLine(overlay, ex - 3, ey, ex + 3, ey, green);
    drawLine(overlay, ex, ey - 3, ex, ey + 3, green);

    // Search box (cyan)
    const isVert = Math.abs(ex - expLeft) < 10 * scale || Math.abs(ex - expRight) < 10 * scale;
    const xh = isVert ? shortHalf : longHalf;
    const yh = isVert ? longHalf : shortHalf;
    strokeRect(overlay, ex - xh, ey - yh, xh * 2, yh * 2, cyan);

    if (d.centroidDetected) {
      const [dx, dy] = d.centroidDetected;
      // Detected (magenta box)
      strokeRect(overlay, dx - 2, dy - 2, 4, 4, magenta);
      fillCircle(overlay, dx, dy, 1, magenta);

      if (Math.hypot(dx - ex, dy - ey) > 1) {
        drawLine(overlay, ex, ey, dx, dy, yellow);
      }
    }
  }

  dbg.addImage("warp_c_detection_debug", overlay);
}

function detectInnerBorderThresholdCrossings(
  warpedBgr: any, scale: number,
): InnerBorderXing[] {
  const cv = getCV();
  const W = warpedBgr.cols;
  const H = warpedBgr.rows;
  const blurredBgr = new cv.Mat();
  const kx = Math.max(3, Math.floor(scale / 2) * 2 + 1);
  cv.GaussianBlur(warpedBgr, blurredBgr, new cv.Size(kx, 1), scale / 3, 0);
  const gray = new cv.Mat(H, W, cv.CV_8UC1);
  const bgrData = blurredBgr.data as Uint8Array;
  const gData = gray.data as Uint8Array;
  for (let i = 0; i < H * W; i++) {
    const b = bgrData[i * 3];
    const g = bgrData[i * 3 + 1];
    const r = bgrData[i * 3 + 2];
    const v = 2 * b - r - g;
    gData[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  blurredBgr.delete();

  const expTop = INNER_TOP * scale;
  const expBot = (INNER_BOT + 1) * scale;
  const expLeft = INNER_LEFT * scale;
  const expRight = (INNER_RIGHT + 1) * scale;
  const points: InnerBorderXing[] = [];

  const symBox = (p: Float64Array, k: number): Float64Array => {
    if (k <= 1) return p.slice();
    const odd = k % 2 === 0 ? k + 1 : k;
    const half = Math.floor(odd / 2);
    const out = new Float64Array(p.length);
    for (let i = 0; i < p.length; i++) {
      let s = 0, n = 0;
      for (let j = -half; j <= half; j++) {
        const idx = i + j;
        if (idx >= 0 && idx < p.length) { s += p[idx]; n++; }
      }
      out[i] = s / Math.max(1, n);
    }
    return out;
  };
  const gauss = (p: Float64Array, sigma: number): Float64Array => {
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const k = new Float64Array(2 * radius + 1);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      k[i + radius] = v; sum += v;
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const out = new Float64Array(p.length);
    for (let i = 0; i < p.length; i++) {
      let s = 0;
      for (let j = -radius; j <= radius; j++) {
        const idx = Math.max(0, Math.min(p.length - 1, i + j));
        s += p[idx] * k[j + radius];
      }
      out[i] = s;
    }
    return out;
  };

  const findEdge = (
    profile: Float64Array, canonOuterIdx: number, frameDir: 1 | -1,
  ): { edge: number; contrast: number } | null => {
    const sm = gauss(symBox(profile, scale + 1), 1.0);
    const stripCentreIdx = canonOuterIdx - frameDir * (scale / 2);
    const peakHalf = Math.max(1, 3 * scale);
    const peakLo = Math.max(0, Math.floor(stripCentreIdx - peakHalf));
    const peakHi = Math.min(sm.length - 1, Math.ceil(stripCentreIdx + peakHalf));
    if (peakLo >= peakHi) return null;
    let peakIdx = peakLo, peakVal = sm[peakLo];
    for (let i = peakLo + 1; i <= peakHi; i++) {
      if (sm[i] > peakVal) { peakVal = sm[i]; peakIdx = i; }
    }
    const baselineIdx = Math.max(0, Math.min(
      sm.length - 1,
      Math.round(canonOuterIdx + frameDir * 3 * scale),
    ));
    const baselineVal = sm[baselineIdx];
    const contrast = peakVal - baselineVal;
    if (contrast < 60) return null;
    const threshold = baselineVal + 0.5 * contrast;
    let i = peakIdx;
    while (i + frameDir >= 0 && i + frameDir < sm.length) {
      const a = sm[i];
      const b = sm[i + frameDir];
      if (a >= threshold && b < threshold) {
        const t = (a - threshold) / (a - b);
        return { edge: i + frameDir * Math.max(0, Math.min(1, t)), contrast };
      }
      i += frameDir;
    }
    return null;
  };

  const linspace = (start: number, end: number, n: number): number[] => {
    const r: number[] = [];
    for (let i = 0; i < n; i++) r.push(start + (end - start) * i / (n - 1));
    return r;
  };
  const N_POINTS = 33;
  const CORNER_FRAC = 0;

  for (const colFrac of linspace(CORNER_FRAC, 1 - CORNER_FRAC, N_POINTS)) {
    const x = Math.floor(expLeft + (expRight - expLeft) * colFrac);
    if (x < 0 || x >= W) continue;
    const r1 = Math.max(0, expTop - 6 * scale);
    const r2 = Math.min(H, expTop + 6 * scale);
    if (r2 - r1 < 3 * scale) continue;
    const profile = new Float64Array(r2 - r1);
    const cLo = Math.max(0, x - 1);
    const cHi = Math.min(W, x + 2);
    for (let r = r1; r < r2; r++) {
      let s = 0, n = 0;
      for (let c = cLo; c < cHi; c++) { s += gray.ucharAt(r, c); n++; }
      profile[r - r1] = s / Math.max(1, n);
    }
    const canonOuterIdx = expTop - r1;
    const result = findEdge(profile, canonOuterIdx, -1);
    if (result === null) continue;
    points.push({
      expectedX: x, expectedY: expTop,
      detectedX: x, detectedY: r1 + result.edge,
      contrast: result.contrast,
    });
  }
  for (const colFrac of linspace(CORNER_FRAC, 1 - CORNER_FRAC, N_POINTS)) {
    const x = Math.floor(expLeft + (expRight - expLeft) * colFrac);
    if (x < 0 || x >= W) continue;
    const r1 = Math.max(0, expBot - 6 * scale);
    const r2 = Math.min(H, expBot + 6 * scale);
    if (r2 - r1 < 3 * scale) continue;
    const profile = new Float64Array(r2 - r1);
    const cLo = Math.max(0, x - 1);
    const cHi = Math.min(W, x + 2);
    for (let r = r1; r < r2; r++) {
      let s = 0, n = 0;
      for (let c = cLo; c < cHi; c++) { s += gray.ucharAt(r, c); n++; }
      profile[r - r1] = s / Math.max(1, n);
    }
    const canonOuterIdx = expBot - r1;
    const result = findEdge(profile, canonOuterIdx, +1);
    if (result === null) continue;
    points.push({
      expectedX: x, expectedY: expBot,
      detectedX: x, detectedY: r1 + result.edge,
      contrast: result.contrast,
    });
  }
  for (const rowFrac of linspace(CORNER_FRAC, 1 - CORNER_FRAC, N_POINTS)) {
    const y = Math.floor(expTop + (expBot - expTop) * rowFrac);
    if (y < 0 || y >= H) continue;
    const c1 = Math.max(0, expLeft - 6 * scale);
    const c2 = Math.min(W, expLeft + 6 * scale);
    if (c2 - c1 < 3 * scale) continue;
    const profile = new Float64Array(c2 - c1);
    const rLo = Math.max(0, y - 1);
    const rHi = Math.min(H, y + 2);
    for (let c = c1; c < c2; c++) {
      let s = 0, n = 0;
      for (let r = rLo; r < rHi; r++) { s += gray.ucharAt(r, c); n++; }
      profile[c - c1] = s / Math.max(1, n);
    }
    const canonOuterIdx = expLeft - c1;
    const result = findEdge(profile, canonOuterIdx, -1);
    if (result === null) continue;
    points.push({
      expectedX: expLeft, expectedY: y,
      detectedX: c1 + result.edge, detectedY: y,
      contrast: result.contrast,
    });
  }
  for (const rowFrac of linspace(CORNER_FRAC, 1 - CORNER_FRAC, N_POINTS)) {
    const y = Math.floor(expTop + (expBot - expTop) * rowFrac);
    if (y < 0 || y >= H) continue;
    const c1 = Math.max(0, expRight - 6 * scale);
    const c2 = Math.min(W, expRight + 6 * scale);
    if (c2 - c1 < 3 * scale) continue;
    const profile = new Float64Array(c2 - c1);
    const rLo = Math.max(0, y - 1);
    const rHi = Math.min(H, y + 2);
    for (let c = c1; c < c2; c++) {
      let s = 0, n = 0;
      for (let r = rLo; r < rHi; r++) { s += gray.ucharAt(r, c); n++; }
      profile[c - c1] = s / Math.max(1, n);
    }
    const canonOuterIdx = expRight - c1;
    const result = findEdge(profile, canonOuterIdx, +1);
    if (result === null) continue;
    points.push({
      expectedX: expRight, expectedY: y,
      detectedX: c1 + result.edge, detectedY: y,
      contrast: result.contrast,
    });
  }
  gray.delete();
  return points;
}

interface InnerBorderXing {
  expectedX: number;
  expectedY: number;
  detectedX: number;
  detectedY: number;
  contrast: number;
}

interface DetectedDashes {
  top: Array<{
    expected: [number, number]; detected: [number, number] | null;
    centroidExpected: [number, number]; centroidDetected: [number, number] | null;
  }>;
  bottom: Array<{
    expected: [number, number]; detected: [number, number] | null;
    centroidExpected: [number, number]; centroidDetected: [number, number] | null;
  }>;
  left: Array<{
    expected: [number, number]; detected: [number, number] | null;
    centroidExpected: [number, number]; centroidDetected: [number, number] | null;
  }>;
  right: Array<{
    expected: [number, number]; detected: [number, number] | null;
    centroidExpected: [number, number]; centroidDetected: [number, number] | null;
  }>;
}

function detectDashesOnWarp(warped: any, scale: number): DetectedDashes {
  const cv = getCV();
  const H = warped.rows;
  const W = warped.cols;

  const blurred = new cv.Mat();
  const kx = Math.max(3, Math.floor(scale / 2) * 2 + 1);
  cv.GaussianBlur(warped, blurred, new cv.Size(kx, 1), scale / 3, 0);
  const gray = new cv.Mat();
  cv.cvtColor(blurred, gray, cv.COLOR_BGR2GRAY);
  blurred.delete();

  const gaussSigma = scale * 4;
  const ksize = 2 * Math.ceil(gaussSigma * 2) + 1;
  const flat = new cv.Mat();
  withMats((track, _untrack) => {
    const bg = track(new cv.Mat());
    cv.GaussianBlur(gray, bg, new cv.Size(ksize, ksize), gaussSigma, gaussSigma);
    const grayData = gray.data;
    const bgData = bg.data;
    const outData = new Uint8Array(grayData.length);
    for (let i = 0; i < grayData.length; i++) {
      const v = grayData[i] - bgData[i] + 128;
      outData[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    flat.create(gray.rows, gray.cols, cv.CV_8UC1);
    flat.data.set(outData);
  });
  const grayRaw = gray;
  const gray2 = flat;

  const toImg = (p: number): number => p * scale;
  const longHalf = Math.max(2, Math.round(scale * 4));
  const shortHalf = Math.max(2, Math.round(scale * 2));

  const topImgY = toImg(DASH_TOP_Y);
  const bottomImgY = toImg(DASH_BOTTOM_Y);
  const leftImgX = toImg(DASH_LEFT_X);
  const rightImgX = toImg(DASH_RIGHT_X);
  const topOuterY = toImg(DASH_TOP_Y - 1);
  const bottomOuterY = toImg(DASH_BOTTOM_Y + 1);
  const leftOuterX = toImg(DASH_LEFT_X - 1);
  const rightOuterX = toImg(DASH_RIGHT_X + 1);

  const top: DetectedDashes["top"] = [];
  for (const gbx of DASH_INTERIOR_TOP_BOTTOM_X) {
    const expectedX = toImg(gbx);
    const r = findDarkCentroid2D(gray2, expectedX, topImgY, longHalf, shortHalf, scale, -1, grayRaw);
    if (r === null || r.outerEdge === null) {
      top.push({
        expected: [expectedX, topOuterY], detected: null,
        centroidExpected: [expectedX, topImgY], centroidDetected: r?.centroid ?? null,
      });
    } else {
      top.push({
        expected: [expectedX, topOuterY], detected: [r.centroid[0], r.outerEdge],
        centroidExpected: [expectedX, topImgY], centroidDetected: r.centroid,
      });
    }
  }

  const bottom: DetectedDashes["bottom"] = [];
  for (const gbx of DASH_INTERIOR_TOP_BOTTOM_X) {
    const expectedX = toImg(gbx);
    const r = findDarkCentroid2D(gray2, expectedX, bottomImgY, longHalf, shortHalf, scale, +1, grayRaw);
    if (r === null || r.outerEdge === null) {
      bottom.push({
        expected: [expectedX, bottomOuterY], detected: null,
        centroidExpected: [expectedX, bottomImgY], centroidDetected: r?.centroid ?? null,
      });
    } else {
      bottom.push({
        expected: [expectedX, bottomOuterY], detected: [r.centroid[0], r.outerEdge],
        centroidExpected: [expectedX, bottomImgY], centroidDetected: r.centroid,
      });
    }
  }

  const left: DetectedDashes["left"] = [];
  for (const gby of DASH_INTERIOR_LEFT_Y) {
    const expectedY = toImg(gby);
    const r = findDarkCentroid2D(gray2, leftImgX, expectedY, shortHalf, longHalf, scale, -1, grayRaw);
    if (r === null || r.outerEdge === null) {
      left.push({
        expected: [leftOuterX, expectedY], detected: null,
        centroidExpected: [leftImgX, expectedY], centroidDetected: r?.centroid ?? null,
      });
    } else {
      left.push({
        expected: [leftOuterX, expectedY], detected: [r.outerEdge, r.centroid[1]],
        centroidExpected: [leftImgX, expectedY], centroidDetected: r.centroid,
      });
    }
  }

  const right: DetectedDashes["right"] = [];
  for (const gby of DASH_INTERIOR_RIGHT_Y) {
    const expectedY = toImg(gby);
    const r = findDarkCentroid2D(gray2, rightImgX, expectedY, shortHalf, longHalf, scale, +1, grayRaw);
    if (r === null || r.outerEdge === null) {
      right.push({
        expected: [rightOuterX, expectedY], detected: null,
        centroidExpected: [rightImgX, expectedY], centroidDetected: r?.centroid ?? null,
      });
    } else {
      right.push({
        expected: [rightOuterX, expectedY], detected: [r.outerEdge, r.centroid[1]],
        centroidExpected: [rightImgX, expectedY], centroidDetected: r.centroid,
      });
    }
  }

  gray2.delete();
  grayRaw.delete();
  return { top, bottom, left, right };
}

function findDarkCentroid2D(
  gray: any,
  expectedX: number,
  expectedY: number,
  xHalf: number,
  yHalf: number,
  scale: number,
  outerSide: -1 | 0 | 1 = 0,
  rawGray: any = null,
): { centroid: [number, number]; outerEdge: number | null } | null {
  const xLo = Math.max(0, Math.floor(expectedX - xHalf));
  const xHi = Math.min(gray.cols, Math.ceil(expectedX + xHalf) + 1);
  const yLo = Math.max(0, Math.floor(expectedY - yHalf));
  const yHi = Math.min(gray.rows, Math.ceil(expectedY + yHalf) + 1);
  if (xLo >= xHi || yLo >= yHi) return null;
  const W = xHi - xLo;
  const H = yHi - yLo;

  const rowSum = new Float64Array(H);
  const colSum = new Float64Array(W);
  const rowSumRaw = rawGray ? new Float64Array(H) : null;
  const colSumRaw = rawGray ? new Float64Array(W) : null;
  let minVal = 255;
  let maxVal = 0;
  for (let y = yLo; y < yHi; y++) {
    const ry = y - yLo;
    for (let x = xLo; x < xHi; x++) {
      const v = gray.ucharAt(y, x);
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      rowSum[ry] += v;
      colSum[x - xLo] += v;
      if (rowSumRaw && colSumRaw) {
        const vr = rawGray.ucharAt(y, x);
        rowSumRaw[ry] += vr;
        colSumRaw[x - xLo] += vr;
      }
    }
  }
  if (maxVal - minVal < DASH_BK_MIN_CONTRAST) return null;
  const rowMean = new Float64Array(H);
  for (let i = 0; i < H; i++) rowMean[i] = rowSum[i] / W;
  const colMean = new Float64Array(W);
  for (let i = 0; i < W; i++) colMean[i] = colSum[i] / H;
  const rowMeanRaw = rowSumRaw ? new Float64Array(H) : null;
  const colMeanRaw = colSumRaw ? new Float64Array(W) : null;
  if (rowMeanRaw && rowSumRaw) {
    for (let i = 0; i < H; i++) rowMeanRaw[i] = rowSumRaw[i] / W;
  }
  if (colMeanRaw && colSumRaw) {
    for (let i = 0; i < W; i++) colMeanRaw[i] = colSumRaw[i] / H;
  }

  const boxSmoothInPlace = (arr: Float64Array, w: number) => {
    if (w <= 1) return;
    const odd = w % 2 === 0 ? w + 1 : w;
    const half = Math.floor(odd / 2);
    const tmp = arr.slice();
    for (let i = 0; i < arr.length; i++) {
      let s = 0;
      for (let k = -half; k <= half; k++) {
        let j = i + k;
        if (j < 0) j = -j;
        if (j >= arr.length) j = 2 * arr.length - 2 - j;
        if (j < 0) j = 0;
        if (j >= arr.length) j = arr.length - 1;
        s += tmp[j];
      }
      arr[i] = s / odd;
    }
  };

  const gauss1d = (arr: Float64Array, sigma: number): Float64Array => {
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const k = new Float64Array(2 * radius + 1);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      k[i + radius] = v; sum += v;
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      let s = 0;
      for (let j = -radius; j <= radius; j++) {
        const idx = Math.max(0, Math.min(arr.length - 1, i + j));
        s += arr[idx] * k[j + radius];
      }
      out[i] = s;
    }
    return out;
  };

  boxSmoothInPlace(rowMean, scale);
  boxSmoothInPlace(colMean, scale);
  const isVerticalForSmoothing = yHalf >= xHalf;
  const shortProfileForOuterEdgeSrc = isVerticalForSmoothing
    ? (colMeanRaw ?? colMean).slice()
    : (rowMeanRaw ?? rowMean).slice();
  boxSmoothInPlace(shortProfileForOuterEdgeSrc, scale);
  const shortProfileForOuterEdge = gauss1d(shortProfileForOuterEdgeSrc, 1.0);

  if (yHalf >= xHalf) {
    boxSmoothInPlace(colMean, scale);
  } else {
    boxSmoothInPlace(rowMean, scale);
  }

  const LONG_AXIS_GAP_TOL = Math.max(1, Math.floor(scale / 2));
  const SHORT_AXIS_GAP_TOL = Math.max(1, Math.floor(scale / 4));

  const largestRun = (
    profile: Float64Array,
    gapTol: number,
    threshFrac: number,
  ): [number, number] | null => {
    let pMin = Infinity;
    let pMax = -Infinity;
    for (const v of profile) {
      if (v < pMin) pMin = v;
      if (v > pMax) pMax = v;
    }
    if (pMax - pMin < DASH_BK_MIN_CONTRAST) return null;
    const threshold = pMin + (pMax - pMin) * threshFrac;
    let bestLen = 0;
    let bestRun: [number, number] | null = null;
    let curStart = -1;
    let curEnd = -1;
    let aboveCount = 0;
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] < threshold) {
        if (curStart < 0) curStart = i;
        curEnd = i;
        aboveCount = 0;
        const len = curEnd - curStart + 1;
        if (len > bestLen) {
          bestLen = len;
          bestRun = [curStart, curEnd];
        }
      } else {
        aboveCount++;
        if (aboveCount > gapTol) {
          curStart = -1;
          curEnd = -1;
          aboveCount = 0;
        }
      }
    }
    return bestRun;
  };

  const argminAround = (
    profile: Float64Array,
    canonicalIdx: number,
  ): number | null => {
    if (profile.length === 0) return null;
    const lo = Math.max(0, Math.floor(canonicalIdx - 2 * scale));
    const hi = Math.min(profile.length - 1, Math.ceil(canonicalIdx + 2 * scale));
    if (lo > hi) return null;
    let mi = lo, mv = profile[lo];
    for (let i = lo + 1; i <= hi; i++) {
      if (profile[i] < mv) { mv = profile[i]; mi = i; }
    }
    let delta = 0;
    if (mi > 0 && mi < profile.length - 1) {
      const v0 = profile[mi - 1], v1 = profile[mi], v2 = profile[mi + 1];
      const den = v0 - 2 * v1 + v2;
      if (Math.abs(den) > 1e-10) {
        delta = Math.max(-1, Math.min(1, 0.5 * (v0 - v2) / den));
      }
    }
    return mi + delta;
  };

  const findOuterCrossing = (
    profile: Float64Array,
    centroidIdx: number,
    direction: -1 | 1,
  ): number | null => {
    const floorLo = Math.max(0, Math.floor(centroidIdx - scale / 2));
    const floorHi = Math.min(profile.length - 1, Math.ceil(centroidIdx + scale / 2));
    if (floorLo >= floorHi) return null;
    let floorIdx = floorLo, floorVal = profile[floorLo];
    for (let i = floorLo + 1; i <= floorHi; i++) {
      if (profile[i] < floorVal) { floorVal = profile[i]; floorIdx = i; }
    }
    const baselineIdx = Math.max(0, Math.min(
      profile.length - 1,
      Math.round(centroidIdx + direction * 1.5 * scale),
    ));
    const baselineVal = profile[baselineIdx];
    if (baselineVal - floorVal < 20) return null;
    const threshold = floorVal + 0.5 * (baselineVal - floorVal);
    let i = floorIdx;
    while (i + direction >= 0 && i + direction < profile.length) {
      const a = profile[i];
      const b = profile[i + direction];
      if (a < threshold && b >= threshold) {
        const t = (threshold - a) / (b - a);
        return i + direction * Math.max(0, Math.min(1, t));
      }
      i += direction;
    }
    return null;
  };

  const isVertical = yHalf >= xHalf;
  const rowFrac = isVertical ? DASH_BK_PROFILE_THRESH_FRAC_LONG : DASH_BK_PROFILE_THRESH_FRAC_SHORT;
  const colFrac = isVertical ? DASH_BK_PROFILE_THRESH_FRAC_SHORT : DASH_BK_PROFILE_THRESH_FRAC_LONG;
  const rowGap = isVertical ? LONG_AXIS_GAP_TOL : SHORT_AXIS_GAP_TOL;
  const colGap = isVertical ? SHORT_AXIS_GAP_TOL : LONG_AXIS_GAP_TOL;

  const expectedColIdx = expectedX - xLo;
  const expectedRowIdx = expectedY - yLo;

  let cx: number;
  let cy: number;
  let outerEdge: number | null = null;
  if (isVertical) {
    const rowRun = largestRun(rowMean, rowGap, rowFrac);
    if (!rowRun) return null;
    cy = yLo + (rowRun[0] + rowRun[1] + 1) / 2;
    const colRun = largestRun(colMean, colGap, colFrac);
    const colArgmin = argminAround(colMean, expectedColIdx);
    if (!colRun && colArgmin === null) return null;
    const colBboxCentre = colRun ? (colRun[0] + colRun[1] + 1) / 2 : null;
    const colArgminCentre = colArgmin !== null ? colArgmin + 0.5 : null;
    const colCombined = colBboxCentre !== null && colArgminCentre !== null
      ? (colBboxCentre + colArgminCentre) / 2
      : (colBboxCentre ?? colArgminCentre)!;
    cx = xLo + colCombined;
    if (outerSide !== 0) {
      const centroidColIdx = colCombined - 0.5;
      const cross = findOuterCrossing(shortProfileForOuterEdge, centroidColIdx, outerSide);
      if (cross !== null) outerEdge = xLo + cross;
    }
  } else {
    const colRun = largestRun(colMean, colGap, colFrac);
    if (!colRun) return null;
    cx = xLo + (colRun[0] + colRun[1] + 1) / 2;
    const rowRun = largestRun(rowMean, rowGap, rowFrac);
    const rowArgmin = argminAround(rowMean, expectedRowIdx);
    if (!rowRun && rowArgmin === null) return null;
    const rowBboxCentre = rowRun ? (rowRun[0] + rowRun[1] + 1) / 2 : null;
    const rowArgminCentre = rowArgmin !== null ? rowArgmin + 0.5 : null;
    const rowCombined = rowBboxCentre !== null && rowArgminCentre !== null
      ? (rowBboxCentre + rowArgminCentre) / 2
      : (rowBboxCentre ?? rowArgminCentre)!;
    cy = yLo + rowCombined;
    if (outerSide !== 0) {
      const centroidRowIdx = rowCombined - 0.5;
      const cross = findOuterCrossing(shortProfileForOuterEdge, centroidRowIdx, outerSide);
      if (cross !== null) outerEdge = yLo + cross;
    }
  }
  return { centroid: [cx, cy], outerEdge };
}
