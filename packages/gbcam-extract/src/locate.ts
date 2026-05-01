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
    let bestIdx = -1;
    let bestScore: ValidationScore | null = null;
    const allScores: ValidationScore[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const score = validateCandidate(work.mat, candidates[i]);
      allScores.push(score);
      if (!bestScore || score.totalScore > bestScore.totalScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (!bestScore || bestScore.totalScore < MIN_VALIDATION_SCORE) {
      const top = bestScore
        ? `top totalScore=${bestScore.totalScore.toFixed(3)} ` +
          `(innerBorder=${bestScore.innerBorderScore.toFixed(3)}, ` +
          `darkRing=${bestScore.darkRingScore.toFixed(3)})`
        : "no candidates";
      throw new Error(
        `[locate] No candidate passed Frame 02 validation. ${top}, ` +
          `min required = ${MIN_VALIDATION_SCORE}.`,
      );
    }

    if (dbg) {
      // Re-emit the candidates debug image with the chosen one in green.
      const workingRgba = matToImageData(work.mat);
      dbg.addImage("locate_b_candidates", drawCandidates(workingRgba, candidates, bestIdx));
      // Emit the chosen-candidate validation visualization.
      dbg.addImage(
        "locate_c_validation",
        renderValidationOverlay(work.mat, candidates[bestIdx], bestScore),
      );
      dbg.log(
        `[locate] chose candidate ${bestIdx}: ` +
          `totalScore=${bestScore.totalScore.toFixed(3)} ` +
          `(innerBorder=${bestScore.innerBorderScore.toFixed(3)}, ` +
          `darkRing=${bestScore.darkRingScore.toFixed(3)})`,
      );
      dbg.setMetrics("locate", {
        chosenCandidate: {
          score: candidates[bestIdx].score,
          area: candidates[bestIdx].area,
          // corners in original-image coords are written in Task 8
          validation: bestScore,
        },
        rejectedScores: allScores.map((s, i) => ({
          index: i,
          totalScore: s.totalScore,
          innerBorderScore: s.innerBorderScore,
          darkRingScore: s.darkRingScore,
        })).filter((_, i) => i !== bestIdx),
      });
    }

    const chosen = candidates[bestIdx];

    // ── 2d. Map back, expand, rotate, crop ──
    const workToOrig = 1 / work.scale;
    const screenCornersOrig = scaleCorners(chosen.corners, workToOrig);
    const expanded = expandRotatedRect(screenCornersOrig, MARGIN_RATIO);
    const clamped = clampCorners(expanded, input.width, input.height);

    // Detect pass-through: if every clamped corner equals its expanded
    // counterpart, no clamping happened and the margin was applied freely.
    // If they differ, the margin was clipped — likely an already-cropped input.
    const passThrough = expanded.some((p, i) => p[0] !== clamped[i][0] || p[1] !== clamped[i][1]);

    const output = extractRotatedRect(src, clamped);

    if (dbg) {
      dbg.addImage(
        "locate_d_output_region",
        drawOutputRegion(input, screenCornersOrig, clamped),
      );
      dbg.log(
        `[locate] output region: ${output.width}×${output.height} ` +
          `(margin=${(MARGIN_RATIO * 100).toFixed(1)}%, ` +
          `passThrough=${passThrough})`,
      );
      dbg.setMetrics("locate", {
        marginRatio: MARGIN_RATIO,
        outputCorners: clamped.map(([x, y]) => [Math.round(x), Math.round(y)]),
        outputSize: [output.width, output.height],
        passThrough,
        chosenCandidate: {
          score: chosen.score,
          area: chosen.area,
          corners: screenCornersOrig.map(([x, y]) => [Math.round(x), Math.round(y)]),
          validation: bestScore,
        },
      });
    }

    return output;
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

interface ValidationScore {
  /** Score 0–1 measuring how dark the expected inner-border ring is. */
  innerBorderScore: number;
  /** Score 0–1 measuring how dark the band immediately outside the candidate is. */
  darkRingScore: number;
  /** Composite total, 0–1 (higher = better). */
  totalScore: number;
}

/**
 * Validate a candidate by perspective-warping it to a normalized 160×144
 * image and scoring two Frame 02 features:
 *   - Inner-border ring: at the expected location of Frame 02's #9494FF
 *     inner border (inset 16 px from the outer edge), the ring should be
 *     darker than the surrounding white frame.
 *   - Surrounding dark ring: a band immediately outside the candidate (in
 *     working-resolution coords) should be darker than the candidate's
 *     interior — this is the GBA SP LCD-black under the front-light.
 *
 * Both signals are normalized to 0–1 and averaged into `totalScore`.
 */
function validateCandidate(
  workingRgba: any /* cv.Mat */,
  candidate: Candidate,
): ValidationScore {
  const cv = getCV();

  return withMats((track) => {
    // ── Inner-border ring: warp candidate to normalized 160×144 ──
    const N = 160; // normalized width
    const M = 144; // normalized height
    const srcPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      candidate.corners[0][0], candidate.corners[0][1],
      candidate.corners[1][0], candidate.corners[1][1],
      candidate.corners[2][0], candidate.corners[2][1],
      candidate.corners[3][0], candidate.corners[3][1],
    ]));
    const dstPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      N - 1, 0,
      N - 1, M - 1,
      0, M - 1,
    ]));
    const Mhom = track(cv.getPerspectiveTransform(srcPts, dstPts));
    const warped = track(new cv.Mat());
    cv.warpPerspective(workingRgba, warped, Mhom, new cv.Size(N, M), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

    const warpedGray = track(new cv.Mat());
    cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);

    // Inner-border ring sits at row/col 15 of the normalized frame
    // (16-px-thick frame, inner border at outer edge of the camera area).
    // We measure two means:
    //   meanFrame   — interior of the 16-px frame band (excluding the ring itself)
    //   meanRing    — the inner-border ring at row/col 15
    // Score = clamp((meanFrame - meanRing) / 80, 0, 1)
    //   80 is a reasonable expected contrast (white-frame ≈ 230, ring ≈ 100).
    const ringRow = 15;
    let meanFrame = 0, frameCnt = 0;
    let meanRing = 0, ringCnt = 0;
    const data = warpedGray.data; // Uint8Array, length N*M
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < N; x++) {
        const v = data[y * N + x];
        const inFrame =
          (y < 16 || y >= M - 16 || x < 16 || x >= N - 16) &&
          !(y === ringRow || y === M - 1 - ringRow || x === ringRow || x === N - 1 - ringRow);
        const onRing =
          (y === ringRow && x >= ringRow && x <= N - 1 - ringRow) ||
          (y === M - 1 - ringRow && x >= ringRow && x <= N - 1 - ringRow) ||
          (x === ringRow && y > ringRow && y < M - 1 - ringRow) ||
          (x === N - 1 - ringRow && y > ringRow && y < M - 1 - ringRow);
        if (inFrame) { meanFrame += v; frameCnt++; }
        if (onRing) { meanRing += v; ringCnt++; }
      }
    }
    meanFrame = frameCnt > 0 ? meanFrame / frameCnt : 0;
    meanRing = ringCnt > 0 ? meanRing / ringCnt : 0;
    const innerBorderScore = clamp((meanFrame - meanRing) / 80, 0, 1);

    // ── Surrounding dark ring: in working-resolution coords ──
    // Sample a band of width = ringWidth pixels just outside each edge of
    // the candidate's bounding box and compute its mean. Compare to the
    // candidate's overall interior mean.
    const ringWidth = Math.max(4, Math.round(Math.min(candidate.width, candidate.height) * 0.05));
    const bbox = boundingBoxOfCorners(candidate.corners, workingRgba.cols, workingRgba.rows);
    const interiorMean = meanGrayInBox(workingRgba, bbox, 0);
    const outsideMean = meanGrayInRingAround(workingRgba, bbox, ringWidth);
    // Expected: outsideMean << interiorMean. Score normalized to 0–1.
    const darkRingScore = clamp((interiorMean - outsideMean) / 100, 0, 1);

    const totalScore = (innerBorderScore + darkRingScore) / 2;
    return { innerBorderScore, darkRingScore, totalScore };
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface Bbox { x0: number; y0: number; x1: number; y1: number; }

