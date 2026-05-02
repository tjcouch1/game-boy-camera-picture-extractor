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
import { correct } from "./correct.js";
import { crop } from "./crop.js";
import { sample } from "./sample.js";
import { quantize } from "./quantize.js";
import { createDebugCollector } from "./debug.js";

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
  const quantized = quantize(sampled, { debug: collector });
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
