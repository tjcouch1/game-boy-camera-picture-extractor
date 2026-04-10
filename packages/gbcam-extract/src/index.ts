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
export { correct } from "./correct.js";
export { crop } from "./crop.js";
export { sample } from "./sample.js";
export { quantize } from "./quantize.js";
export type { PaletteEntry } from "./data/palettes.js";
export {
  MAIN_PALETTES,
  ADDITIONAL_PALETTES,
  FUN_PALETTES,
} from "./data/palettes.js";

import type { GBImageData, PipelineResult, PipelineOptions } from "./common.js";
import { warp } from "./warp.js";
import { correct } from "./correct.js";
import { crop } from "./crop.js";
import { sample } from "./sample.js";
import { quantize } from "./quantize.js";

export async function processPicture(
  input: GBImageData,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const scale = options?.scale ?? 8;
  const debug = options?.debug ?? false;
  const onProgress = options?.onProgress;

  onProgress?.("warp", 0);
  const warped = warp(input, { scale });
  onProgress?.("warp", 100);

  onProgress?.("correct", 0);
  const corrected = correct(warped, { scale });
  onProgress?.("correct", 100);

  onProgress?.("crop", 0);
  const cropped = crop(corrected, { scale });
  onProgress?.("crop", 100);

  onProgress?.("sample", 0);
  const sampled = sample(cropped, { scale });
  onProgress?.("sample", 100);

  onProgress?.("quantize", 0);
  const quantized = quantize(sampled);
  onProgress?.("quantize", 100);

  const result: PipelineResult = { grayscale: quantized };
  if (debug) {
    result.intermediates = {
      warp: warped,
      correct: corrected,
      crop: cropped,
      sample: sampled,
    };
  }
  return result;
}
