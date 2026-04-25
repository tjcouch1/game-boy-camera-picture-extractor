import { describe, it, expect } from "vitest";
import { crop } from "../src/crop.js";
import { createGBImageData, SCREEN_W, SCREEN_H, FRAME_THICK, CAM_W, CAM_H } from "../src/common.js";

describe("crop", () => {
  it("extracts the 128x112 camera area from a 160x144 screen (at scale=1)", () => {
    const scale = 1;
    const w = SCREEN_W * scale;
    const h = SCREEN_H * scale;
    const input = createGBImageData(w, h);

    // Fill the entire image with white (frame)
    for (let i = 0; i < input.data.length; i += 4) {
      input.data[i] = 255;
      input.data[i + 1] = 255;
      input.data[i + 2] = 255;
      input.data[i + 3] = 255;
    }

    // Fill the camera area (16..144, 16..128) with a distinct gray
    for (let y = FRAME_THICK * scale; y < (FRAME_THICK + CAM_H) * scale; y++) {
      for (let x = FRAME_THICK * scale; x < (FRAME_THICK + CAM_W) * scale; x++) {
        const idx = (y * w + x) * 4;
        input.data[idx] = 128;
        input.data[idx + 1] = 128;
        input.data[idx + 2] = 128;
      }
    }

    const result = crop(input, { scale });

    expect(result.width).toBe(CAM_W * scale);
    expect(result.height).toBe(CAM_H * scale);

    // Every pixel in the result should be the gray we painted in the camera area
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(128);
      expect(result.data[i + 1]).toBe(128);
      expect(result.data[i + 2]).toBe(128);
      expect(result.data[i + 3]).toBe(255);
    }
  });

  it("works at scale=8 (default pipeline scale)", () => {
    const scale = 8;
    const w = SCREEN_W * scale;
    const h = SCREEN_H * scale;
    const input = createGBImageData(w, h);

    // Fill camera area with value 100
    for (let y = FRAME_THICK * scale; y < (FRAME_THICK + CAM_H) * scale; y++) {
      for (let x = FRAME_THICK * scale; x < (FRAME_THICK + CAM_W) * scale; x++) {
        const idx = (y * w + x) * 4;
        input.data[idx] = 100;
        input.data[idx + 1] = 100;
        input.data[idx + 2] = 100;
        input.data[idx + 3] = 255;
      }
    }

    const result = crop(input, { scale });

    expect(result.width).toBe(CAM_W * scale); // 1024
    expect(result.height).toBe(CAM_H * scale); // 896
    expect(result.data[0]).toBe(100); // top-left pixel R
  });
});
