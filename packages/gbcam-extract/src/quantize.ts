/**
 * quantize.ts — Map 128x112 colour samples to 4 GB Camera palette colors.
 *
 * Ported from gbcam_quantize.py. Uses k-means clustering in RG colour space
 * with strip refinement and G-valley correction.
 *
 * Pipeline: sample (128x112 colour) -> quantize -> 128x112 grayscale (0/82/165/255)
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
  renderRGScatter,
  upscale,
} from "./debug.js";

export interface QuantizeOptions {
  debug?: DebugCollector;
}

// ─── RGB palette matching the Python COLOR_PALETTE_RGB ───
// BK=(0,0,0), DG=(148,148,255), LG=(255,148,148), WH=(255,255,165)
const PALETTE_RG: [number, number][] = [
  [0, 0],
  [148, 148],
  [255, 148],
  [255, 255],
];

// Warm initialisation centres for global k-means (RG plane)
const INIT_CENTERS_RG: [number, number][] = [
  [80, 20],
  [148, 148],
  [240, 148],
  [250, 250],
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

/**
 * Find all permutations of [0,1,2,3]. Used for cluster-to-palette matching.
 */
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
 * Find the best permutation mapping clusters -> palette indices
 * that minimizes total RG Euclidean distance.
 */
function bestClusterToPalette(
  centersRG: Float32Array,
  targetsRG: [number, number][],
): Int32Array {
  const perms = permutations4();
  let bestPerm: number[] = perms[0];
  let bestCost = Infinity;
  for (const perm of perms) {
    let cost = 0;
    for (let i = 0; i < 4; i++) {
      const cr = centersRG[i * 2];
      const cg = centersRG[i * 2 + 1];
      const tr = targetsRG[perm[i]][0];
      const tg = targetsRG[perm[i]][1];
      cost += Math.sqrt((cr - tr) ** 2 + (cg - tg) ** 2);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestPerm = perm;
    }
  }
  return new Int32Array(bestPerm);
}

/**
 * Run cv.kmeans on an Nx2 float32 sample set with warm initialisation.
 * Returns { labels: Int32Array(N), centers: Float32Array(4*2) }
 */
