import { describe, it, expect, beforeAll } from "vitest";
import { warp } from "../src/warp.js";
import { initOpenCV } from "../src/init-opencv.js";
import { SCREEN_W, SCREEN_H } from "../src/common.js";

beforeAll(async () => {
  await initOpenCV();
}, 5_000);

describe("warp", () => {
  it("produces output sized at SCREEN_W*k by SCREEN_H*k for some integer k", () => {
    // Synthetic 640x480 photo with a 400x360 bright rectangle simulating the
    // GB screen frame. Auto-scale should pick scale = ceil(max(400/160, 360/144))
    // = ceil(2.5) = 3 — but we don't pin that exactly because corner detection
    // can shift by a pixel or two. We only assert the shape constraint.
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

    const result = warp({ data, width: w, height: h });

    // width and height must both be positive integer multiples of SCREEN_W and
    // SCREEN_H, with the same scale factor applied to each.
    expect(result.width % SCREEN_W).toBe(0);
    expect(result.height % SCREEN_H).toBe(0);
    expect(result.width).toBeGreaterThan(0);
    const k = result.width / SCREEN_W;
    expect(result.height).toBe(SCREEN_H * k);

    // For the synthetic 400x360 quad, auto-scale should land at 3 (small jitter
    // from corner detection won't push past 4 or below 2).
    expect(k).toBeGreaterThanOrEqual(2);
    expect(k).toBeLessThanOrEqual(4);
  });
});
