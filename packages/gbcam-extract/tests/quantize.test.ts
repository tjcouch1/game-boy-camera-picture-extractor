import { describe, it, expect, beforeAll } from "vitest";
import { quantize, gValleyThresholdForTest } from "../src/quantize.js";
import { initOpenCV } from "../src/init-opencv.js";
import { createGBImageData, GB_COLORS, CAM_W, CAM_H } from "../src/common.js";

beforeAll(async () => {
  await initOpenCV();
}, 5_000);

describe("quantize", () => {
  it("maps pixels near palette values to exact palette values", () => {
    const input = createGBImageData(CAM_W, CAM_H);

    // Fill with 4 horizontal bands, each near a palette colour. Quantize
    // works in 3D RGB now; using R=G=B grayscale bands still falls under
    // BK/DG-line/WH on the cluster geometry (the LG/DG/WH targets share
    // R=G=255/148/255 axes anyway), so we use a low-saturation triple
    // that sits near each palette anchor.
    const bandHeight = Math.floor(CAM_H / 4);
    const nearRGB: [number, number, number][] = [
      [5, 5, 5],         // near BK (0,0,0)
      [150, 150, 250],   // near DG (148,148,255)
      [250, 150, 150],   // near LG (255,148,148)
      [250, 250, 165],   // near WH (255,255,165)
    ];

    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandHeight), 3);
      const [r, g, b] = nearRGB[band];
      for (let x = 0; x < CAM_W; x++) {
        const idx = (y * CAM_W + x) * 4;
        input.data[idx] = r;
        input.data[idx + 1] = g;
        input.data[idx + 2] = b;
        input.data[idx + 3] = 255;
      }
    }

    const result = quantize(input);

    expect(result.width).toBe(CAM_W);
    expect(result.height).toBe(CAM_H);

    // Every output pixel should be one of the 4 palette values
    for (let i = 0; i < result.data.length; i += 4) {
      expect(GB_COLORS).toContain(result.data[i]);
      expect(result.data[i]).toBe(result.data[i + 1]);
      expect(result.data[i]).toBe(result.data[i + 2]);
    }
  });

  it("classifies four bands at exact palette RGB to the right grays", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    const bandHeight = Math.floor(CAM_H / 4);
    const palette: [number, number, number][] = [
      [0, 0, 0],         // BK -> 0
      [148, 148, 255],   // DG -> 82
      [255, 148, 148],   // LG -> 165
      [255, 255, 165],   // WH -> 255
    ];
    const expectedGray = [0, 82, 165, 255];
    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandHeight), 3);
      const [r, g, b] = palette[band];
      for (let x = 0; x < CAM_W; x++) {
        const idx = (y * CAM_W + x) * 4;
        input.data[idx] = r;
        input.data[idx + 1] = g;
        input.data[idx + 2] = b;
        input.data[idx + 3] = 255;
      }
    }

    const result = quantize(input);
    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandHeight), 3);
      const expected = expectedGray[band];
      // Spot-check the middle pixel of each row
      const midX = Math.floor(CAM_W / 2);
      const idx = (y * CAM_W + midX) * 4;
      expect(result.data[idx]).toBe(expected);
    }
  });
});

describe("gValleyThreshold safety clamp", () => {
  it("never returns a threshold within 8 G-units of either cluster center", () => {
    // Monotonically-decreasing histogram (mimics 20260328_165926: very few
    // true WH pixels, so the smoothed histogram falls off all the way to
    // whCenterG). Without the safety clamp, the search picks the rightmost
    // bin and returns ~whCenterG.
    const lgCenterG = 119;
    const whCenterG = 197;
    const gVals: number[] = [];
    for (let g = lgCenterG; g < whCenterG; g++) {
      const count = Math.max(1, Math.round(1000 * Math.exp(-(g - lgCenterG) / 15)));
      for (let k = 0; k < count; k++) gVals.push(g);
    }
    const t = gValleyThresholdForTest(gVals, lgCenterG, whCenterG);
    expect(t).toBeGreaterThanOrEqual(lgCenterG + 8);
    expect(t).toBeLessThanOrEqual(whCenterG - 8);
  });

  it("falls back to midpoint when histogram is too noisy", () => {
    const t = gValleyThresholdForTest([], 100, 200);
    expect(t).toBeCloseTo(150, 1);
  });
});