function boundingBoxOfCorners(corners: Corners, imgW: number, imgH: number): Bbox {
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs))),
    y0: Math.max(0, Math.floor(Math.min(...ys))),
    x1: Math.min(imgW, Math.ceil(Math.max(...xs))),
    y1: Math.min(imgH, Math.ceil(Math.max(...ys))),
  };
}

function meanGrayInBox(rgba: any /* cv.Mat */, b: Bbox, channel: number): number {
  const cv = getCV();
  return withMats((track) => {
    const gray = track(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    let sum = 0, cnt = 0;
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        sum += gray.data[y * gray.cols + x];
        cnt++;
      }
    }
    void channel; // retained for future per-channel scoring; unused for now.
    return cnt > 0 ? sum / cnt : 0;
  });
}

function meanGrayInRingAround(rgba: any /* cv.Mat */, b: Bbox, ringWidth: number): number {
  const cv = getCV();
  return withMats((track) => {
    const gray = track(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    let sum = 0, cnt = 0;
    const W = gray.cols;
    const H = gray.rows;
    const xa = Math.max(0, b.x0 - ringWidth);
    const xb = Math.min(W, b.x1 + ringWidth);
    const ya = Math.max(0, b.y0 - ringWidth);
    const yb = Math.min(H, b.y1 + ringWidth);
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const inInner = (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
        if (inInner) continue;
        sum += gray.data[y * W + x];
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : 0;
  });
}

/**
 * Render an 8x-upscaled normalized-160×144 view of the chosen candidate
 * with overlays showing the inner-border ring (red) and an annotation of
 * the score values (drawn as colored squares — top-left red square's
 * brightness encodes innerBorderScore, top-right encodes darkRingScore).
 *
 * The visualization is intentionally minimal — clusters of pixels with
 * known meaning rather than text — so we don't pull in font rendering.
 */
function renderValidationOverlay(
  workingMat: any /* cv.Mat */,
  candidate: Candidate,
  score: ValidationScore,
): GBImageData {
  const cv = getCV();
  const N = 160, M = 144, UPSCALE = 8;
  return withMats((track) => {
    const srcPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      candidate.corners[0][0], candidate.corners[0][1],
      candidate.corners[1][0], candidate.corners[1][1],
      candidate.corners[2][0], candidate.corners[2][1],
      candidate.corners[3][0], candidate.corners[3][1],
    ]));
    const dstPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, N - 1, 0, N - 1, M - 1, 0, M - 1,
    ]));
    const Mhom = track(cv.getPerspectiveTransform(srcPts, dstPts));
    const warped = track(new cv.Mat());
    cv.warpPerspective(workingMat, warped, Mhom, new cv.Size(N, M), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

    const upscaled = track(new cv.Mat());
    cv.resize(warped, upscaled, new cv.Size(N * UPSCALE, M * UPSCALE), 0, 0, cv.INTER_NEAREST);

    const out = matToImageData(upscaled);

    // Overlay the inner-border ring at row/col 15 in normalized space — i.e.
    // row/col 15*UPSCALE in upscaled space — as a red rectangle outline.
    const ringPx = 15 * UPSCALE;
    const ringPts: Point[] = [
      [ringPx, ringPx],
      [(N - 1 - 15) * UPSCALE, ringPx],
      [(N - 1 - 15) * UPSCALE, (M - 1 - 15) * UPSCALE],
      [ringPx, (M - 1 - 15) * UPSCALE],
    ];
    drawPolylineRGBA(out, ringPts, [255, 0, 0], 2, true);

    // Score annotations: two filled squares in the top-left corner whose
    // brightness encodes the two component scores.
    const sq = 12 * UPSCALE;
    fillRectRGBA(out, 4, 4, sq, sq, [
      Math.round(255 * score.innerBorderScore),
      0,
      0,
    ]);
    fillRectRGBA(out, 4 + sq + 4, 4, sq, sq, [
      0,
      Math.round(255 * score.darkRingScore),
      0,
    ]);

    return out;
  });
}

