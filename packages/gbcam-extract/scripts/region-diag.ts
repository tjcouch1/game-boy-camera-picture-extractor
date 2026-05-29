/**
 * Regional uniformity diagnostic.
 *
 * For each test, divides the corrected camera area into a 4x4 grid and reports
 * per-region mean R/G/B for each palette class (using reference labels).
 *
 * This exposes whether the correct step leaves spatial non-uniformity that
 * forces downstream steps to use empirical/local clusters instead of trusting
 * fixed palette targets.
 */
import * as path from "node:path";
import sharp from "sharp";

const TESTS = [
  "bathhouse-1",
  "park-1",
  "thing-1",
  "thing-2",
  "thing-3",
  "zelda-poster-1",
  "zelda-poster-2",
  "zelda-poster-3",
];

const REF_MAP: Record<string, string> = {
  "thing-1": "thing-output-corrected.png",
  "thing-2": "thing-output-corrected.png",
  "thing-3": "thing-output-corrected.png",
  "zelda-poster-1": "zelda-poster-output-corrected.png",
  "zelda-poster-2": "zelda-poster-output-corrected.png",
  "zelda-poster-3": "zelda-poster-output-corrected.png",
  "park-1": "park-output-corrected.png",
  "bathhouse-1": "bathhouse-output-corrected.png",
};

const PALETTE_LABEL: Record<number, string> = {
  0: "BK",
  82: "DG",
  165: "LG",
  255: "WH",
};

const PALETTE_TARGET_RGB: Record<string, [number, number, number]> = {
  BK: [0, 0, 0],
  DG: [148, 148, 255],
  LG: [255, 148, 148],
  WH: [255, 255, 165],
};

async function loadPNG(p: string) {
  const { data, info } = await sharp(p)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const root = path.resolve(import.meta.dirname, "..", "..", "..");

// Grid divisions for spatial analysis
const GRID_W = 4;
const GRID_H = 4;
const CAM_W = 128;
const CAM_H = 112;

for (const name of TESTS) {
  const refPath = path.join(root, "test-input", REF_MAP[name]);
  const samplePath = path.join(
    root,
    "test-output",
    name,
    "debug",
    `${name}_sample.png`,
  );

  let ref;
  let sample;
  try {
    ref = await loadPNG(refPath);
    sample = await loadPNG(samplePath);
  } catch (e) {
    console.log(`SKIP ${name}: ${(e as Error).message}`);
    continue;
  }

  console.log(`\n=== ${name} ===`);
  console.log(
    `  Sample is 128x112 RGBA, each pixel = the per-channel brightness landed`,
  );
  console.log(
    `  Targets: BK=(0,0,0) DG=(148,148,255) LG=(255,148,148) WH=(255,255,165)`,
  );

  // For each grid cell, for each class, collect RGB samples
  for (const cls of ["BK", "DG", "LG", "WH"]) {
    const grayVal = Object.keys(PALETTE_LABEL).find(
      (k) => PALETTE_LABEL[Number(k)] === cls,
    );
    if (grayVal == null) continue;
    const gv = Number(grayVal);
    const [tgtR, tgtG, tgtB] = PALETTE_TARGET_RGB[cls];

    // Compute mean per grid cell
    const cellMeans: Array<{
      r: number;
      g: number;
      b: number;
      n: number;
      gy: number;
      gx: number;
    }> = [];

    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const y0 = Math.floor((gy * CAM_H) / GRID_H);
        const y1 = Math.floor(((gy + 1) * CAM_H) / GRID_H);
        const x0 = Math.floor((gx * CAM_W) / GRID_W);
        const x1 = Math.floor(((gx + 1) * CAM_W) / GRID_W);
        let sR = 0,
          sG = 0,
          sB = 0,
          n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const o = (y * CAM_W + x) * 4;
            if (ref.data[o] === gv) {
              sR += sample.data[o];
              sG += sample.data[o + 1];
              sB += sample.data[o + 2];
              n++;
            }
          }
        }
        if (n >= 3) {
          cellMeans.push({
            r: sR / n,
            g: sG / n,
            b: sB / n,
            n,
            gy,
            gx,
          });
        }
      }
    }

    if (cellMeans.length === 0) continue;

    // Stats over cell means
    const meanR =
      cellMeans.reduce((a, c) => a + c.r, 0) / cellMeans.length;
    const meanG =
      cellMeans.reduce((a, c) => a + c.g, 0) / cellMeans.length;
    const meanB =
      cellMeans.reduce((a, c) => a + c.b, 0) / cellMeans.length;
    const minR = Math.min(...cellMeans.map((c) => c.r));
    const maxR = Math.max(...cellMeans.map((c) => c.r));
    const minG = Math.min(...cellMeans.map((c) => c.g));
    const maxG = Math.max(...cellMeans.map((c) => c.g));
    const minB = Math.min(...cellMeans.map((c) => c.b));
    const maxB = Math.max(...cellMeans.map((c) => c.b));

    console.log(
      `  ${cls} (target R${tgtR} G${tgtG} B${tgtB}, ${cellMeans.length}/${GRID_W * GRID_H} cells):`,
    );
    console.log(
      `    mean R=${meanR.toFixed(0)} (${minR.toFixed(0)}–${maxR.toFixed(0)}, spread ${(maxR - minR).toFixed(0)})  ` +
        `G=${meanG.toFixed(0)} (${minG.toFixed(0)}–${maxG.toFixed(0)}, spread ${(maxG - minG).toFixed(0)})  ` +
        `B=${meanB.toFixed(0)} (${minB.toFixed(0)}–${maxB.toFixed(0)}, spread ${(maxB - minB).toFixed(0)})`,
    );
  }
}
