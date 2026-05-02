/**
 * quantize.ts — Map 128x112 colour samples to 4 GB Camera palette colours.
 *
 * After Phase A's white-balance step, the sample-step output is colour
 * neutral and B is a meaningful channel. Quantize clusters in 3D RGB
 * space using all four palette anchors:
 *   BK = (0, 0, 0)       LG = (255, 148, 148)
 *   DG = (148, 148, 255) WH = (255, 255, 165)
 *
 * The B axis disambiguates DG from the other three palette entries
 * (107-unit gap between DG.B and the rest), which RG-only quantize
 * couldn't see.
 *
 * Pipeline: sample (128x112 colour) → quantize → 128x112 grayscale (0/82/165/255)
 *
 * Steps:
 *   1. Global k-means (4 clusters in 3D RGB) with warm initialisation
 *   2. Strip k-means refinement for lateral gradient (also 3D)
 *   3. G-valley LG/WH refinement (1D on G among already-classified pixels)
 */

import {
  type GBImageData,
  GB_COLORS,
  CAM_W,
  CAM_H,
  createGBImageData,
} from "./common.js";
import { getCV, withMats } from "./opencv.js";
import {
  type DebugCollector,
  hstack,
  renderRGScatter,
  upscale,
} from "./debug.js";

export interface QuantizeOptions {
  debug?: DebugCollector;
}

// ─── Palette in RGB (matches Python COLOR_PALETTE_RGB) ───
const PALETTE_RGB: [number, number, number][] = [
  [0, 0, 0],         // BK
  [148, 148, 255],   // DG
  [255, 148, 148],   // LG
  [255, 255, 165],   // WH
];

// Warm initialisation centres for global k-means (3D RGB)
const INIT_CENTERS_RGB: [number, number, number][] = [
  [80, 20, 40],
  [148, 148, 255],
  [240, 148, 148],
  [250, 250, 165],
];

// ─── Helpers ───

/** Simple 1D Gaussian filter with reflected boundary. */
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
      if (j < 0) j = -j;
      if (j >= n) j = 2 * n - 2 - j;
      j = Math.max(0, Math.min(n - 1, j));
      val += input[j] * kernel[k];
    }
    output[i] = val;
  }
  return output;
}

