import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { processPicture, initOpenCV, CAM_W, CAM_H } from "../src/index.js";
import { loadImage, repoRoot } from "./helpers/load-image.js";

const TEST_CASES = [
  { name: "thing-1", input: "thing-1.jpg", ref: "thing-output-corrected.png" },
  { name: "thing-2", input: "thing-2.jpg", ref: "thing-output-corrected.png" },
  { name: "thing-3", input: "thing-3.jpg", ref: "thing-output-corrected.png" },
  { name: "zelda-poster-1", input: "zelda-poster-1.jpg", ref: "zelda-poster-output-corrected.png" },
  { name: "zelda-poster-2", input: "zelda-poster-2.jpg", ref: "zelda-poster-output-corrected.png" },
  { name: "zelda-poster-3", input: "zelda-poster-3.jpg", ref: "zelda-poster-output-corrected.png" },
];

beforeAll(async () => {
  await initOpenCV();
}, 5_000);

describe("full pipeline integration", () => {
  for (const tc of TEST_CASES) {
    it(`${tc.name}: processes and compares to reference`, async () => {
      const inputPath = repoRoot("test-input", tc.input);
      const refPath = repoRoot("test-input", tc.ref);

      if (!existsSync(inputPath) || !existsSync(refPath)) {
        console.warn(`Skipping ${tc.name}: test files not found`);
        return;
      }

      const input = await loadImage(inputPath);
      const result = await processPicture(input);

      expect(result.grayscale.width).toBe(CAM_W);
      expect(result.grayscale.height).toBe(CAM_H);

      const ref = await loadImage(refPath);
      expect(ref.width).toBe(CAM_W);
      expect(ref.height).toBe(CAM_H);

      const totalPixels = CAM_W * CAM_H;
      let matching = 0;
      let different = 0;

      for (let i = 0; i < totalPixels; i++) {
        const resultVal = result.grayscale.data[i * 4];
        const refVal = ref.data[i * 4];
        if (resultVal === refVal) matching++;
        else different++;
      }

      const accuracy = (matching / totalPixels) * 100;
      console.log(`  ${tc.name}: ${matching}/${totalPixels} (${accuracy.toFixed(2)}%), ${different} different`);

      // Pass threshold: 100% match
      expect(different).toBe(0);
    }, 120_000);
  }
});
