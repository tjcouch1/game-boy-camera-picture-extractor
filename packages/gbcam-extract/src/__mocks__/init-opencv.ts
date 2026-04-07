/**
 * Mock implementation of OpenCV initialization for testing. For some reason,
 * importing opencv-js via ESM imports in vitest causes the tests to hang
 * indefinitely, likely due to some strange interaction in the WASM
 * initialization process. This mock loads opencv-js via CommonJS require,
 * which works correctly in vitest for some reason
 *
 * This mock will be used in all tests due to the vitest setup file configuration.
 */

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
 * @param onProgress - Optional callback for progress updates (percentage 0-100)
 */
export async function initOpenCV(
  onProgress?: (percentage: number) => void,
): Promise<void> {
  if (cv) return;

  // Vitest - use require() to load @techstark/opencv-js
  // (ESM import hangs due to WASM initialization timing)
  try {
    const { createRequire } = await import("module");

    const require = createRequire(import.meta.url);

    // Use CommonJS require which works better with the WASM module initialization
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const cvModule = require("@techstark/opencv-js");

    // Support both Promise-based and callback-based APIs
    let loadedCV: any;
    if (cvModule instanceof Promise) {
      // Promise API - await the WASM initialization
      loadedCV = await cvModule;
    } else {
      // Callback API - wait for onRuntimeInitialized callback
      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => {
          resolve();
        };
      });
      loadedCV = cvModule;
    }

    cv = loadedCV;
    onProgress?.(100);
  } catch (err) {
    throw new Error(`Failed to load opencv-js in Node.js: ${err}`);
  }
}
