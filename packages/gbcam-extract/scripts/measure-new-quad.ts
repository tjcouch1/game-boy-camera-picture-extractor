#!/usr/bin/env tsx
// Measure WH% inside the user quadrilateral on the new image's gbcam output.
// Quad vertices (in 128x112 GB-pixel space): (43,81), (84,81), (75,111), (51,111).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";

const pngPath = process.argv[2] ??
  resolve(process.cwd(), "../../sample-pictures-out/20260328_165926_gbcam.png");

const png = PNG.sync.read(readFileSync(pngPath));
const { width, height, data } = png;
if (width !== 128 || height !== 112) {
  console.error(`Expected 128x112, got ${width}x${height}`);
  process.exit(1);
}

const verts: [number, number][] = [
  [43, 81], [84, 81], [75, 111], [51, 111],
];

function inside(x: number, y: number): boolean {
  // Ray casting (point-in-polygon).
  let c = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) c = !c;
  }
  return c;
}

let total = 0;
let wh = 0;
const counts: Record<string, number> = { "0": 0, "82": 0, "165": 0, "255": 0, other: 0 };
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (!inside(x + 0.5, y + 0.5)) continue;
    total++;
    const v = data[(y * width + x) * 4];
    if (v === 255) wh++;
    if (v === 0 || v === 82 || v === 165 || v === 255) counts[String(v)]++;
    else counts.other++;
  }
}
const pct = (100 * wh) / total;
console.log(`quadPixels=${total} WH=${wh} WH%=${pct.toFixed(1)}% counts=${JSON.stringify(counts)}`);
