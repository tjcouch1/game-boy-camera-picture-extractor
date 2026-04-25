import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GBImageData } from "../../src/common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadImage(filePath: string): Promise<GBImageData> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

export function repoRoot(...segments: string[]): string {
  // From packages/gbcam-extract/tests/helpers/ -> repo root is 4 levels up
  return resolve(__dirname, "..", "..", "..", "..", ...segments);
}