/** Find all permutations of [0,1,2,3]. Used for cluster-to-palette matching. */
function permutations4(): number[][] {
  const result: number[][] = [];
  const arr = [0, 1, 2, 3];
  function permute(start: number) {
    if (start === arr.length) {
      result.push([...arr]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }
  permute(0);
  return result;
}

/**
 * Find the best permutation mapping clusters → palette indices that
 * minimises total Euclidean distance in `dim`-dimensional colour space.
 */
function bestClusterToPalette(
  centers: Float32Array,
  targets: number[][],
  dim: number,
): Int32Array {
  const perms = permutations4();
  let bestPerm: number[] = perms[0];
  let bestCost = Infinity;
  for (const perm of perms) {
    let cost = 0;
    for (let i = 0; i < 4; i++) {
      let d2 = 0;
      for (let k = 0; k < dim; k++) {
        const c = centers[i * dim + k];
        const t = targets[perm[i]][k];
        d2 += (c - t) * (c - t);
      }
      cost += Math.sqrt(d2);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestPerm = perm;
    }
  }
  return new Int32Array(bestPerm);
}

/**
 * Run cv.kmeans on an N×dim float32 sample set with warm initialisation.
 * Returns { labels: Int32Array(N), centers: Float32Array(4*dim) }.
 *
 * opencv.js's kmeans does not accept initial centres directly. We assign
 * initial labels by nearest-init-centre and pass KMEANS_USE_INITIAL_LABELS.
 */
function runKmeans(
  samples: Float32Array,
  n: number,
  dim: number,
  initCenters: number[][] | Float32Array,
): { labels: Int32Array; centers: Float32Array } {
  const cv = getCV();
  return withMats((track) => {
    const samplesMat = track(new cv.Mat(n, dim, cv.CV_32F));
    samplesMat.data32F.set(samples);

    const labelsMat = track(new cv.Mat(n, 1, cv.CV_32S));
    const centersMat = track(new cv.Mat(4, dim, cv.CV_32F));

    // Initial-label assignment: each sample to its nearest init centre.
    const ic = initCenters instanceof Float32Array ? initCenters : null;
    for (let i = 0; i < n; i++) {
      let bestK = 0;
      let bestD = Infinity;
      for (let k = 0; k < 4; k++) {
        let d2 = 0;
        for (let c = 0; c < dim; c++) {
          let cv2: number;
          if (ic) cv2 = ic[k * dim + c];
          else cv2 = (initCenters as number[][])[k][c];
          const dv = samples[i * dim + c] - cv2;
          d2 += dv * dv;
        }
        if (d2 < bestD) {
          bestD = d2;
          bestK = k;
        }
      }
      labelsMat.data32S[i] = bestK;
    }

    const criteria = new cv.TermCriteria(
      cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER,
      300,
      0.1,
    );

    cv.kmeans(
      samplesMat,
      4,
      labelsMat,
      criteria,
      1,
      cv.KMEANS_USE_INITIAL_LABELS,
      centersMat,
    );

    return {
      labels: new Int32Array(labelsMat.data32S),
      centers: new Float32Array(centersMat.data32F),
    };
  });
}

/**
 * G-valley threshold: find the G-axis valley between LG and WH clusters
 * among high-R pixels. Matches Python _g_valley_threshold.
 */
function gValleyThreshold(
  gVals: number[],
  lgCenterG: number,
  whCenterG: number,
): number {
  const SAFETY = 8;
  const midpoint = (lgCenterG + whCenterG) / 2.0;
  const span = whCenterG - lgCenterG;

  if (span < 2 * SAFETY + 4) return midpoint;

  const lo = Math.floor(lgCenterG) + 1;
  const hi = Math.floor(whCenterG);
  if (hi <= lo + 4) return midpoint;

  const nBins = hi - lo + 1;
  const hist = new Array<number>(nBins).fill(0);
  let total = 0;
  for (const g of gVals) {
    const bin = Math.floor(g) - lo;
    if (bin >= 0 && bin < nBins) {
      hist[bin]++;
      total++;
    }
  }
  if (total < 10) return midpoint;

  const smooth = gaussianFilter1d(hist, 3.0);

  const safeMinIdx = SAFETY;
  const safeMaxIdx = nBins - 1 - SAFETY;
  if (safeMaxIdx <= safeMinIdx) return midpoint;

  let valleyIdx = safeMinIdx;
  let minVal = smooth[safeMinIdx];
  for (let i = safeMinIdx + 1; i <= safeMaxIdx; i++) {
    if (smooth[i] < minVal) {
      minVal = smooth[i];
      valleyIdx = i;
    }
  }
  return lo + valleyIdx;
}

/**
 * Quantize a 128×112 colour sample image to 4 GB Camera palette values.
 */
export function quantize(input: GBImageData, options?: QuantizeOptions): GBImageData {
  if (input.width !== CAM_W || input.height !== CAM_H) {
    throw new Error(
      `Expected ${CAM_W}x${CAM_H}, got ${input.width}x${input.height}`,
    );
  }

  const N = CAM_W * CAM_H;
  const DIM = 3;
  const dbg = options?.debug;

  // Extract RGB triples (N×3 float32)
  const flatRGB = new Float32Array(N * DIM);
  for (let i = 0; i < N; i++) {
    flatRGB[i * DIM] = input.data[i * 4];     // R
    flatRGB[i * DIM + 1] = input.data[i * 4 + 1]; // G
    flatRGB[i * DIM + 2] = input.data[i * 4 + 2]; // B
  }

  // ── 1. Global k-means in 3D RGB ──
  const global = runKmeans(flatRGB, N, DIM, INIT_CENTERS_RGB);
  const clusterToPalette = bestClusterToPalette(global.centers, PALETTE_RGB, DIM);

  // Map cluster labels to palette indices
  const labelsFlat = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    labelsFlat[i] = clusterToPalette[global.labels[i]];
  }

  // Capture global k-means metrics — palette-ordered cluster centres
  const paletteCenters: Array<[number, number, number]> = new Array(4);
  for (let pi = 0; pi < 4; pi++) {
    let cr = PALETTE_RGB[pi][0];
    let cg = PALETTE_RGB[pi][1];
    let cb = PALETTE_RGB[pi][2];
    for (let ci = 0; ci < 4; ci++) {
      if (clusterToPalette[ci] === pi) {
        cr = global.centers[ci * DIM];
        cg = global.centers[ci * DIM + 1];
        cb = global.centers[ci * DIM + 2];
        break;
      }
    }
    paletteCenters[pi] = [cr, cg, cb];
  }
  const globalCounts = countLabels(labelsFlat);

  if (dbg) {
    dbg.log(
      `[quantize] global k-means cluster centers (palette-ordered):  ` +
        ["BK", "DG", "LG", "WH"]
          .map(
            (n, i) =>
              `${n}=(R${paletteCenters[i][0].toFixed(0)},G${paletteCenters[i][1].toFixed(0)},B${paletteCenters[i][2].toFixed(0)})`,
          )
          .join("  "),
    );
    dbg.log(
      `[quantize] after global kmeans: ` +
        ["BK", "DG", "LG", "WH"]
          .map((n, i) => `${n}=${globalCounts[i]}`)
          .join("  "),
    );

    // Drift diagnostic — 3D distance from target.
    const DRIFT_THRESHOLD = 40;
    const names = ["BK", "DG", "LG", "WH"];
    const drifts: string[] = [];
    for (let pi = 0; pi < 4; pi++) {
      const dr = paletteCenters[pi][0] - PALETTE_RGB[pi][0];
      const dg = paletteCenters[pi][1] - PALETTE_RGB[pi][1];
      const db = paletteCenters[pi][2] - PALETTE_RGB[pi][2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist > DRIFT_THRESHOLD) {
        drifts.push(`${names[pi]} drifted ${dist.toFixed(0)} RGB-units`);
      }
    }
    if (drifts.length > 0) {
      dbg.log(`[quantize] WARN cluster drift: ${drifts.join("; ")}`);
    }
  }

  // Build palette-ordered global centres (4 × DIM)
  const globalCentersPO = new Float32Array(4 * DIM);
  for (let pi = 0; pi < 4; pi++) {
    let found = false;
    for (let ci = 0; ci < 4; ci++) {
      if (clusterToPalette[ci] === pi) {
        for (let c = 0; c < DIM; c++) {
          globalCentersPO[pi * DIM + c] = global.centers[ci * DIM + c];
        }
        found = true;
        break;
      }
    }
    if (!found) {
      for (let c = 0; c < DIM; c++) {
        globalCentersPO[pi * DIM + c] = PALETTE_RGB[pi][c];
      }
    }
  }

  // ── 2. Strip k-means refinement (3D) ──
  const stripWidth = 32;
  const step = 16;
  const nStrips = Math.floor((CAM_W - stripWidth) / step) + 1;

  const stripLabels = new Int8Array(CAM_H * CAM_W * nStrips).fill(-1);
  const stripCentersCol = new Float64Array(nStrips);

  for (let s = 0; s < nStrips; s++) {
    const colStart = s * step;
    const colEnd = Math.min(colStart + stripWidth, CAM_W);
    const sw = colEnd - colStart;
    const sN = CAM_H * sw;

    const stripRGB = new Float32Array(sN * DIM);
    let idx = 0;
    for (let y = 0; y < CAM_H; y++) {
      for (let x = colStart; x < colEnd; x++) {
        const pi = y * CAM_W + x;
        for (let c = 0; c < DIM; c++) {
          stripRGB[idx * DIM + c] = flatRGB[pi * DIM + c];
        }
        idx++;
      }
    }

    const stripResult = runKmeans(stripRGB, sN, DIM, globalCentersPO);
    const c2p = bestClusterToPalette(stripResult.centers, PALETTE_RGB, DIM);

    idx = 0;
    for (let y = 0; y < CAM_H; y++) {
      for (let x = colStart; x < colEnd; x++) {
        const palLabel = c2p[stripResult.labels[idx]];
        stripLabels[(y * CAM_W + x) * nStrips + s] = palLabel;
        idx++;
      }
    }
    stripCentersCol[s] = (colStart + colEnd) / 2.0;
  }

  // Apply strip consensus: override global label when ALL covering strips agree
  const labels2d = new Int32Array(labelsFlat);
  const finalLabels = new Int32Array(labelsFlat);
  let stripChanged = 0;

  for (let x = 0; x < CAM_W; x++) {
    const coveringStrips: number[] = [];
    for (let s = 0; s < nStrips; s++) {
      const cs = s * step;
      const ce = Math.min(cs + stripWidth, CAM_W);
      if (cs <= x && x < ce && stripLabels[x * nStrips + s] >= 0) {
        coveringStrips.push(s);
      }
    }
    if (coveringStrips.length === 0) continue;

    let bestStrip = coveringStrips[0];
    let bestDist = Math.abs(stripCentersCol[bestStrip] - x);
    for (let i = 1; i < coveringStrips.length; i++) {
      const d = Math.abs(stripCentersCol[coveringStrips[i]] - x);
      if (d < bestDist) {
        bestDist = d;
        bestStrip = coveringStrips[i];
      }
    }

    for (let y = 0; y < CAM_H; y++) {
      const pi = y * CAM_W + x;
      const globalL = labels2d[pi];
      const stripL = stripLabels[pi * nStrips + bestStrip];

      if (stripL !== globalL) {
        let anyAgree = false;
        for (const s of coveringStrips) {
          if (stripLabels[pi * nStrips + s] === globalL) {
            anyAgree = true;
            break;
          }
        }
        if (!anyAgree) {
          finalLabels[pi] = stripL;
          stripChanged++;
        }
      }
    }
  }

  const stripCounts = countLabels(finalLabels);
  if (dbg) {
    dbg.log(
      `[quantize] strip ensemble: ${nStrips} strips, changed ${stripChanged} px  ` +
        `now: ${["BK", "DG", "LG", "WH"]
          .map((n, i) => `${n}=${stripCounts[i]}`)
          .join("  ")}`,
    );
  }

  // ── 3. G-valley LG/WH refinement (1D on G among R>190 LG/WH pixels) ──
  let lgClusterIdx = -1;
  let whClusterIdx = -1;
  for (let ci = 0; ci < 4; ci++) {
    if (clusterToPalette[ci] === 2) lgClusterIdx = ci;
    if (clusterToPalette[ci] === 3) whClusterIdx = ci;
  }

  let valleyThreshold: number | null = null;
  let valleyChanged = 0;
  if (lgClusterIdx >= 0 && whClusterIdx >= 0) {
    const lgCG = global.centers[lgClusterIdx * DIM + 1];
    const whCG = global.centers[whClusterIdx * DIM + 1];

    const gHighR: number[] = [];
    for (let i = 0; i < N; i++) {
      if (flatRGB[i * DIM] > 190) {
        gHighR.push(flatRGB[i * DIM + 1]);
      }
    }

    const gThresh = gValleyThreshold(gHighR, lgCG, whCG);
    valleyThreshold = gThresh;

    for (let i = 0; i < N; i++) {
      if (
        flatRGB[i * DIM] > 190 &&
        (finalLabels[i] === 2 || finalLabels[i] === 3)
      ) {
        const newLabel = flatRGB[i * DIM + 1] >= gThresh ? 3 : 2;
        if (newLabel !== finalLabels[i]) {
          valleyChanged++;
          finalLabels[i] = newLabel;
        }
      }
    }
    if (dbg) {
      dbg.log(
        `[quantize] G-valley refinement: threshold=${gThresh.toFixed(1)} ` +
          `(LG center G=${lgCG.toFixed(1)}, WH center G=${whCG.toFixed(1)}), ` +
          `changed ${valleyChanged} px`,
      );
    }
  }

  // ── 4. Output ──
  const output = createGBImageData(CAM_W, CAM_H);
  for (let i = 0; i < N; i++) {
    const v = GB_COLORS[finalLabels[i]];
    const j = i * 4;
    output.data[j] = v;
    output.data[j + 1] = v;
    output.data[j + 2] = v;
    output.data[j + 3] = 255;
  }

  if (dbg) {
    const finalCounts = countLabels(finalLabels);
    const total = N;
    dbg.log(
      `[quantize] final: ` +
        ["BK", "DG", "LG", "WH"]
          .map(
            (n, i) =>
              `${n}=${finalCounts[i]} (${((100 * finalCounts[i]) / total).toFixed(1)}%)`,
          )
          .join("  "),
    );

    dbg.setMetrics("quantize", {
      clusterCenters: paletteCenters.map(([r, g, b]) => [
        Number(r.toFixed(2)),
        Number(g.toFixed(2)),
        Number(b.toFixed(2)),
      ]),
      stripEnsemble: { strips: nStrips, changed: stripChanged },
      valleyRefinement: {
        threshold: valleyThreshold === null ? null : Number(valleyThreshold.toFixed(2)),
        changed: valleyChanged,
      },
      counts: {
        afterGlobalKmeans: { BK: globalCounts[0], DG: globalCounts[1], LG: globalCounts[2], WH: globalCounts[3] },
        afterStripEnsemble: { BK: stripCounts[0], DG: stripCounts[1], LG: stripCounts[2], WH: stripCounts[3] },
        final: { BK: finalCounts[0], DG: finalCounts[1], LG: finalCounts[2], WH: finalCounts[3] },
      },
    });

    // Visual: 8x grayscale and 8x palette-rendered
    dbg.addImage("quantize_a_gray_8x", upscale(output, 8));

    const rgbOut = createGBImageData(CAM_W, CAM_H);
    for (let i = 0; i < N; i++) {
      const c = PALETTE_RGB[finalLabels[i]];
      const j = i * 4;
      rgbOut.data[j] = c[0];
      rgbOut.data[j + 1] = c[1];
      rgbOut.data[j + 2] = c[2];
      rgbOut.data[j + 3] = 255;
    }
    dbg.addImage("quantize_b_rgb_8x", upscale(rgbOut, 8));

    // 3-projection scatter: RG | RB | GB
    const aChan = new Array<number>(N);
    const bChan = new Array<number>(N);
    const pointColors = new Array<[number, number, number]>(N);
    for (let i = 0; i < N; i++) pointColors[i] = PALETTE_RGB[finalLabels[i]];

    const buildScatter = (
      xKey: 0 | 1 | 2,
      yKey: 0 | 1 | 2,
    ): GBImageData => {
      for (let i = 0; i < N; i++) {
        aChan[i] = flatRGB[i * DIM + xKey];
        bChan[i] = flatRGB[i * DIM + yKey];
      }
      const markers = [
        ...paletteCenters.map((c) => ({
          r: c[xKey],
          g: c[yKey],
          color: [255, 255, 255] as [number, number, number],
          size: 5,
          symbol: "cross" as const,
        })),
        ...PALETTE_RGB.map((t) => ({
          r: t[xKey],
          g: t[yKey],
          color: [255, 255, 0] as [number, number, number],
          size: 7,
          symbol: "ring" as const,
        })),
      ];
      return renderRGScatter(aChan, bChan, pointColors, markers);
    };

    const rgScatter = buildScatter(0, 1);
    const rbScatter = buildScatter(0, 2);
    const gbScatter = buildScatter(1, 2);
    dbg.addImage(
      "quantize_c_rgb_projections",
      hstack(hstack(rgScatter, rbScatter), gbScatter),
    );
  }

  return output;
}

/** Count occurrences of palette indices 0..3 in a label array. */
function countLabels(labels: Int32Array | Uint8Array): [number, number, number, number] {
  const c: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i];
    if (v >= 0 && v < 4) c[v]++;
  }
  return c;
}

// Test-only export so unit tests can exercise gValleyThreshold directly
// without running full quantize. Do not use from production code.
export const gValleyThresholdForTest = gValleyThreshold;
