import { describe, it, expect, beforeAll } from "vitest";
import { correct } from "../src/correct.js";
import { initOpenCV } from "../src/init-opencv.js";
import { createGBImageData, SCREEN_W, SCREEN_H } from "../src/common.js";

beforeAll(async () => {
  await initOpenCV();
}, 5_000);

describe("correct", () => {
  it("outputs same dimensions as input", () => {
    const scale = 8;
    const w = SCREEN_W * scale;
    const h = SCREEN_H * scale;
    const input = createGBImageData(w, h);

    // Fill with a gradient to simulate front-light effect
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = Math.round(200 - (x / w) * 80);
        const idx = (y * w + x) * 4;
        input.data[idx] = val;
        input.data[idx + 1] = val;
        input.data[idx + 2] = val;
        input.data[idx + 3] = 255;
      }
    }

    const result = correct(input, { scale });
    expect(result.width).toBe(w);
    expect(result.height).toBe(h);
  });
});
