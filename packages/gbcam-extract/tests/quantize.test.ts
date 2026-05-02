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

describe("quantize useB (3D RGB path)", () => {
  it("classifies 4 RGB bands correctly when DG.B is post-clip (not 255)", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    const bandHeight = Math.floor(CAM_H / 4);
    // BK, DG, LG, WH — DG B=200 to mimic post-WB clipped data on a yellow
    // cast image (would be 255 in palette, but data is lower).
    const bands: [number, number, number][] = [
      [0, 0, 0],
      [148, 148, 200],
      [255, 148, 148],
      [255, 255, 165],
    ];
    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandHeight), 3);
      const [r, g, b] = bands[band];
      for (let x = 0; x < CAM_W; x++) {
        const j = (y * CAM_W + x) * 4;
        input.data[j] = r;
        input.data[j + 1] = g;
        input.data[j + 2] = b;
        input.data[j + 3] = 255;
      }
    }

    const result = quantize(input, { useB: true });

    // Each band should classify to its expected palette value.
    const expectedByBand = [GB_COLORS[0], GB_COLORS[1], GB_COLORS[2], GB_COLORS[3]];
    for (let bi = 0; bi < 4; bi++) {
      const yMid = bi * bandHeight + Math.floor(bandHeight / 2);
      const j = (yMid * CAM_W + CAM_W / 2) * 4;
      expect(result.data[j]).toBe(expectedByBand[bi]);
    }
  });

  it("with useB=false, RGB and 2D-RG paths agree on a band image where B is uninformative", () => {
    const input = createGBImageData(CAM_W, CAM_H);
    const bandHeight = Math.floor(CAM_H / 4);
    // B = 0 everywhere — the RG path should be byte-identical to its old
    // behaviour and not depend on B at all.
    const bands: [number, number, number][] = [
      [0, 0, 0],
      [148, 148, 0],
      [255, 148, 0],
      [255, 255, 0],
    ];
    for (let y = 0; y < CAM_H; y++) {
      const band = Math.min(Math.floor(y / bandHeight), 3);
      const [r, g, b] = bands[band];
      for (let x = 0; x < CAM_W; x++) {
        const j = (y * CAM_W + x) * 4;
        input.data[j] = r;
        input.data[j + 1] = g;
        input.data[j + 2] = b;
        input.data[j + 3] = 255;
      }
    }
    const a = quantize(input, { useB: false });
    const b = quantize(input);
    for (let i = 0; i < a.data.length; i++) {
      expect(a.data[i]).toBe(b.data[i]);
    }
  });
});
