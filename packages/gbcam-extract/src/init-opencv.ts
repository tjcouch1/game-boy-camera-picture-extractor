import cvModule from "@techstark/opencv-js";

let cv: any = null;

export function getCV(): any {
  if (!cv) {
    throw new Error(
      "OpenCV not initialized. Call initOpenCV() before using pipeline functions.",
    );
  }
  return cv;
}

/**
 * Initialize OpenCV for use in the pipeline.
 *
 * Works in both Node.js and browser environments.
 *
 * Verified in Node.js with `pnpm run test:opencv-init-node`
 *
 * Verified in browser with at https://stackblitz.com/edit/ocavue-opencvjs-ewb71azg?file=main.ts,opencv.ts,tsconfig.json,init-opencv.ts
 *
 * Note: this does not work in Vitest but hangs vitest
 * indefinitely. See `src/__mocks__/init-opencv.ts` for a
 * method to import OpenCV in Vitest that works. It is already
 * configured to be used in all tests via `vitest.setup.ts`.
 *
 * @param onProgress - Optional callback for progress updates (percentage 0-100)
 */
export async function initOpenCV(
  onProgress?: (percentage: number) => void,
): Promise<void> {
  if (cv) return;

  try {
    if (cvModule instanceof Promise) {
      cv = await cvModule;
    } else {
      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve();
      });
      cv = cvModule;
    }
    onProgress?.(100);
  } catch (e) {
    throw new Error(
      `Failed to initialize opencv-js: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
