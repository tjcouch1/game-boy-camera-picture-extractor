import { describe, it, expect } from "vitest";
import { applyPalette } from "../src/palette.js";
import { createGBImageData, GB_COLORS, CAM_W, CAM_H } from "../src/common.js";

describe("applyPalette", () => {
  it("remaps 4 grayscale values to the given palette colors", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    const bandH = Math.floor(CAM_H / 4);
    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandH), 3);
      const val = GB_COLORS[band]; // 0, 82, 165, 255
      for (let x = 0; x < CAM_W; x++) {
        const idx = (y * CAM_W + x) * 4;
        input.data[idx] = val; input.data[idx+1] = val; input.data[idx+2] = val; input.data[idx+3] = 255;
      }
    }

    const palette: [string, string, string, string] = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"];
    const result = applyPalette(input, palette);

    expect(result.width).toBe(CAM_W);
    expect(result.height).toBe(CAM_H);

    // Band 0 (gray=0, darkest) -> palette[3] = #FFFF00
    expect(result.data[0]).toBe(255); expect(result.data[1]).toBe(255); expect(result.data[2]).toBe(0);

    // Band 3 (gray=255, lightest) -> palette[0] = #FF0000
    const y3 = bandH * 3;
    const idx3 = (y3 * CAM_W) * 4;
    expect(result.data[idx3]).toBe(255); expect(result.data[idx3+1]).toBe(0); expect(result.data[idx3+2]).toBe(0);
  });
});
