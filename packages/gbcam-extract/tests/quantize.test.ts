import { describe, it, expect, beforeAll } from "vitest";
import { quantize } from "../src/quantize.js";
import { initOpenCV } from "../src/opencv.js";
import { createGBImageData, GB_COLORS, CAM_W, CAM_H } from "../src/common.js";

beforeAll(async () => {
  const mod = await import("@techstark/opencv-js");
  const raw = mod.default ?? mod;
  // opencv-js exports a thenable that resolves when WASM is ready
  const cv = typeof raw.then === "function" ? await raw : raw;
  await initOpenCV(cv);
}, 30_000);

describe("quantize", () => {
  it("maps pixels near palette values to exact palette values", () => {
    const input = createGBImageData(CAM_W, CAM_H);

    // Fill with 4 horizontal bands, each near a palette color
    const bandHeight = Math.floor(CAM_H / 4);
    const nearValues = [5, 78, 170, 250]; // near 0, 82, 165, 255

    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandHeight), 3);
      const val = nearValues[band];
      for (let x = 0; x < CAM_W; x++) {
        const idx = (y * CAM_W + x) * 4;
        input.data[idx] = val;
        input.data[idx + 1] = val;
        input.data[idx + 2] = val;
        input.data[idx + 3] = 255;
      }
    }

    const result = quantize(input);

    expect(result.width).toBe(CAM_W);
    expect(result.height).toBe(CAM_H);

    // Every output pixel should be one of the 4 palette values
    for (let i = 0; i < result.data.length; i += 4) {
      expect(GB_COLORS).toContain(result.data[i]);
      expect(result.data[i]).toBe(result.data[i + 1]); // R=G=B
      expect(result.data[i]).toBe(result.data[i + 2]);
    }
  });
});
