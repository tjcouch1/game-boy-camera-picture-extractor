import { describe, it, expect } from "vitest";
import { whiteBalance } from "../src/white-balance.js";
import {
  createGBImageData,
  SCREEN_W,
  SCREEN_H,
  FRAME_THICK,
  CAM_W,
  CAM_H,
} from "../src/common.js";

const SCALE = 8;
const W = SCREEN_W * SCALE;
const H = SCREEN_H * SCALE;

/**
 * Build a synthetic warp output: the frame strip area filled with one
 * RGB colour, the inner camera region filled with another. The frame
 * strip is what white-balance reads, so the camera-region colour is
 * just there to make sure scales aren't pulled by it.
 */
function buildSynthetic(
  frameRGB: [number, number, number],
  cameraRGB: [number, number, number],
): ReturnType<typeof createGBImageData> {
  const img = createGBImageData(W, H);
  const camX0 = FRAME_THICK * SCALE;
  const camY0 = FRAME_THICK * SCALE;
  const camX1 = (FRAME_THICK + CAM_W) * SCALE;
  const camY1 = (FRAME_THICK + CAM_H) * SCALE;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inCam = x >= camX0 && x < camX1 && y >= camY0 && y < camY1;
      const c = inCam ? cameraRGB : frameRGB;
      const j = (y * W + x) * 4;
      img.data[j] = c[0];
      img.data[j + 1] = c[1];
      img.data[j + 2] = c[2];
      img.data[j + 3] = 255;
    }
  }
  return img;
}

/** Measure the per-channel median of the frame strip in an output image. */
function frameStripMedian(
  img: ReturnType<typeof createGBImageData>,
): [number, number, number] {
  const camX0 = FRAME_THICK * SCALE;
  const camY0 = FRAME_THICK * SCALE;
  const camX1 = (FRAME_THICK + CAM_W) * SCALE;
  const camY1 = (FRAME_THICK + CAM_H) * SCALE;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inCam = x >= camX0 && x < camX1 && y >= camY0 && y < camY1;
      if (inCam) continue;
      const j = (y * W + x) * 4;
      rs.push(img.data[j]);
      gs.push(img.data[j + 1]);
      bs.push(img.data[j + 2]);
    }
  }
  const median = (arr: number[]): number => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  };
  return [median(rs), median(gs), median(bs)];
}

describe("whiteBalance", () => {
  it("brings frame strip median near (255, 255, 165)", () => {
    const input = buildSynthetic([200, 220, 130], [180, 160, 110]);
    const out = whiteBalance(input, { scale: SCALE });
    const [r, g, b] = frameStripMedian(out);
    expect(Math.abs(r - 255)).toBeLessThanOrEqual(5);
    expect(Math.abs(g - 255)).toBeLessThanOrEqual(5);
    expect(Math.abs(b - 165)).toBeLessThanOrEqual(5);
  });

  it("clamps extreme scales so a single weird image cannot blow up", () => {
    // raw frame (50, 250, 30): scaleR=255/50=5.1 (clamps to 2.5), scaleG=255/250=1.02,
    // scaleB=165/30=5.5 (clamps to 2.5). The clamped output should not have
    // R=255 (would require scaleR≈5.1) nor B=165.
    const input = buildSynthetic([50, 250, 30], [50, 250, 30]);
    const out = whiteBalance(input, { scale: SCALE, clamp: [0.4, 2.5] });
    const [r, g, b] = frameStripMedian(out);
    // Expected: r ≈ 50 * 2.5 = 125, g ≈ 250 * 1.02 = 255, b ≈ 30 * 2.5 = 75.
    expect(r).toBeLessThan(160);
    expect(b).toBeLessThan(120);
    // G is in-range so it lands near 255.
    expect(Math.abs(g - 255)).toBeLessThanOrEqual(10);
  });

  it("preserves dimensions and alpha channel", () => {
    const input = buildSynthetic([200, 200, 200], [120, 120, 120]);
    const out = whiteBalance(input, { scale: SCALE });
    expect(out.width).toBe(W);
    expect(out.height).toBe(H);
    // Spot-check alpha is 255 everywhere
    expect(out.data[3]).toBe(255);
    expect(out.data[(W * H - 1) * 4 + 3]).toBe(255);
  });
});
