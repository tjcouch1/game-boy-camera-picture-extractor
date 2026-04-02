import { type GBImageData, CAM_W, CAM_H, grayscaleToRGBA } from "./common.js";

export interface SampleOptions {
  scale?: number;
  method?: "mean" | "median";
  marginH?: number;
  marginV?: number;
}

/**
 * Sample step: reduce each (scale x scale) block to a single brightness value.
 *
 * Samples only the interior of each block, skipping h_margin pixels on left/right
 * and v_margin pixels on top/bottom to avoid pixel-gap and bleeding artifacts.
 */
export function sample(input: GBImageData, options?: SampleOptions): GBImageData {
  const scale = options?.scale ?? 8;
  const method = options?.method ?? "mean";

  const expectedW = CAM_W * scale;
  const expectedH = CAM_H * scale;
  if (input.width !== expectedW || input.height !== expectedH) {
    throw new Error(
      `Unexpected input size ${input.width}x${input.height}; ` +
        `expected ${expectedW}x${expectedH} (scale=${scale})`,
    );
  }

  const hMargin = options?.marginH ?? Math.max(2, Math.floor(scale / 4));
  const vMargin = options?.marginV ?? Math.max(1, Math.floor(scale / 5));

  const gray = new Uint8Array(CAM_W * CAM_H);

  for (let by = 0; by < CAM_H; by++) {
    for (let bx = 0; bx < CAM_W; bx++) {
      const values: number[] = [];
      const y0 = by * scale + vMargin;
      const y1 = (by + 1) * scale - vMargin;
      const x0 = bx * scale + hMargin;
      const x1 = (bx + 1) * scale - hMargin;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          values.push(input.data[(y * input.width + x) * 4]);
        }
      }

      let val: number;
      if (values.length === 0) {
        const cy = by * scale + Math.floor(scale / 2);
        const cx = bx * scale + Math.floor(scale / 2);
        val = input.data[(cy * input.width + cx) * 4];
      } else if (method === "median") {
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        val = values.length % 2 === 0
          ? (values[mid - 1] + values[mid]) / 2
          : values[mid];
      } else {
        val = values.reduce((a, b) => a + b, 0) / values.length;
      }

      gray[by * CAM_W + bx] = Math.round(val);
    }
  }

  return grayscaleToRGBA(gray, CAM_W, CAM_H);
}
