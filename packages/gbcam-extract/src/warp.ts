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

// ─── Public interface ───

export interface WarpOptions {
  scale?: number;
  threshold?: number;
}

export function warp(input: GBImageData, options?: WarpOptions): GBImageData {
  const scale = options?.scale ?? 8;
  const threshVal = options?.threshold ?? 180;

  const cv = getCV();

  // Convert input to BGR Mat (opencv.js convention)
  // We manage Mat lifetimes manually here because of the iterative refinement loop
  const src = imageDataToMat(input);
  const bgr = new cv.Mat();
  cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
  src.delete();

  // a — Detect screen corners
  const corners = findScreenCorners(bgr, threshVal);

  // b — Initial perspective warp
  let { warped: currentWarped, M: currentM } = initialWarp(bgr, corners, scale);

  // c — Refine (pass 1)
  {
    const { refined, M: M1 } = refineWarp(bgr, currentM, currentWarped, scale, 1);
    currentM.delete();
    currentWarped.delete();
    currentM = M1;
    currentWarped = refined;
  }

  // c — Refine (pass 2)
  {
    const { refined, M: M2 } = refineWarp(bgr, currentM, currentWarped, scale, 2);
    currentM.delete();
    currentWarped.delete();
    currentM = M2;
    currentWarped = refined;
  }

  bgr.delete();
  currentM.delete();

  // Convert back to RGBA ImageData
  const rgba = new cv.Mat();
  cv.cvtColor(currentWarped, rgba, cv.COLOR_BGR2RGBA);
  currentWarped.delete();
  const result = matToImageData(rgba);
  rgba.delete();

  return result;
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

function findScreenCorners(bgr: any, threshVal: number): Corners {
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

    return best.ordered;
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

function refineWarp(
  img: any,
  currentM: any,
  warped: any,
  scale: number,
  _passNum: number,
): RefineResult {
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

    return { refined, M: Mnew };
  } catch {
    // Refinement failed — use current warp
    const Mcopy = currentM.clone();
    const warpedCopy = warped.clone();
    return { refined: warpedCopy, M: Mcopy };
  }
}
