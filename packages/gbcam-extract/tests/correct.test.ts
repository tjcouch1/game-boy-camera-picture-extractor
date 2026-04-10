import { describe, it, expect, beforeAll } from "vitest";
import { correct, uniformFilter1d } from "../src/correct.js";
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

  it("uniformFilter1d uses nearest (clamp) boundary, not reflection", () => {
    // Input [10, 20, 30], size=3
    // At i=0: window covers j=-1,0,1. With nearest: idx=-1→0, values=[10,10,20], mean=13.33
    //                                  With reflect: idx=-1→1, values=[20,10,20], mean=16.67
    const input = new Float64Array([10, 20, 30]);
    const result = uniformFilter1d(input, 3);

    // nearest boundary: (10 + 10 + 20) / 3 ≈ 13.33
    expect(result[0]).toBeCloseTo(13.33, 1);
    // middle element is unaffected by boundary: (10 + 20 + 30) / 3 ≈ 20
    expect(result[1]).toBeCloseTo(20.0, 1);
    // last element with nearest: (20 + 30 + 30) / 3 ≈ 26.67
    expect(result[2]).toBeCloseTo(26.67, 1);
  });
});
