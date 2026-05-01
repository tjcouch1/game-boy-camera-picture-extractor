import { describe, it, expect, beforeAll } from "vitest";
import { locate } from "../src/locate.js";
import { initOpenCV } from "../src/init-opencv.js";

beforeAll(async () => {
  await initOpenCV();
}, 30_000);

describe("locate (synthetic)", () => {
  it("throws a clear no-candidate error when given a uniformly dark image", () => {
    const w = 800, h = 600;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 30; data[i + 1] = 30; data[i + 2] = 30; data[i + 3] = 255;
    }
    expect(() => locate({ data, width: w, height: h })).toThrow(/locate/);
  });
});
