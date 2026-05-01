import { type GBImageData, CAM_W, CAM_H, createGBImageData } from "./common.js";
import { type DebugCollector, upscale } from "./debug.js";

/**
 * Compute the trimmed mean: drop the lowest and highest fraction of values,
 * average the rest. Falls back to plain mean when fewer than 5 values.
 */
function trimmedMean(values: number[], trimFrac: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n < 5) {
    let s = 0;
    for (const v of values) s += v;
    return s / n;
  }
  values.sort((a, b) => a - b);
  const lo = Math.floor(n * trimFrac);
  const hi = n - lo;
  let s = 0;
  for (let i = lo; i < hi; i++) s += values[i];
  return s / (hi - lo);
}

export interface SampleOptions {
  scale?: number;
  method?: "mean" | "median"; // kept for API compat; internally always uses mean (matching Python)
  marginH?: number; // ignored; replaced by subpixel col offsets
  marginV?: number;
  debug?: DebugCollector;
}

/**
 * Sample step: reduce each (scale x scale) block to a single colour value.
 *
 * The GBA SP TN LCD has BGR sub-pixels (Blue left, Green middle, Red right).
 * Sampling each channel from its own column range avoids cross-channel
 * contamination and gives values that represent each sub-pixel's actual
 * colour intensity.
 *
 * Layout at scale=8 (inner_start=1, inner_end=7, inner_w=6):
 *   B: cols [1, 3)  — blue sub-pixel columns
 *   G: cols [3, 5)  — green sub-pixel columns
 *   R: cols [5, 7)  — red sub-pixel columns
 *
 * Output: 128×112 colour RGBA PNG (R/G/B channels carry real colour data).
 * The quantize step clusters in RG colour space and requires this.
 */
export function sample(
  input: GBImageData,
  options?: SampleOptions,
): GBImageData {
  const scale = options?.scale ?? 8;
  const vMargin = options?.marginV ?? Math.max(1, Math.floor(scale / 5));
  const dbg = options?.debug;

  const expectedW = CAM_W * scale;
  const expectedH = CAM_H * scale;
  if (input.width !== expectedW || input.height !== expectedH) {
    throw new Error(
      `Unexpected input size ${input.width}x${input.height}; ` +
        `expected ${expectedW}x${expectedH} (scale=${scale})`,
    );
  }

  // Subpixel column offsets
  const innerStart = 1;
  const innerEnd = scale - 1;
  const innerW = innerEnd - innerStart;

  const output = createGBImageData(CAM_W, CAM_H);

  for (let by = 0; by < CAM_H; by++) {
    let y1 = by * scale + vMargin;
    let y2 = (by + 1) * scale - vMargin;
    // Fallback if vMargin is too large
    if (y2 <= y1) {
      y1 = by * scale;
      y2 = (by + 1) * scale;
    }

    for (let bx = 0; bx < CAM_W; bx++) {
      const x0 = bx * scale;
      const pi = by * CAM_W + bx;
      const outIdx = pi * 4;

      if (innerW < 3) {
        // Scale too small for sub-pixel columns — fall back to center pixel R channel
        const cy = by * scale + Math.floor(scale / 2);
        const cx = bx * scale + Math.floor(scale / 2);
        const v = input.data[(cy * input.width + cx) * 4];
        output.data[outIdx] = v;
        output.data[outIdx + 1] = v;
        output.data[outIdx + 2] = v;
        output.data[outIdx + 3] = 255;
        continue;
      }

      const bLo = innerStart;
      const bHi = innerStart + Math.floor(innerW / 3);
      const gLo = innerStart + Math.floor(innerW / 3);
      const gHi = innerStart + 2 * Math.floor(innerW / 3);
      const rLo = innerStart + 2 * Math.floor(innerW / 3);
      const rHi = innerEnd;

      const rVals: number[] = [];
      const gVals: number[] = [];
      const bVals: number[] = [];

      for (let y = y1; y < y2; y++) {
        const rowBase = y * input.width;
        for (let dx = rLo; dx < rHi; dx++) {
          rVals.push(input.data[(rowBase + x0 + dx) * 4]);
        }
        for (let dx = gLo; dx < gHi; dx++) {
          gVals.push(input.data[(rowBase + x0 + dx) * 4 + 1]);
        }
        for (let dx = bLo; dx < bHi; dx++) {
          bVals.push(input.data[(rowBase + x0 + dx) * 4 + 2]);
        }
      }

      const TRIM = 0.2;
      output.data[outIdx] = Math.round(trimmedMean(rVals, TRIM));
      output.data[outIdx + 1] = Math.round(trimmedMean(gVals, TRIM));
      output.data[outIdx + 2] = Math.round(trimmedMean(bVals, TRIM));
      output.data[outIdx + 3] = 255;
    }
  }

  if (dbg) {
    // Compute per-channel min/max
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (let i = 0; i < CAM_W * CAM_H; i++) {
      const o = i * 4;
      const r = output.data[o];
      const g = output.data[o + 1];
      const b = output.data[o + 2];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    dbg.log(
      `[sample] R: ${rMin}–${rMax}  G: ${gMin}–${gMax}  B: ${bMin}–${bMax}`,
    );
    const innerStartLog = 1;
    const innerEndLog = scale - 1;
    const innerWLog = innerEndLog - innerStartLog;
    const bLoLog = innerStartLog;
    const bHiLog = innerStartLog + Math.floor(innerWLog / 3);
    const gLoLog = bHiLog;
    const gHiLog = innerStartLog + 2 * Math.floor(innerWLog / 3);
    const rLoLog = gHiLog;
    const rHiLog = innerEndLog;
    dbg.log(
      `[sample] subpixel cols (scale=${scale}): ` +
        `B=[${bLoLog},${bHiLog}) G=[${gLoLog},${gHiLog}) R=[${rLoLog},${rHiLog}) vMargin=${vMargin}`,
    );
    dbg.setMetrics("sample", {
      ranges: {
        R: [rMin, rMax],
        G: [gMin, gMax],
        B: [bMin, bMax],
      },
      subpixelCols: {
        B: [bLoLog, bHiLog],
        G: [gLoLog, gHiLog],
        R: [rLoLog, rHiLog],
      },
      vMargin,
    });
    // 8x upscale for visual inspection
    dbg.addImage("sample_a_8x", upscale(output, 8));
  }

  return output;
}
