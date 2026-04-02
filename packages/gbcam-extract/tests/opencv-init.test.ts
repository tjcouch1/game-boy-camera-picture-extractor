import { describe, it, expect } from "vitest";

describe("opencv-js loading", () => {
  it("can import the module", async () => {
    const mod = await import("@techstark/opencv-js");
    console.log("mod type:", typeof mod);
    console.log("mod.default type:", typeof mod.default);
    console.log("mod keys:", Object.keys(mod).slice(0, 5));

    const raw = mod.default ?? mod;
    console.log("raw type:", typeof raw);
    console.log("raw.then?:", typeof raw.then);

    if (typeof raw.then === "function") {
      console.log("Awaiting thenable...");
      const cv = await raw;
      console.log("cv type:", typeof cv);
      console.log("cv.Mat?:", typeof cv.Mat);
      expect(typeof cv.Mat).toBe("function");
    } else {
      console.log("Not thenable, checking Mat directly");
      console.log("raw.Mat?:", typeof raw.Mat);
      expect(typeof raw.Mat).toBe("function");
    }
  }, 30_000);
});
