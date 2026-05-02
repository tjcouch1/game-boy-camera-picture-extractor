/**
 * white-balance.ts — Pre-correct step that undoes the front-light's colour
 * cast.
 *
 * The GBA SP front-light isn't perfectly white. On most photos it has a
 * blue cast (frame B raw is ~230-250 vs target 165); on some photos
 * (e.g. 20260328_165926.jpg) it has a yellow cast (frame B raw ≈ 187,
 * R/G suppressed). The cast is multiplicative per channel, not additive,
 * so per-channel R/G affine surfaces in correct.ts can't recover it.
 *
 * This step measures the raw frame strip's median colour and computes
 * three per-channel scales that map it to the design target
 * (255, 255, 165). The scales are clamped to a safe range so a single
 * weird image (e.g. extreme blue tint or near-zero G) can't blow up.
 *
 * After this step, correct.ts sees colour-neutral input on which the
 * existing per-channel R/G affine surfaces fit narrower observed ranges
 * and the B passthrough is meaningful.
 */

import {
  type GBImageData,
  createGBImageData,
} from "./common.js";
import { type DebugCollector } from "./debug.js";
import { collectWhiteSamples } from "./correct.js";

export interface WhiteBalanceOptions {
  scale?: number;
  debug?: DebugCollector;
  /** Per-channel scale clamp. Default [0.4, 2.5]. */
  clamp?: [number, number];
}

const DEFAULT_CLAMP: [number, number] = [0.4, 2.5];
const TARGET_R = 255;
const TARGET_G = 255;
const TARGET_B = 165;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 0) return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return sorted[(n - 1) / 2];
}

function clampScale(s: number, [lo, hi]: [number, number]): number {
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.max(lo, Math.min(hi, s));
}

/**
 * Returns a copy of the input image with per-channel scales applied so
 * the frame strip's median raw colour lands near (255, 255, 165).
 */
export function whiteBalance(
  input: GBImageData,
  options?: WhiteBalanceOptions,
): GBImageData {
  const scale = options?.scale ?? 8;
  const clampRange = options?.clamp ?? DEFAULT_CLAMP;
  const dbg = options?.debug;

  const W = input.width;
  const H = input.height;

  // Extract per-channel float arrays
  const chR = new Float32Array(W * H);
  const chG = new Float32Array(W * H);
  const chB = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    chR[i] = input.data[j];
    chG[i] = input.data[j + 1];
    chB[i] = input.data[j + 2];
  }

  // Median raw colour of frame strip blocks. collectWhiteSamples already
  // applies the >0.75 * median dropouts/dashes filter and uses 85th
  // percentile per block — using it directly keeps the white-reference
  // definition consistent with what correct.ts uses internally.
  const samplesR = collectWhiteSamples(chR, W, H, scale).vs;
  const samplesG = collectWhiteSamples(chG, W, H, scale).vs;
  const samplesB = collectWhiteSamples(chB, W, H, scale).vs;

  const rawR = median(samplesR);
  const rawG = median(samplesG);
  const rawB = median(samplesB);

  const scaleR = clampScale(TARGET_R / Math.max(rawR, 1), clampRange);
  const scaleG = clampScale(TARGET_G / Math.max(rawG, 1), clampRange);
  const scaleB = clampScale(TARGET_B / Math.max(rawB, 1), clampRange);

  const output = createGBImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    output.data[j] = Math.max(0, Math.min(255, Math.round(input.data[j] * scaleR)));
    output.data[j + 1] = Math.max(0, Math.min(255, Math.round(input.data[j + 1] * scaleG)));
    output.data[j + 2] = Math.max(0, Math.min(255, Math.round(input.data[j + 2] * scaleB)));
    output.data[j + 3] = 255;
  }

  if (dbg) {
    // Re-measure on the balanced output to confirm the step did its job.
    const balR = new Float32Array(W * H);
    const balG = new Float32Array(W * H);
    const balB = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const j = i * 4;
      balR[i] = output.data[j];
      balG[i] = output.data[j + 1];
      balB[i] = output.data[j + 2];
    }
    const balMedR = median(collectWhiteSamples(balR, W, H, scale).vs);
    const balMedG = median(collectWhiteSamples(balG, W, H, scale).vs);
    const balMedB = median(collectWhiteSamples(balB, W, H, scale).vs);

    dbg.log(
      `[white-balance] raw frame median: R=${rawR.toFixed(0)} G=${rawG.toFixed(0)} B=${rawB.toFixed(0)}` +
        ` (target ${TARGET_R} ${TARGET_G} ${TARGET_B})`,
    );
    dbg.log(
      `[white-balance] scales: R=${scaleR.toFixed(3)} G=${scaleG.toFixed(3)} B=${scaleB.toFixed(3)}` +
        ` (clamp [${clampRange[0]}, ${clampRange[1]}])`,
    );
    dbg.log(
      `[white-balance] balanced frame median: R=${balMedR.toFixed(0)} G=${balMedG.toFixed(0)} B=${balMedB.toFixed(0)}`,
    );
    dbg.setMetrics("whiteBalance", {
      rawFrameMedian: { R: Math.round(rawR), G: Math.round(rawG), B: Math.round(rawB) },
      scales: {
        R: Number(scaleR.toFixed(4)),
        G: Number(scaleG.toFixed(4)),
        B: Number(scaleB.toFixed(4)),
      },
      balancedFrameMedian: {
        R: Math.round(balMedR),
        G: Math.round(balMedG),
        B: Math.round(balMedB),
      },
    });
    dbg.addImage("white-balance", output);
  }

  return output;
}