function fillRectRGBA(
  img: GBImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      const idx = (yy * img.width + xx) * 4;
      img.data[idx] = color[0];
      img.data[idx + 1] = color[1];
      img.data[idx + 2] = color[2];
      img.data[idx + 3] = 255;
    }
  }
}

/**
 * Scale a corner array from working-resolution coords to original-image
 * coords. `workToOrig` = 1 / `scale` from `downsampleToWorking`.
 */
function scaleCorners(corners: Corners, workToOrig: number): Corners {
  return corners.map(([x, y]) => [x * workToOrig, y * workToOrig] as Point) as Corners;
}

/**
 * Expand a (possibly rotated) rectangle outward by a fraction of its
 * longest side. The expansion is along the rectangle's own axes — the
 * rectangle stays the same shape, just bigger. Corners are returned in
 * the same TL/TR/BR/BL order.
 */
function expandRotatedRect(corners: Corners, ratio: number): Corners {
  const [TL, TR, BR, BL] = corners;
  const cx = (TL[0] + TR[0] + BR[0] + BL[0]) / 4;
  const cy = (TL[1] + TR[1] + BR[1] + BL[1]) / 4;
  const expand = (p: Point): Point => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return [cx + dx * (1 + ratio), cy + dy * (1 + ratio)];
  };
  return [expand(TL), expand(TR), expand(BR), expand(BL)];
}