function runKmeans(
  samplesRG: Float32Array,
  n: number,
  initCenters: [number, number][] | Float32Array,
): { labels: Int32Array; centers: Float32Array } {
  const cv = getCV();
  return withMats((track) => {
    // Build Nx2 samples Mat
    const samplesMat = track(new cv.Mat(n, 2, cv.CV_32F));
    samplesMat.data32F.set(samplesRG);

    // Build labels output
    const labelsMat = track(new cv.Mat(n, 1, cv.CV_32S));

    // Build centers output
    const centersMat = track(new cv.Mat(4, 2, cv.CV_32F));

    // Build initial centers for warm start
    const initMat = track(new cv.Mat(4, 2, cv.CV_32F));
    if (initCenters instanceof Float32Array) {
      initMat.data32F.set(initCenters);
    } else {
      for (let i = 0; i < 4; i++) {
        initMat.data32F[i * 2] = initCenters[i][0];
        initMat.data32F[i * 2 + 1] = initCenters[i][1];
      }
    }

    // Use warm start: set labels from initial centers via nearest assignment
    // then use KMEANS_USE_INITIAL_LABELS
    // Actually, opencv.js doesn't support initial centers directly.
    // We assign initial labels based on nearest init center, then use KMEANS_USE_INITIAL_LABELS.
    for (let i = 0; i < n; i++) {
      const r = samplesRG[i * 2];
      const g = samplesRG[i * 2 + 1];
      let bestK = 0;
      let bestD = Infinity;
      const ic = initCenters instanceof Float32Array ? initCenters : null;
      for (let k = 0; k < 4; k++) {
        let cr: number, cg: number;
        if (ic) {
          cr = ic[k * 2];
          cg = ic[k * 2 + 1];
        } else {
          cr = (initCenters as [number, number][])[k][0];
          cg = (initCenters as [number, number][])[k][1];
        }
        const d = (r - cr) ** 2 + (g - cg) ** 2;
        if (d < bestD) {
          bestD = d;
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
      1, // attempts=1 since we use initial labels
      cv.KMEANS_USE_INITIAL_LABELS,
      centersMat,
    );

    // Copy results out before mats are deleted
    const labels = new Int32Array(labelsMat.data32S);
    const centers = new Float32Array(centersMat.data32F);
    return { labels, centers };
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
  const SAFETY = 8; // never return a threshold within this many G-units of a center
  const midpoint = (lgCenterG + whCenterG) / 2.0;
  const span = whCenterG - lgCenterG;

  // If centers are too close together, no histogram search can help — use midpoint.
  if (span < 2 * SAFETY + 4) {
    return midpoint;
  }

  const lo = Math.floor(lgCenterG) + 1;
  const hi = Math.floor(whCenterG);
  if (hi <= lo + 4) {
    return midpoint;
  }

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

  if (total < 10) {
    return midpoint;
  }

  const smooth = gaussianFilter1d(hist, 3.0);

  // Search the safe interior only — never within SAFETY of either center.
  const safeMinIdx = SAFETY;
  const safeMaxIdx = nBins - 1 - SAFETY;

  if (safeMaxIdx <= safeMinIdx) {
    return midpoint;
  }

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
 * Quantize a 128x112 colour sample image to 4 GB Camera palette values.
 *
 * Uses k-means clustering in RG colour space with:
 * 1. Global k-means (4 clusters) with warm initialisation
 * 2. Strip k-means refinement for lateral gradient
 * 3. G-valley LG/WH refinement for pixel bleeding correction
 */
export function quantize(input: GBImageData, options?: QuantizeOptions): GBImageData {
  if (input.width !== CAM_W || input.height !== CAM_H) {
    throw new Error(
      `Expected ${CAM_W}x${CAM_H}, got ${input.width}x${input.height}`,
    );
  }

  const N = CAM_W * CAM_H;
  const targetsRG = PALETTE_RG;
  const dbg = options?.debug;

  // Extract RG values (Nx2 float32) and full RGB (Nx3)
  const flatRG = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    flatRG[i * 2] = input.data[i * 4]; // R
    flatRG[i * 2 + 1] = input.data[i * 4 + 1]; // G
  }

  // ── 1. Global k-means ──
  const global = runKmeans(flatRG, N, INIT_CENTERS_RG);
  const clusterToPalette = bestClusterToPalette(global.centers, targetsRG);

  // Map cluster labels to palette indices
  const labelsFlat = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    labelsFlat[i] = clusterToPalette[global.labels[i]];
  }

  // Capture global k-means metrics — palette-ordered cluster centers
  const paletteCenters = new Array<[number, number]>(4);
  for (let pi = 0; pi < 4; pi++) {
    let cr = targetsRG[pi][0];
    let cg = targetsRG[pi][1];
    for (let ci = 0; ci < 4; ci++) {
      if (clusterToPalette[ci] === pi) {
        cr = global.centers[ci * 2];
        cg = global.centers[ci * 2 + 1];
        break;
      }
    }
    paletteCenters[pi] = [cr, cg];
  }
  const globalCounts = countLabels(labelsFlat);

  if (dbg) {
    dbg.log(
      `[quantize] global k-means cluster centers (palette-ordered):  ` +
        ["BK", "DG", "LG", "WH"]
          .map(
            (n, i) =>
              `${n}=(R${paletteCenters[i][0].toFixed(0)},G${paletteCenters[i][1].toFixed(0)})`,
          )
          .join("  "),
    );
    dbg.log(
      `[quantize] after global kmeans: ` +
        ["BK", "DG", "LG", "WH"]
          .map((n, i) => `${n}=${globalCounts[i]}`)
          .join("  "),
    );
  }

  // Drift diagnostic: warn when any cluster center is far from its target.
  if (dbg) {
    const DRIFT_THRESHOLD = 40;
    const targets: [number, number][] = [
      [0, 0],
      [148, 148],
      [255, 148],
      [255, 255],
    ];
    const names = ["BK", "DG", "LG", "WH"];
    const drifts: string[] = [];
    for (let pi = 0; pi < 4; pi++) {
      const dr = paletteCenters[pi][0] - targets[pi][0];
      const dg = paletteCenters[pi][1] - targets[pi][1];
      const dist = Math.sqrt(dr * dr + dg * dg);
      if (dist > DRIFT_THRESHOLD) {
        drifts.push(`${names[pi]} drifted ${dist.toFixed(0)} RG-units`);
      }
    }
    if (drifts.length > 0) {
      dbg.log(`[quantize] WARN cluster drift: ${drifts.join("; ")}`);
    }
  }

  // Build global_centers_po (palette-ordered centers)
  const globalCentersPO = new Float32Array(4 * 2);
  for (let pi = 0; pi < 4; pi++) {
    let found = false;
    for (let ci = 0; ci < 4; ci++) {
      if (clusterToPalette[ci] === pi) {
        globalCentersPO[pi * 2] = global.centers[ci * 2];
        globalCentersPO[pi * 2 + 1] = global.centers[ci * 2 + 1];
        found = true;
        break;
      }
    }
    if (!found) {
      globalCentersPO[pi * 2] = targetsRG[pi][0];
      globalCentersPO[pi * 2 + 1] = targetsRG[pi][1];
    }
  }

  // ── 2. Strip k-means refinement ──
  const stripWidth = 32;
  const step = 16;
  const nStrips = Math.floor((CAM_W - stripWidth) / step) + 1;

  // strip_labels[y][x][s] — palette label from strip s
  // Use a flat array: index = (y * CAM_W + x) * nStrips + s
  const stripLabels = new Int8Array(CAM_H * CAM_W * nStrips).fill(-1);
  const stripCentersCol = new Float64Array(nStrips);

  for (let s = 0; s < nStrips; s++) {
    const colStart = s * step;
    const colEnd = Math.min(colStart + stripWidth, CAM_W);
    const sw = colEnd - colStart;
    const sN = CAM_H * sw;

    // Extract RG for this strip
    const stripRG = new Float32Array(sN * 2);
    let idx = 0;
    for (let y = 0; y < CAM_H; y++) {
      for (let x = colStart; x < colEnd; x++) {
        const pi = y * CAM_W + x;
        stripRG[idx * 2] = flatRG[pi * 2];
        stripRG[idx * 2 + 1] = flatRG[pi * 2 + 1];
        idx++;
      }
    }

    const stripResult = runKmeans(stripRG, sN, globalCentersPO);
    const c2p = bestClusterToPalette(stripResult.centers, targetsRG);

    // Map strip cluster labels to palette and store
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
  const labels2d = new Int32Array(labelsFlat); // copy
  const finalLabels = new Int32Array(labelsFlat);
  let stripChanged = 0;

  for (let x = 0; x < CAM_W; x++) {
    // Find covering strips for this column
    const coveringStrips: number[] = [];
    for (let s = 0; s < nStrips; s++) {
      const cs = s * step;
      const ce = Math.min(cs + stripWidth, CAM_W);
      if (cs <= x && x < ce && stripLabels[x * nStrips + s] >= 0) {
        coveringStrips.push(s);
      }
    }
    if (coveringStrips.length === 0) continue;

    // Find the best strip (closest center column to x)
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
        // Check if ANY covering strip agrees with global
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

  // ── 3. G-valley LG/WH refinement ──
  // Find cluster indices for LG (palette 2) and WH (palette 3)
  let lgClusterIdx = -1;
  let whClusterIdx = -1;
  for (let ci = 0; ci < 4; ci++) {
    if (clusterToPalette[ci] === 2) lgClusterIdx = ci;
    if (clusterToPalette[ci] === 3) whClusterIdx = ci;
  }

  let valleyThreshold: number | null = null;
  let valleyChanged = 0;
  if (lgClusterIdx >= 0 && whClusterIdx >= 0) {
    const lgCG = global.centers[lgClusterIdx * 2 + 1]; // G component of LG center
    const whCG = global.centers[whClusterIdx * 2 + 1]; // G component of WH center

    // Collect G values of high-R pixels (R > 190)
    const gHighR: number[] = [];
    for (let i = 0; i < N; i++) {
      if (flatRG[i * 2] > 190) {
        gHighR.push(flatRG[i * 2 + 1]);
      }
    }

    const gThresh = gValleyThreshold(gHighR, lgCG, whCG);
    valleyThreshold = gThresh;

    // Apply threshold to LG/WH pixels with high R
    for (let i = 0; i < N; i++) {
      if (
        flatRG[i * 2] > 190 &&
        (finalLabels[i] === 2 || finalLabels[i] === 3)
      ) {
        const newLabel = flatRG[i * 2 + 1] >= gThresh ? 3 : 2;
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

  // ── 4. Output: map palette indices to grayscale values ──
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
      clusterCenters: paletteCenters.map(([r, g]) => [
        Number(r.toFixed(2)),
        Number(g.toFixed(2)),
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
    const PALETTE_RGB: [number, number, number][] = [
      [0, 0, 0],
      [148, 148, 255],
      [255, 148, 148],
      [255, 255, 165],
    ];
    for (let i = 0; i < N; i++) {
      const c = PALETTE_RGB[finalLabels[i]];
      const j = i * 4;
      rgbOut.data[j] = c[0];
      rgbOut.data[j + 1] = c[1];
      rgbOut.data[j + 2] = c[2];
      rgbOut.data[j + 3] = 255;
    }
    dbg.addImage("quantize_b_rgb_8x", upscale(rgbOut, 8));

    // RG scatter: every input sample plotted by its final label, with cluster
    // centers (white crosses) and palette targets (yellow rings) overlaid.
    const rVals = new Array<number>(N);
    const gVals = new Array<number>(N);
    const pointColors = new Array<[number, number, number]>(N);
    for (let i = 0; i < N; i++) {
      rVals[i] = flatRG[i * 2];
      gVals[i] = flatRG[i * 2 + 1];
      pointColors[i] = PALETTE_RGB[finalLabels[i]];
    }
    const markers = [
      ...paletteCenters.map((c) => ({
        r: c[0],
        g: c[1],
        color: [255, 255, 255] as [number, number, number],
        size: 5,
        symbol: "cross" as const,
      })),
      ...targetsRG.map((t) => ({
        r: t[0],
        g: t[1],
        color: [255, 255, 0] as [number, number, number],
        size: 7,
        symbol: "ring" as const,
      })),
    ];
    dbg.addImage(
      "quantize_c_rg_scatter",
      renderRGScatter(rVals, gVals, pointColors, markers),
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
