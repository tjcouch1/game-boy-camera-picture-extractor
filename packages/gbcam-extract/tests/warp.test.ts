import { describe, it, expect, beforeAll } from "vitest";
import { warp } from "../src/warp.js";
import { initOpenCV } from "../src/init-opencv.js";
import { SCREEN_W, SCREEN_H } from "../src/common.js";

beforeAll(async () => {
  await initOpenCV();
}, 5_000);

describe("warp", () => {
  it("produces output with correct dimensions at default scale", () => {
    const scale = 8;
    // Create synthetic test image: bright rectangle on dark background
    const w = 640, h = 480;
    const data = new Uint8ClampedArray(w * h * 4);

    // Dark background
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 20; data[i+1] = 20; data[i+2] = 20; data[i+3] = 255;
    }

    // Bright rectangle (simulating GB screen frame)
    const rectW = 400, rectH = 360;
    const rx = Math.floor((w - rectW) / 2);
    const ry = Math.floor((h - rectH) / 2);
    for (let y = ry; y < ry + rectH; y++) {
      for (let x = rx; x < rx + rectW; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = 255; data[idx+1] = 255; data[idx+2] = 165; data[idx+3] = 255;
      }
    }

    const result = warp({ data, width: w, height: h }, { scale });
    expect(result.width).toBe(SCREEN_W * scale);
    expect(result.height).toBe(SCREEN_H * scale);
  });
});
