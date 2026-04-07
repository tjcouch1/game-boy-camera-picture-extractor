import { describe, it, expect, vi } from "vitest";
import { getCV, initOpenCV } from "../src/init-opencv.js";

describe("opencv-js loading", () => {
  it("can import the module", async () => {
    const onProgressMock = vi.fn();
    await initOpenCV(onProgressMock);
    await initOpenCV(onProgressMock);
    const cv = getCV();
    expect(typeof cv).toBe("object");
    expect(typeof cv.Mat).toBe("function");
    expect(onProgressMock).toHaveBeenCalledWith(100);
  }, 5_000);
});
