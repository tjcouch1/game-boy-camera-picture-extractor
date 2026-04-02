import { describe, it, expect } from "vitest";
import { sample } from "../src/sample.js";
import { createGBImageData, CAM_W, CAM_H } from "../src/common.js";

describe("sample", () => {
  it("reduces a (128*scale)x(112*scale) image to 128x112", () => {
    const scale = 8;
    const w = CAM_W * scale; // 1024
    const h = CAM_H * scale; // 896
    const input = createGBImageData(w, h);

    // Fill each scale-block with a uniform brightness = block index mod 256
    for (let by = 0; by < CAM_H; by++) {
      for (let bx = 0; bx < CAM_W; bx++) {
        const val = (by * CAM_W + bx) % 256;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = bx * scale + dx;
            const py = by * scale + dy;
            const idx = (py * w + px) * 4;
            input.data[idx] = val;
            input.data[idx + 1] = val;
            input.data[idx + 2] = val;
            input.data[idx + 3] = 255;
          }
        }
      }
    }

    const result = sample(input, { scale });

    expect(result.width).toBe(CAM_W);
    expect(result.height).toBe(CAM_H);

    // Each output pixel should match the uniform block value
    for (let by = 0; by < CAM_H; by++) {
      for (let bx = 0; bx < CAM_W; bx++) {
        const expected = (by * CAM_W + bx) % 256;
        const idx = (by * CAM_W + bx) * 4;
        expect(Math.abs(result.data[idx] - expected)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("handles scale=1 (no downscaling needed)", () => {
    const scale = 1;
    const input = createGBImageData(CAM_W, CAM_H);
    for (let i = 0; i < input.data.length; i += 4) {
      input.data[i] = 42;
      input.data[i + 1] = 42;
      input.data[i + 2] = 42;
      input.data[i + 3] = 255;
    }

    const result = sample(input, { scale });
    expect(result.width).toBe(CAM_W);
    expect(result.height).toBe(CAM_H);
    expect(result.data[0]).toBe(42);
  });
});
