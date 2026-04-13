import type { PipelineResult, GBImageData } from "gbcam-extract";

/**
 * Serialized form of GBImageData using base64 encoding for efficiency.
 * Base64 adds ~33% overhead vs ~300%+ for plain JSON object representation.
 */
export interface SerializedGBImageData {
  _type: "GBImageData";
  width: number;
  height: number;
  data: string; // base64-encoded Uint8ClampedArray
}

/**
 * Serialized form of PipelineResult.
 */
export interface SerializedPipelineResult {
  _type: "PipelineResult";
  grayscale: SerializedGBImageData;
  intermediates?: {
    warp: SerializedGBImageData;
    correct: SerializedGBImageData;
    crop: SerializedGBImageData;
    sample: SerializedGBImageData;
  };
}

/**
 * Serialize a GBImageData to a compact base64 representation.
 * @returns Serialized object with width, height, and base64-encoded data
 */
export function serializeGBImageData(
  img: GBImageData,
): SerializedGBImageData {
  // Convert Uint8ClampedArray to base64
  const binaryString = String.fromCharCode.apply(null, Array.from(img.data));
  const base64Data = btoa(binaryString);

  return {
    _type: "GBImageData",
    width: img.width,
    height: img.height,
    data: base64Data,
  };
}

/**
 * Deserialize a GBImageData from base64 representation.
 * @returns Reconstructed GBImageData with proper Uint8ClampedArray
 */
export function deserializeGBImageData(
  serialized: SerializedGBImageData,
): GBImageData {
  // Decode base64 to binary string
  const binaryString = atob(serialized.data);

  // Convert binary string to Uint8ClampedArray
  const data = new Uint8ClampedArray(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    data[i] = binaryString.charCodeAt(i);
  }

  return {
    width: serialized.width,
    height: serialized.height,
    data,
  };
}

/**
 * Serialize a PipelineResult to a compact JSON-friendly form.
 */
export function serializePipelineResult(
  result: PipelineResult,
): SerializedPipelineResult {
  const serialized: SerializedPipelineResult = {
    _type: "PipelineResult",
    grayscale: serializeGBImageData(result.grayscale),
  };

  if (result.intermediates) {
    serialized.intermediates = {
      warp: serializeGBImageData(result.intermediates.warp),
      correct: serializeGBImageData(result.intermediates.correct),
      crop: serializeGBImageData(result.intermediates.crop),
      sample: serializeGBImageData(result.intermediates.sample),
    };
  }

  return serialized;
}

/**
 * Deserialize a PipelineResult from JSON form.
 */
export function deserializePipelineResult(
  serialized: SerializedPipelineResult,
): PipelineResult {
  const result: PipelineResult = {
    grayscale: deserializeGBImageData(serialized.grayscale),
  };

  if (serialized.intermediates) {
    result.intermediates = {
      warp: deserializeGBImageData(serialized.intermediates.warp),
      correct: deserializeGBImageData(serialized.intermediates.correct),
      crop: deserializeGBImageData(serialized.intermediates.crop),
      sample: deserializeGBImageData(serialized.intermediates.sample),
    };
  }

  return result;
}

/**
 * Type guard to check if an object is a SerializedPipelineResult.
 */
export function isSerializedPipelineResult(
  obj: any,
): obj is SerializedPipelineResult {
  return (
    obj &&
    typeof obj === "object" &&
    obj._type === "PipelineResult" &&
    obj.grayscale &&
    obj.grayscale._type === "GBImageData"
  );
}

/**
 * Type guard to check if an object is a SerializedGBImageData.
 */
export function isSerializedGBImageData(
  obj: any,
): obj is SerializedGBImageData {
  return (
    obj &&
    typeof obj === "object" &&
    obj._type === "GBImageData" &&
    typeof obj.width === "number" &&
    typeof obj.height === "number" &&
    typeof obj.data === "string"
  );
}
