#!/usr/bin/env tsx
/*
 * Blotch detection — scans extracted Game Boy Camera images (_gbcam.png)
 * for large connected components of the same non-BK color. Per the warp
 * knowledge-transfer plan, "large patches of the same non-BK color in the
 * output often indicate a warp error in that region" (size ~12×12 and up,
 * not always rectangular, may contain a few stray pixels of other colors).
 *
 * This is the self-feedback signal we use during warp iteration: after a
 * warp change, re-run extraction and run this script — every warp change
 * should reduce known problematic blotches without introducing new ones.
 *
 * Method: flood-fill connected components on the 128×112 grayscale image.
 * Two cells are connected (4-neighbours) if their grayscale values match
 * exactly. Components of values 82 (DG), 165 (LG), 255 (WH) are reported;
 * BK (0) is ignored because most images have large BK regions and they
 * aren't a warp-error signal.
 *
 * Usage:
 *   pnpm blotch -- <gbcam.png> [<gbcam.png> ...]
 *   pnpm blotch -- --dir <root>
 *   pnpm blotch -- --dir <root> --min-size 18
 *   pnpm blotch -- --dir <root> --json
 *   pnpm blotch -- --dir <root> --validate   # check vs plan's Round 7 list
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import sharp from "sharp";

const COLOR_NAMES: Record<number, string> = {
  0: "BK",
  82: "DG",
  165: "LG",
  255: "WH",
};

interface Blotch {
  color: number;
  colorName: string;
  area: number;
  bbox: { x: number; y: number; w: number; h: number };
  centroid: { x: number; y: number };
}

interface ImageResult {
  path: string;
  stem: string;
  width: number;
  height: number;
  blotches: Blotch[];
}

function snapToPalette(v: number): number {
  // Reference images sometimes have values slightly off the canonical
  // 0/82/165/255 due to PNG round-tripping; snap to nearest palette.
  const palette = [0, 82, 165, 255];
  let best = palette[0];
  let bestDist = Math.abs(v - best);
  for (let i = 1; i < palette.length; i++) {
    const d = Math.abs(v - palette[i]);
    if (d < bestDist) {
      best = palette[i];
      bestDist = d;
    }
  }
  return best;
}

async function loadGray(path: string): Promise<{ data: Uint8Array; w: number; h: number }> {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({
    resolveWithObject: true,
  });
  const w = info.width;
  const h = info.height;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = snapToPalette(data[i]);
  return { data: out, w, h };
}

/**
 * Box-erode a binary mask by the given radius (= kernel size (2r+1)²).
 * Pixels keep their on-value only if every pixel in their (2r+1)² box
 * is on. Edge pixels (where the box would extend outside the image)
 * are conservatively eroded off, since we can't verify the
 * out-of-bounds part. Used to break thin bridges between blotches and
 * to delete dithered single-pixel speckle.
 */
function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      if (mask[y * w + x] === 0) continue;
      let allOn = true;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        const row = (y + dy) * w;
        for (let dx = -radius; dx <= radius; dx++) {
          if (mask[row + x + dx] === 0) { allOn = false; break outer; }
        }
      }
      if (allOn) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * Box-dilate a binary mask by the given radius. A pixel turns on if
 * any pixel in its (2r+1)² box is on in the input. Used after erosion
 * to restore the blotch core's approximate original size.
 */
function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) { out[y * w + x] = 1; continue; }
      let any = false;
      const yLo = Math.max(0, y - radius);
      const yHi = Math.min(h - 1, y + radius);
      const xLo = Math.max(0, x - radius);
      const xHi = Math.min(w - 1, x + radius);
      outer: for (let yy = yLo; yy <= yHi; yy++) {
        const row = yy * w;
        for (let xx = xLo; xx <= xHi; xx++) {
          if (mask[row + xx] === 1) { any = true; break outer; }
        }
      }
      if (any) out[y * w + x] = 1;
    }
  }
  return out;
}

/**
 * 4-connected components of pixels where mask[i] === 1, returning bbox,
 * area, and centroid for each. Used after morphological opening of a
 * per-colour binary mask.
 */
