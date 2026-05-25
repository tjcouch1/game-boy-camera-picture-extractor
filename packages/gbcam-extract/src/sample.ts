import { type GBImageData, CAM_W, CAM_H, createGBImageData } from "./common.js";
import { type DebugCollector, jet, upscale } from "./debug.js";

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

      let rSum = 0,
        gSum = 0,
        bSum = 0;
      let rCount = 0,
        gCount = 0,
        bCount = 0;

      for (let y = y1; y < y2; y++) {
        const rowBase = y * input.width;
        for (let dx = rLo; dx < rHi; dx++) {
          rSum += input.data[(rowBase + x0 + dx) * 4];
          rCount++;
        }
        for (let dx = gLo; dx < gHi; dx++) {
          gSum += input.data[(rowBase + x0 + dx) * 4 + 1];
          gCount++;
        }
        for (let dx = bLo; dx < bHi; dx++) {
          bSum += input.data[(rowBase + x0 + dx) * 4 + 2];
          bCount++;
        }
      }

      output.data[outIdx] = Math.round(rCount > 0 ? rSum / rCount : 0);
      output.data[outIdx + 1] = Math.round(gCount > 0 ? gSum / gCount : 0);
      output.data[outIdx + 2] = Math.round(bCount > 0 ? bSum / bCount : 0);
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

    // Per-block offset heatmap (jet colormap, range -3..+3 cols).
    {
      const offsetMap = new Float32Array(CAM_W * CAM_H);
      const rawOffsetMap = new Float32Array(CAM_W * CAM_H);
      for (let by = 0; by < CAM_H; by++) {
        for (let bx = 0; bx < CAM_W; bx++) {
          const x0 = bx * scale;
          const detected = detectLcdCentreCol(input, x0, by * scale, scale, vMargin);
          rawOffsetMap[by * CAM_W + bx] = detected - (scale / 2 - 0.5);
        }
      }
      // Median smoothing 5x5
      for (let by = 0; by < CAM_H; by++) {
        for (let bx = 0; bx < CAM_W; bx++) {
          const vals: number[] = [];
          for (let yy = Math.max(0, by - 2); yy < Math.min(CAM_H, by + 3); yy++) {
            for (let xx = Math.max(0, bx - 2); xx < Math.min(CAM_W, bx + 3); xx++) {
              vals.push(rawOffsetMap[yy * CAM_W + xx]);
            }
          }
          vals.sort((a, b) => a - b);
          offsetMap[by * CAM_W + bx] = vals[Math.floor(vals.length / 2)];
        }
      }

      const heat = createGBImageData(CAM_W * 4, CAM_H * 4);
      for (let by = 0; by < CAM_H; by++) {
        for (let bx = 0; bx < CAM_W; bx++) {
          const o = offsetMap[by * CAM_W + bx];
          const t = Math.max(0, Math.min(1, (o + 3) / 6));
          const [r, g, bl] = jet(t);
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const idx = ((by * 4 + dy) * heat.width + bx * 4 + dx) * 4;
              heat.data[idx] = r;
              heat.data[idx + 1] = g;
              heat.data[idx + 2] = bl;
              heat.data[idx + 3] = 255;
            }
          }
        }
      }
      dbg.addImage("sample_b_offset_heatmap", heat);

      // Update metrics with offset data
      let offSum = 0, offMin = Infinity, offMax = -Infinity;
      for (const o of offsetMap) {
        offSum += o;
        if (o < offMin) offMin = o;
        if (o > offMax) offMax = o;
      }
      dbg.setMetric("sample", "lcdOffset", {
        mean: Number((offSum / offsetMap.length).toFixed(3)),
        min: Number(offMin.toFixed(3)),
        max: Number(offMax.toFixed(3)),
      });
    }
  }

  return output;
}

/**
 * Detect the LCD pixel centre column within a GB-pixel block. Returns a value
 * in [0, scale). The default (well-aligned) centre is `scale/2 - 0.5`.
 *
 * G channel: G=255 (WH) / G=148 (LG, DG) / G=0 (BK) at the G sub-cell
 * (MIDDLE third of LCD pixel), and ~0 at B/R sub-cells. The G-channel bright
 * spot sits at the LCD pixel CENTRE regardless of pixel colour.
 */
function detectLcdCentreCol(
  input: GBImageData,
  x0: number,
  y0: number,
  scale: number,
  vMargin: number,
): number {
  const defaultCentre = scale / 2 - 0.5;
  const profile = new Float32Array(scale);
  const yLo = y0 + vMargin;
  const yHi = y0 + scale - vMargin;
  if (yHi <= yLo) return defaultCentre;
  for (let dx = 0; dx < scale; dx++) {
    let sum = 0, n = 0;
    for (let y = yLo; y < yHi; y++) {
      const idx = (y * input.width + x0 + dx) * 4;
      sum += input.data[idx + 1]; // G channel only
      n++;
    }
    profile[dx] = sum / n;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < scale; i++) {
    if (profile[i] < lo) lo = profile[i];
    if (profile[i] > hi) hi = profile[i];
  }
  if (hi - lo < 30) return defaultCentre;
  const threshold = lo + (hi - lo) * 0.5;
  let sumW = 0, sumWX = 0;
  for (let dx = 0; dx < scale; dx++) {
    const w = Math.max(0, profile[dx] - threshold);
    sumW += w;
    sumWX += w * dx;
  }
  return sumW < 1 ? defaultCentre : sumWX / sumW;
}
