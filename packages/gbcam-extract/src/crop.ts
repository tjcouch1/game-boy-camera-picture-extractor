import {
  type GBImageData,
  SCREEN_W,
  SCREEN_H,
  FRAME_THICK,
  CAM_W,
  CAM_H,
} from "./common.js";

export interface CropOptions {
  scale?: number;
}

/**
 * Crop step: remove the filmstrip frame, keeping only the 128x112 camera area.
 *
 * The input is a (SCREEN_W*scale) x (SCREEN_H*scale) perspective-corrected image.
 * The camera image starts at GB pixel (FRAME_THICK, FRAME_THICK) and is CAM_W x CAM_H
 * GB pixels, so in image-pixel coordinates:
 *   x: [FRAME_THICK*scale .. (FRAME_THICK+CAM_W)*scale)
 *   y: [FRAME_THICK*scale .. (FRAME_THICK+CAM_H)*scale)
 */
export function crop(input: GBImageData, options?: CropOptions): GBImageData {
  const scale = options?.scale ?? 8;

  const expectedW = SCREEN_W * scale;
  const expectedH = SCREEN_H * scale;
  if (input.width !== expectedW || input.height !== expectedH) {
    throw new Error(
      `Unexpected input size ${input.width}x${input.height}; ` +
        `expected ${expectedW}x${expectedH} (scale=${scale})`,
    );
  }

  const x1 = FRAME_THICK * scale;
  const y1 = FRAME_THICK * scale;
  const outW = CAM_W * scale;
  const outH = CAM_H * scale;

  const data = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    const srcOffset = ((y1 + y) * input.width + x1) * 4;
    const dstOffset = y * outW * 4;
    data.set(
      input.data.subarray(srcOffset, srcOffset + outW * 4),
      dstOffset,
    );
  }

  return { data, width: outW, height: outH };
}