function componentsOnMask(
  mask: Uint8Array,
  w: number,
  h: number,
  color: number,
): Blotch[] {
  const visited = new Uint8Array(w * h);
  const blotches: Blotch[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (visited[i] || mask[i] === 0) continue;
    stack.length = 0;
    stack.push(i);
    visited[i] = 1;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    let sumX = 0, sumY = 0, area = 0;
    while (stack.length > 0) {
      const k = stack.pop()!;
      const x = k % w;
      const y = (k - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      area++;
      if (x > 0) {
        const nk = k - 1;
        if (!visited[nk] && mask[nk] === 1) { visited[nk] = 1; stack.push(nk); }
      }
      if (x < w - 1) {
        const nk = k + 1;
        if (!visited[nk] && mask[nk] === 1) { visited[nk] = 1; stack.push(nk); }
      }
      if (y > 0) {
        const nk = k - w;
        if (!visited[nk] && mask[nk] === 1) { visited[nk] = 1; stack.push(nk); }
      }
      if (y < h - 1) {
        const nk = k + w;
        if (!visited[nk] && mask[nk] === 1) { visited[nk] = 1; stack.push(nk); }
      }
    }
    blotches.push({
      color,
      colorName: COLOR_NAMES[color] ?? `?${color}`,
      area,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      centroid: { x: sumX / area, y: sumY / area },
    });
  }
  return blotches;
}

/** Sort by area descending, biggest first. */
function rankBlotches(blotches: Blotch[]): Blotch[] {
  return blotches.slice().sort((a, b) => b.area - a.area);
}

/**
 * Detect blotches by morphological opening per colour then connected
 * components. Opening (= erode + dilate) breaks thin bridges and
 * deletes scattered single-pixel speckle that the user described
 * as "not blotches" (= dithered picture content). Connected
 * components on the opened mask each correspond to a single
 * solid-coloured region (= "almost entirely one color").
 *
 * Parameters chosen to match user's expected counts on the current
 * pipeline output (see plan's Round 7 + Round 9 sections):
 * - erodeRadius 3 (= 7x7 kernel): removes bridges thinner than 7 px
 *   and any clump smaller than 7x7 entirely. The "few stray pixels of
 *   a different color within" a blotch don't break the mask of the
 *   blotch's main colour, but dithered-edge picture content (where
 *   the colour appears in scattered tiny clumps) is wiped out.
 * - minArea 90 (= ~12x8 or ~10x10 final core): a 12x12 blotch survives
 *   7x7 opening as roughly 12x12; smaller mostly-solid regions get
 *   filtered out.
 */
async function analyse(
  path: string,
  erodeRadius: number,
  minArea: number,
): Promise<ImageResult> {
  const { data, w, h } = await loadGray(path);
  const all: Blotch[] = [];
  for (const color of [82, 165, 255]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (data[i] === color) mask[i] = 1;
    const eroded = erodeMask(mask, w, h, erodeRadius);
    const opened = dilateMask(eroded, w, h, erodeRadius);
    const comps = componentsOnMask(opened, w, h, color);
    for (const c of comps) if (c.area >= minArea) all.push(c);
  }
  return {
    path,
    stem: basename(path).replace(/_gbcam\.png$/, "").replace(/\.png$/, ""),
    width: w,
    height: h,
    blotches: rankBlotches(all),
  };
}

function fmtBlotch(b: Blotch): string {
  return `${b.colorName.padStart(2)} area=${String(b.area).padStart(5)} ` +
    `bbox=(${String(b.bbox.x).padStart(3)},${String(b.bbox.y).padStart(3)} ` +
    `${String(b.bbox.w).padStart(3)}×${String(b.bbox.h).padStart(3)}) ` +
    `centroid=(${b.centroid.x.toFixed(1).padStart(5)},${b.centroid.y.toFixed(1).padStart(5)})`;
}

function printResult(res: ImageResult): void {
  console.log(`\n=== ${res.stem} (${res.path}) ===`);
  if (res.blotches.length === 0) {
    console.log("  (no large non-BK blotches)");
    return;
  }
  console.log(`  ${res.blotches.length} blotch(es):`);
  for (const b of res.blotches) {
    console.log(`    ${fmtBlotch(b)}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Morphological-opening parameters tuned to match user's expected
  // blotch counts on the current pipeline output (see plan Round 10).
  // erodeRadius 3 = 7×7 kernel; thinner-than-7-px bridges and clumps
  // get wiped out (which is the user's definition of "thin bridges
  // connecting different areas don't count as one blotch", and also
  // removes dithered picture content). minArea 90 = ~10×10 post-open
  // region survives the filter.
  let erodeRadius = 3;
  let minArea = 350;
  let asJson = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      continue;
    } else if ((a === "--erode-radius" || a === "-r") && i + 1 < args.length) {
      erodeRadius = parseInt(args[++i], 10);
    } else if ((a === "--min-area" || a === "-a") && i + 1 < args.length) {
      minArea = parseInt(args[++i], 10);
    } else if (a === "--json") {
      asJson = true;
    } else if (a === "--dir" && i + 1 < args.length) {
      const dir = args[++i];
      const stack = [dir];
      while (stack.length) {
        const p = stack.pop()!;
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
          for (const e of readdirSync(p)) stack.push(join(p, e));
        } else if (p.endsWith("_gbcam.png")) {
          // Skip 8× upscaled and palette-rendered variants.
          if (!p.endsWith("_gbcam_8x.png") && !p.endsWith("_gbcam_rgb.png")) {
            paths.push(p);
          }
        }
      }
    } else if (a.startsWith("-")) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else {
      paths.push(resolve(a));
    }
  }
  if (paths.length === 0) {
    console.error(
      "Usage: tsx scripts/blotch-detection.ts [--erode-radius N] [--min-area N] [--json]\n" +
      "                                       <gbcam.png> [<gbcam.png> ...]\n" +
      "       tsx scripts/blotch-detection.ts --dir <root>",
    );
    process.exit(1);
  }
  paths.sort();

  const results: ImageResult[] = [];
  for (const p of paths) {
    try {
      const r = await analyse(p, erodeRadius, minArea);
      results.push(r);
    } catch (e) {
      console.error(`error processing ${p}: ${(e as Error).message}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`images: ${results.length}  (erodeRadius=${erodeRadius}, minArea=${minArea})`);
    for (const r of results) printResult(r);
    let total = 0;
    for (const r of results) total += r.blotches.length;
    console.log(`\n=== Aggregate ===`);
    console.log(`  ${total} blotch(es) across ${results.length} image(s)`);
  }
}

main();
