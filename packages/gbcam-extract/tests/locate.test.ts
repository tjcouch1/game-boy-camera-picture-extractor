import { describe, it, expect, beforeAll } from "vitest";
import { locate } from "../src/locate.js";
import { initOpenCV } from "../src/init-opencv.js";
import { createGBImageData } from "../src/common.js";

beforeAll(async () => {
  await initOpenCV();
}, 30_000);

describe("locate (stub)", () => {
  it("returns an image when given an image (passthrough stub)", () => {
    const input = createGBImageData(100, 80);
    // Fill with mid-gray so it's not all zeroes
    for (let i = 0; i < input.data.length; i += 4) {
      input.data[i] = 128;
      input.data[i + 1] = 128;
      input.data[i + 2] = 128;
      input.data[i + 3] = 255;
    }
    const out = locate(input);
    expect(out.width).toBe(100);
    expect(out.height).toBe(80);
  });
});