/**
 * Clamp each corner to [0, imgW]×[0, imgH]. This keeps the warp from
 * sampling out-of-bounds; for already-cropped inputs the clamp is what
 * makes the step a near-no-op.
 */
function clampCorners(corners: Corners, imgW: number, imgH: number): Corners {
  return corners.map(([x, y]) => [
    clamp(x, 0, imgW - 1),
    clamp(y, 0, imgH - 1),
  ] as Point) as Corners;
}

/**
 * Extract the rotated rectangle defined by `corners` from `srcRgba`,
 * producing an axis-aligned RGBA image. Output dimensions equal the
 * average side lengths of the rectangle (rounded to integers).
 */
function extractRotatedRect(srcRgba: any /* cv.Mat */, corners: Corners): GBImageData {
  const cv = getCV();
  const [TL, TR, BR, BL] = corners;
  const topLen = Math.hypot(TR[0] - TL[0], TR[1] - TL[1]);
  const botLen = Math.hypot(BR[0] - BL[0], BR[1] - BL[1]);
  const leftLen = Math.hypot(BL[0] - TL[0], BL[1] - TL[1]);
  const rightLen = Math.hypot(BR[0] - TR[0], BR[1] - TR[1]);
  const outW = Math.max(1, Math.round((topLen + botLen) / 2));
  const outH = Math.max(1, Math.round((leftLen + rightLen) / 2));

  return withMats((track) => {
    const srcPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      TL[0], TL[1], TR[0], TR[1], BR[0], BR[1], BL[0], BL[1],
    ]));
    const dstPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, outW - 1, 0, outW - 1, outH - 1, 0, outH - 1,
    ]));
    const Mhom = track(cv.getPerspectiveTransform(srcPts, dstPts));
    const out = track(new cv.Mat());
    cv.warpPerspective(srcRgba, out, Mhom, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    return matToImageData(out);
  });
}

/**
 * Draw a polyline on a copy of `img` showing the final output region.
 * `screenCorners` are the chosen-screen corners (cyan); `outputCorners`
 * are the post-margin, post-clamp corners (green).
 */
function drawOutputRegion(
  img: GBImageData,
  screenCorners: Corners,
  outputCorners: Corners,
): GBImageData {
  const out = cloneImage(img);
  const thick = Math.max(2, Math.round(Math.min(img.width, img.height) / 400));
  drawPolylineRGBA(out, screenCorners, [0, 255, 255], thick, true); // cyan
  drawPolylineRGBA(out, outputCorners, [0, 255, 0], thick, true);   // green
  return out;
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
