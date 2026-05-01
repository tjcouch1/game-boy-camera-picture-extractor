import { describe, it, expect, beforeAll } from "vitest";
import { locate } from "../src/locate.js";
import { initOpenCV } from "../src/init-opencv.js";

beforeAll(async () => {
  await initOpenCV();
}, 30_000);

describe("locate (downsample)", () => {
  it("does not throw on a small synthetic image with a clear bright rectangle", () => {
    const w = 1200, h = 900;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 20; data[i + 1] = 20; data[i + 2] = 20; data[i + 3] = 255;
    }
    const rectW = 600, rectH = 540;
    const rx = Math.floor((w - rectW) / 2);
    const ry = Math.floor((h - rectH) / 2);
    for (let y = ry; y < ry + rectH; y++) {
      for (let x = rx; x < rx + rectW; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 165; data[idx + 3] = 255;
      }
    }

    expect(() => locate({ data, width: w, height: h })).not.toThrow();
  });
});
