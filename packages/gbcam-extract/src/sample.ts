import { type GBImageData, CAM_W, CAM_H, createGBImageData } from "./common.js";
import { type DebugCollector, jet, upscale } from "./debug.js";

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

/**
 * Detect the LCD pixel centre column within a GB-pixel block. Returns a value
 * in [0, scale). The default (well-aligned) centre is `scale/2 - 0.5` (the
 * centre between the two middle cols, matching the existing fixed sub-pixel
 * window centres).
 *
 * Method: column-mean grayscale profile over the block's central rows, then
 * intensity-weighted centroid (weight = max(0, value - mid_threshold)). Falls
 * back to the default centre when the profile is too flat (e.g., uniformly
 * dark BK blocks) or too noisy.
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
  // Use the G channel ONLY for centroid detection. The combined-channel
  // brightness profile is biased by sub-cell colour: DG (B=255 R=G=148)
  // is brightest at the B sub-cell (LEFT third of LCD pixel) → centroid
  // biased LEFT. LG (R=255 G=B=148) is brightest at R sub-cell (RIGHT
  // third) → centroid biased RIGHT. These per-colour biases can exceed
  // OFFSET_CLAMP (±2) in solid-colour regions, leaving the sub-cell
  // windows misaligned and feeding wrong-colour values into quantize.
  //
  // G channel: G=255 (WH) / G=148 (LG, DG) / G=0 (BK) at the G sub-cell
  // (MIDDLE third of LCD pixel), and ~0 at B/R sub-cells (since B/R
  // sub-cells don't emit G light). The G-channel bright spot sits at the
  // LCD pixel CENTRE regardless of pixel colour, so the centroid lands
  // at the true LCD centre and the offset map measures only the warp
  // alignment (not the pixel-colour-driven sub-cell brightness).
  for (let dx = 0; dx < scale; dx++) {
    let sum = 0;
    let n = 0;
    for (let y = yLo; y < yHi; y++) {
      const idx = (y * input.width + x0 + dx) * 4;
      sum += input.data[idx + 1]; // G channel only
      n++;
    }
    profile[dx] = sum / n;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < scale; i++) {
    if (profile[i] < lo) lo = profile[i];
    if (profile[i] > hi) hi = profile[i];
  }
  // Insufficient contrast — block is uniform (BK or the LCD gap is hidden).
  if (hi - lo < 30) return defaultCentre;
  const threshold = lo + (hi - lo) * 0.5;
  let sumW = 0;
  let sumWX = 0;
  for (let dx = 0; dx < scale; dx++) {
    const w = Math.max(0, profile[dx] - threshold);
    sumW += w;
    sumWX += w * dx;
  }
  if (sumW < 1) return defaultCentre;
  return sumWX / sumW;
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
  // Less aggressive vertical trim: drop only the 1-px inter-pixel gap rows
  // at top and bottom (rows 0 and scale-1) and use the full middle of each
  // block. Previous vMargin=2 dropped 4 of 8 rows, losing a lot of LCD
  // pixel signal — when the warp is sub-pixel accurate (= now, with the
  // wider TPS border detector), the extra rows are valid LCD-pixel-content
  // not noise.
  const vMargin = options?.marginV ?? 1;
  const dbg = options?.debug;

  const expectedW = CAM_W * scale;
  const expectedH = CAM_H * scale;
  if (input.width !== expectedW || input.height !== expectedH) {
    throw new Error(
      `Unexpected input size ${input.width}x${input.height}; ` +
        `expected ${expectedW}x${expectedH} (scale=${scale})`,
    );
  }

  // Sub-pixel windows: anchored to the *detected* LCD pixel centre per block,
  // not the GB block centre. This tolerates small warp-residual misalignment
  // that would otherwise drive the windows into LCD inter-pixel gaps.
  // Default windows when LCD centre is at scale/2 - 0.5: B=[1,3) G=[3,5) R=[5,7)
  // (matching the historical fixed layout). When the LCD centre shifts, the
  // windows shift with it, and any window edge that lands outside [0, scale)
  // is sourced from the adjacent block.
  const innerStart = 1;
  const innerEnd = scale - 1;
  const innerW = innerEnd - innerStart;
  const subWidth = Math.floor(innerW / 3); // typically 2 at scale=8
  const subRingFromCentre = Math.max(1, Math.floor(scale / 8)); // 1 at scale=8

  const output = createGBImageData(CAM_W, CAM_H);
  const rawOffsetMap = new Float32Array(CAM_W * CAM_H);
  const offsetMap = new Float32Array(CAM_W * CAM_H);

  // First pass: detect LCD centre offset per block.
  for (let by = 0; by < CAM_H; by++) {
    for (let bx = 0; bx < CAM_W; bx++) {
      const x0 = bx * scale;
      const pi = by * CAM_W + bx;
      if (innerW < 3) continue;
      const detected = detectLcdCentreCol(input, x0, by * scale, scale, vMargin);
      rawOffsetMap[pi] = detected - (scale / 2 - 0.5);
    }
  }

  // Smoothing: 5×5 median filter rejects per-block detection outliers
  // (e.g., dark blocks where the centroid lands randomly) and preserves
  // gradual regional variation. Then clamp to ±3 — at scale=8 the sub-cell
  // width is ~2.67 image-px, so an offset of ±3 still resolves to the
  // correct LCD pixel's sub-cells (just crossing one block boundary for R
  // or B, which sampleAt handles). ±4 would put R into the *next* LCD
  // pixel's B sub-cell, which is wrong, so 3 is the safe ceiling.
  const SMOOTH_RADIUS = 2;
  const OFFSET_CLAMP = 3;
  for (let by = 0; by < CAM_H; by++) {
    for (let bx = 0; bx < CAM_W; bx++) {
      const vals: number[] = [];
      const yLo = Math.max(0, by - SMOOTH_RADIUS);
      const yHi = Math.min(CAM_H, by + SMOOTH_RADIUS + 1);
      const xLo = Math.max(0, bx - SMOOTH_RADIUS);
      const xHi = Math.min(CAM_W, bx + SMOOTH_RADIUS + 1);
      for (let yy = yLo; yy < yHi; yy++) {
        for (let xx = xLo; xx < xHi; xx++) {
          vals.push(rawOffsetMap[yy * CAM_W + xx]);
        }
      }
      vals.sort((a, b) => a - b);
      const med = vals[Math.floor(vals.length / 2)];
      offsetMap[by * CAM_W + bx] = Math.max(-OFFSET_CLAMP, Math.min(OFFSET_CLAMP, med));
    }
  }

  // Second pass: sample with smoothed offsets.
  for (let by = 0; by < CAM_H; by++) {
    let y1 = by * scale + vMargin;
    let y2 = (by + 1) * scale - vMargin;
    if (y2 <= y1) {
      y1 = by * scale;
      y2 = (by + 1) * scale;
    }

    for (let bx = 0; bx < CAM_W; bx++) {
      const x0 = bx * scale;
      const pi = by * CAM_W + bx;
      const outIdx = pi * 4;

      if (innerW < 3) {
        const cy = by * scale + Math.floor(scale / 2);
        const cx = bx * scale + Math.floor(scale / 2);
        const v = input.data[(cy * input.width + cx) * 4];
        output.data[outIdx] = v;
        output.data[outIdx + 1] = v;
        output.data[outIdx + 2] = v;
        output.data[outIdx + 3] = 255;
        continue;
      }

      // Deadband: only shift the sampling window when the smoothed offset
      // is decisive (> 0.75). Sub-0.75 offsets are within sampling noise
      // and shifting them produces small per-pixel value changes that
      // accumulate into label flips on well-aligned images.
      const rawOff = offsetMap[pi];
      const offsetInt = Math.abs(rawOff) > 0.75 ? Math.round(rawOff) : 0;

      // Per-channel WHOLE-LCD-PIXEL averaging: read each channel across the
      // FULL LCD pixel area (cols [innerStart+offset, innerEnd+offset),
      // = 6 cols wide), not per-sub-cell windows. The previous per-sub-cell
      // approach (B from cols 1-2, G from 3-4, R from 5-6) assumed clean
      // sub-cell separation in the warp output, but the phone camera's
      // demosaicing + warp's Lanczos interpolation smear each LCD pixel's
      // sub-cell emissions so that any narrow per-sub-cell sample is biased
      // toward whichever sub-cell happens to be brightest. For LG (R=255,
      // G=148, B=148), the brightest sub-cell is R; the smearing inflates G
      // channel readings *near* the bright R sub-cell, and the per-sub-cell
      // G window (at cols 3-4 or shifted 5-6) reads G≈220-244 instead of
      // the canonical ~148, causing LG to misclassify as WH (the upper
      // blotch in 165926 / ~2-EDIT).
      //
      // Whole-pixel averaging integrates each channel's signal across the
      // ENTIRE LCD pixel, recovering the true emitted R/G/B intensity:
      //   LG (255, 148, 148) → R high, G mid, B mid ✓
      //   WH (255, 255, 165) → R high, G high, B mid ✓
      //   DG (148, 148, 255) → R mid, G mid, B high ✓
      //   BK (0, 0, 0)        → all dim ✓
      // and is robust to sub-cell smear / inter-sub-cell bleed because
      // any leak between sub-cells stays within the same averaged window.
      const wLo = innerStart + offsetInt;
      const wHi = innerEnd + offsetInt;

      const rVals: number[] = [];
      const gVals: number[] = [];
      const bVals: number[] = [];

      for (let dx = wLo; dx < wHi; dx++) {
        const px = x0 + dx;
        if (px < 0 || px >= input.width) continue;
        for (let y = y1; y < y2; y++) {
          const idx = (y * input.width + px) * 4;
          rVals.push(input.data[idx]);
          gVals.push(input.data[idx + 1]);
          bVals.push(input.data[idx + 2]);
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
    // Per-block sub-pixel offset distribution (smoothed + clamped)
    const offsetBuckets: Record<string, number> = {
      "≤-4": 0, "-3": 0, "-2": 0, "-1": 0, "0": 0, "+1": 0, "+2": 0, "+3": 0, "≥+4": 0,
    };
    let offMin = Infinity, offMax = -Infinity, offSum = 0;
    for (let i = 0; i < CAM_W * CAM_H; i++) {
      const o = offsetMap[i];
      if (o < offMin) offMin = o;
      if (o > offMax) offMax = o;
      offSum += o;
      const r = Math.round(o);
      const key = r <= -4 ? "≤-4" : r === -3 ? "-3" : r === -2 ? "-2" : r === -1 ? "-1" : r === 0 ? "0" : r === 1 ? "+1" : r === 2 ? "+2" : r === 3 ? "+3" : "≥+4";
      offsetBuckets[key]++;
    }
    const offMean = offSum / (CAM_W * CAM_H);
    dbg.log(
      `[sample] LCD centre offsets (clamped): mean=${offMean.toFixed(2)} ` +
        `range=[${offMin.toFixed(2)}, ${offMax.toFixed(2)}] ` +
        `dist=` + Object.entries(offsetBuckets).map(([k, v]) => `${k}:${v}`).join(" "),
    );
    // Raw (pre-smooth, pre-clamp) offset distribution — tells us if the
    // clamp is throwing away signal the warp residual could otherwise
    // expose. Use median per 5×5 window like the smoothed map, but skip
    // the clamp, to see what the warp residual actually looks like.
    const rawBuckets: Record<string, number> = {
      "≤-4": 0, "-3": 0, "-2": 0, "-1": 0, "0": 0, "+1": 0, "+2": 0, "+3": 0, "≥+4": 0,
    };
    let rawMin = Infinity, rawMax = -Infinity, rawSum = 0;
    for (let by = 0; by < CAM_H; by++) {
      for (let bx = 0; bx < CAM_W; bx++) {
        const vals: number[] = [];
        const yLo = Math.max(0, by - 2);
        const yHi = Math.min(CAM_H, by + 3);
        const xLo = Math.max(0, bx - 2);
        const xHi = Math.min(CAM_W, bx + 3);
        for (let yy = yLo; yy < yHi; yy++) {
          for (let xx = xLo; xx < xHi; xx++) {
            vals.push(rawOffsetMap[yy * CAM_W + xx]);
          }
        }
        vals.sort((a, b) => a - b);
        const med = vals[Math.floor(vals.length / 2)];
        if (med < rawMin) rawMin = med;
        if (med > rawMax) rawMax = med;
        rawSum += med;
        const r = Math.round(med);
        const key = r <= -4 ? "≤-4" : r === -3 ? "-3" : r === -2 ? "-2" : r === -1 ? "-1" : r === 0 ? "0" : r === 1 ? "+1" : r === 2 ? "+2" : r === 3 ? "+3" : "≥+4";
        rawBuckets[key]++;
      }
    }
    const rawMean = rawSum / (CAM_W * CAM_H);
    dbg.log(
      `[sample] LCD centre offsets (raw, pre-clamp): mean=${rawMean.toFixed(2)} ` +
        `range=[${rawMin.toFixed(2)}, ${rawMax.toFixed(2)}] ` +
        `dist=` + Object.entries(rawBuckets).map(([k, v]) => `${k}:${v}`).join(" "),
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
      lcdOffset: {
        mean: Number(offMean.toFixed(3)),
        min: Number(offMin.toFixed(3)),
        max: Number(offMax.toFixed(3)),
        distribution: offsetBuckets,
        rawMean: Number(rawMean.toFixed(3)),
        rawMin: Number(rawMin.toFixed(3)),
        rawMax: Number(rawMax.toFixed(3)),
        rawDistribution: rawBuckets,
      },
    });
    // 8x upscale for visual inspection
    dbg.addImage("sample_a_8x", upscale(output, 8));
    // Per-block offset heatmap (jet colormap, range -3..+3 cols).
    {
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
    }
  }

  return output;
}
