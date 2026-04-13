import type { PipelineResult, GBImageData } from "gbcam-extract";

/**
 * Reconstruct a GBImageData object from a deserialized form.
 * When GBImageData is serialized to JSON, the Uint8ClampedArray becomes a plain object.
 * This function converts it back to a proper Uint8ClampedArray.
 */
export function reconstructGBImageData(
  serialized: any,
): GBImageData | null {
  if (!serialized || typeof serialized !== "object") {
    return null;
  }

  const { data, width, height } = serialized;

  // Validate required fields
  if (typeof width !== "number" || typeof height !== "number") {
    return null;
  }

  // If data is already a Uint8ClampedArray, return as-is
  if (data instanceof Uint8ClampedArray) {
    return { data, width, height };
  }

  // If data is a plain object (from JSON serialization), reconstruct the array
  if (typeof data === "object" && data !== null) {
    const expectedLength = width * height * 4;
    const reconstructed = new Uint8ClampedArray(expectedLength);

    // Try to fill from object keys
    for (let i = 0; i < expectedLength; i++) {
      const value = data[i];
      if (typeof value === "number") {
        reconstructed[i] = value;
      }
    }

    // Validate we got data
    if (reconstructed.some((v) => v !== 0)) {
      return { data: reconstructed, width, height };
    }
  }

  return null;
}

/**
 * Reconstruct a PipelineResult from a deserialized form.
 * Properly reconstructs all GBImageData arrays including intermediates.
 */
export function reconstructPipelineResult(
  serialized: any,
): PipelineResult | null {
  if (!serialized || typeof serialized !== "object") {
    return null;
  }

  const grayscaleData = reconstructGBImageData(serialized.grayscale);
  if (!grayscaleData) {
    return null;
  }

  const result: PipelineResult = {
    grayscale: grayscaleData,
  };

  // Reconstruct intermediates if present
  if (serialized.intermediates && typeof serialized.intermediates === "object") {
    const intermediates: Record<string, GBImageData> = {};
    for (const [key, value] of Object.entries(serialized.intermediates)) {
      const reconstructed = reconstructGBImageData(value);
      if (reconstructed) {
        intermediates[key] = reconstructed;
      }
    }
    if (Object.keys(intermediates).length > 0) {
      result.intermediates = intermediates as any;
    }
  }

  return result;
}
