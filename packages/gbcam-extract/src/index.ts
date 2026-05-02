export type {
  GBImageData,
  PipelineResult,
  PipelineOptions,
  GBColorValue,
  StepName,
} from "./common.js";
export {
  GB_COLORS,
  STEP_ORDER,
  CAM_W,
  CAM_H,
  SCREEN_W,
  SCREEN_H,
  createGBImageData,
} from "./common.js";
export { initOpenCV } from "./init-opencv.js";
export { applyPalette } from "./palette.js";
export { warp } from "./warp.js";
export { whiteBalance } from "./white-balance.js";
export { correct } from "./correct.js";
export { crop } from "./crop.js";
export { sample } from "./sample.js";
export { quantize } from "./quantize.js";
export type { PaletteEntry } from "./data/palettes-generated.js";
export {
  MAIN_PALETTES,
  ADDITIONAL_PALETTES,
  FUN_PALETTES,
} from "./data/palettes-generated.js";

import type { GBImageData, PipelineResult, PipelineOptions } from "./common.js";
import { warp } from "./warp.js";
import { whiteBalance } from "./white-balance.js";
import { correct, collectWhiteSamples } from "./correct.js";
import { crop } from "./crop.js";
import { sample } from "./sample.js";
import { quantize } from "./quantize.js";
import { createDebugCollector } from "./debug.js";

/**
 * Compute the raw B-channel median over the frame strip of a warped (but
 * not-yet-balanced) image. Used to gate the conditional 3D RGB quantize
 * path: B is sensor-clipped on blue-cast images (median ≳ 240) and is
 * uninformative for DG/non-DG separation in those; on yellow/neutral cast
 * images (median < 240) raw B is recoverable and worth using.
 */
function rawFrameMedianB(warped: GBImageData, scale: number): number {
  const W = warped.width;
  const H = warped.height;
  const chB = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) chB[i] = warped.data[i * 4 + 2];
  const { vs } = collectWhiteSamples(chB, W, H, scale);
  if (vs.length === 0) return 255;
  const sorted = vs.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const USE_B_GATE_THRESHOLD = 240;

export async function processPicture(
  input: GBImageData,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const scale = options?.scale ?? 8;
  const debug = options?.debug ?? false;
  const onProgress = options?.onProgress;

  const collector = debug ? createDebugCollector() : undefined;

  onProgress?.("warp", 0);
  const warped = warp(input, { scale, debug: collector });
  onProgress?.("warp", 100);

  const bMedRaw = rawFrameMedianB(warped, scale);
  const useB = bMedRaw < USE_B_GATE_THRESHOLD;
  if (collector) {
    collector.log(
      `[pipeline] raw frame B median = ${bMedRaw.toFixed(0)}; ` +
        `useB = ${useB} (gate < ${USE_B_GATE_THRESHOLD})`,
    );
    collector.setMetric("pipeline", "useB", useB);
    collector.setMetric("pipeline", "rawFrameMedianB", Math.round(bMedRaw));
  }

  const balanced = whiteBalance(warped, { scale, debug: collector });

  onProgress?.("correct", 0);
  const corrected = correct(balanced, { scale, debug: collector });
  onProgress?.("correct", 100);

  onProgress?.("crop", 0);
  const cropped = crop(corrected, { scale, debug: collector });
  onProgress?.("crop", 100);

  onProgress?.("sample", 0);
  const sampled = sample(cropped, { scale, debug: collector });
  onProgress?.("sample", 100);

  onProgress?.("quantize", 0);
  const quantized = quantize(sampled, { debug: collector, useB });
  onProgress?.("quantize", 100);

  const result: PipelineResult = { grayscale: quantized };
  if (debug) {
    result.intermediates = {
      warp: warped,
      correct: corrected,
      crop: cropped,
      sample: sampled,
    };
    if (collector) {
      result.debug = collector.data;
    }
  }
  return result;
}
