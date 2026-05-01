import { describe, it, expect } from "vitest";
import { computeAutoScale } from "../src/auto-scale.js";

describe("computeAutoScale", () => {
  it("returns scale 1 for a screen-sized axis-aligned quad (160x144)", () => {
    const r = computeAutoScale([
      [0, 0],
      [160, 0],
      [160, 144],
      [0, 144],
    ]);
    expect(r.scale).toBe(1);
    expect(r.edgeLengths.top).toBeCloseTo(160, 6);
    expect(r.edgeLengths.bottom).toBeCloseTo(160, 6);
    expect(r.edgeLengths.left).toBeCloseTo(144, 6);
    expect(r.edgeLengths.right).toBeCloseTo(144, 6);
    expect(r.maxHorizontal).toBeCloseTo(160, 6);
    expect(r.maxVertical).toBeCloseTo(144, 6);
  });

  it("rounds up to the next integer scale (1280x1152 -> 8)", () => {
    const r = computeAutoScale([
      [0, 0],
      [1280, 0],
      [1280, 1152],
      [0, 1152],
    ]);
    expect(r.scale).toBe(8);
    expect(r.maxHorizontal).toBeCloseTo(1280, 6);
    expect(r.maxVertical).toBeCloseTo(1152, 6);
  });

  it("ceils when the screen exceeds an integer multiple (1281x1152 -> 9)", () => {
    const r = computeAutoScale([
      [0, 0],
      [1281, 0],
      [1281, 1152],
      [0, 1152],
    ]);
    expect(r.scale).toBe(9);
  });

  it("uses the larger ratio when horizontal vs vertical disagree", () => {
    // 320 / 160 = 2.0 horizontal, 600 / 144 ≈ 4.166 vertical → ceil(4.166) = 5
    const r = computeAutoScale([
      [0, 0],
      [320, 0],
      [320, 600],
      [0, 600],
    ]);
    expect(r.scale).toBe(5);
    expect(r.maxHorizontal).toBeCloseTo(320, 6);
    expect(r.maxVertical).toBeCloseTo(600, 6);
  });

  it("uses the longer of top/bottom and left/right edges (perspective)", () => {
    // Trapezoid: top edge 200 wide, bottom 400 wide, left/right 144 tall
    // Max horizontal = 400, max vertical = 144
    // ratio = max(400/160, 144/144) = max(2.5, 1) = 2.5 → ceil = 3
    const r = computeAutoScale([
      [100, 0],
      [300, 0],
      [400, 144],
      [0, 144],
    ]);
    expect(r.edgeLengths.top).toBeCloseTo(200, 6);
    expect(r.edgeLengths.bottom).toBeCloseTo(400, 6);
    expect(r.maxHorizontal).toBeCloseTo(400, 6);
    expect(r.scale).toBe(3);
  });

  it("clamps degenerate input to scale=1", () => {
    const r = computeAutoScale([
      [10, 10],
      [10, 10],
      [10, 10],
      [10, 10],
    ]);
    expect(r.scale).toBe(1);
  });
});
