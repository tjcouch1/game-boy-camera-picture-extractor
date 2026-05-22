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
import { readdirSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import sharp from "sharp";

export const BLOTCH_COLOR_NAMES: Record<number, string> = {
  0: "BK",
  82: "DG",
  165: "LG",
  255: "WH",
};

const COLOR_NAMES = BLOTCH_COLOR_NAMES;

/** Default morphological-opening + size parameters tuned to match the
 *  user's manual blotch identification on the current sample-pictures
 *  output: catches every blotch the user flagged (12-22 px wide solid
 *  patches) without picking up the per-pixel dithered content. See
 *  Round 13 in the plan for the parameter sweep. */
export const BLOTCH_DEFAULT_ERODE_RADIUS = 4;
export const BLOTCH_DEFAULT_MIN_AREA = 220;

export interface Blotch {
  color: number;
  colorName: string;
  area: number;
  bbox: { x: number; y: number; w: number; h: number };
  centroid: { x: number; y: number };
  /** Pixel mask of the same dimensions as the input image: 1 where this
   *  blotch's post-opening pixels live, 0 elsewhere. Used by the overlay
   *  renderer to draw the actual blotch boundary rather than just the
   *  axis-aligned bbox. */
  mask: Uint8Array;
  /** Image width that `mask` is sized against. */
  maskWidth: number;
}

export interface ImageResult {
  path: string;
  stem: string;
  width: number;
  height: number;
  blotches: Blotch[];
}

export function snapToPalette(v: number): number {
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

export async function loadGray(path: string): Promise<{ data: Uint8Array; w: number; h: number }> {
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
 * area, centroid, and per-component pixel mask for each. The mask is
 * what the overlay renderer uses to draw the actual blotch contour
 * (vs the axis-aligned bbox).
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
    const compMask = new Uint8Array(w * h);
    let minX = w, maxX = -1, minY = h, maxY = -1;
    let sumX = 0, sumY = 0, area = 0;
    while (stack.length > 0) {
      const k = stack.pop()!;
      compMask[k] = 1;
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
      mask: compMask,
      maskWidth: w,
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
 * Parameters chosen to match user's manual identification on the
 * current sample-pictures-out and test-output, including two small
 * warp-error blotches that needed the more sensitive defaults (Round
 * 13: 213443 upper-left LG ≈ 18×22 px, 213457 middle-left WH ≈ 16×15
 * px). At erodeRadius=4 minArea=220 these survive while dithered
 * picture content remains filtered out across the suite.
 */
export function detectBlotches(
  data: Uint8Array,
  w: number,
  h: number,
  opts: { erodeRadius?: number; minArea?: number } = {},
): Blotch[] {
  const erodeRadius = opts.erodeRadius ?? BLOTCH_DEFAULT_ERODE_RADIUS;
  const minArea = opts.minArea ?? BLOTCH_DEFAULT_MIN_AREA;
  const all: Blotch[] = [];
  for (const color of [82, 165, 255]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (data[i] === color) mask[i] = 1;
    const eroded = erodeMask(mask, w, h, erodeRadius);
    const opened = dilateMask(eroded, w, h, erodeRadius);
    const comps = componentsOnMask(opened, w, h, color);
    for (const c of comps) if (c.area >= minArea) all.push(c);
  }
  return rankBlotches(all);
}

async function analyse(
  path: string,
  erodeRadius: number,
  minArea: number,
): Promise<ImageResult> {
  const { data, w, h } = await loadGray(path);
  return {
    path,
    stem: basename(path).replace(/_gbcam\.png$/, "").replace(/\.png$/, ""),
    width: w,
    height: h,
    blotches: detectBlotches(data, w, h, { erodeRadius, minArea }),
  };
}

/**
 * Render a debug overlay PNG showing the detected blotches outlined on
 * the upscaled gbcam image. Each blotch's actual pixel boundary is
 * traced with a 1-px ring in a contrasting color (= bright red),
 * making the boundary of the blotch immediately legible against the
 * 4-colour gbcam palette. The image is upscaled by `scale` (default 8)
 * so the 128×112 gbcam becomes a 1024×896 PNG that's easy to inspect.
 *
 * Returns RGBA Uint8Array of size 4 * (w*scale) * (h*scale).
 */
export function renderBlotchOverlay(
  grayData: Uint8Array,
  w: number,
  h: number,
  blotches: Blotch[],
  scale: number = 8,
): { rgba: Uint8Array; width: number; height: number } {
  const palette: Record<number, [number, number, number]> = {
    0: [0, 0, 0],
    82: [148, 148, 255],
    165: [255, 148, 148],
    255: [255, 255, 165],
  };
  const outW = w * scale;
  const outH = h * scale;
  const rgba = new Uint8Array(outW * outH * 4);

  // 1. Render the base image (= 8× upscaled gbcam, palette-colored).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = grayData[y * w + x];
      const [r, g, b] = palette[v] ?? [128, 128, 128];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const oi = ((y * scale + dy) * outW + (x * scale + dx)) * 4;
          rgba[oi] = r;
          rgba[oi + 1] = g;
          rgba[oi + 2] = b;
          rgba[oi + 3] = 255;
        }
      }
    }
  }

  // 2. For each blotch, trace its 1-pixel-thick boundary on the
  // upscaled image. Boundary = blotch pixels that have at least one
  // 4-neighbour outside the blotch. Stroke colour: bright green —
  // none of the four GB palette colours (BK, DG-blue, LG-pink, WH-
  // yellow) are close to pure green, so the outline stays
  // unambiguously visible against any of them.
  // Stroke thickness: 2 image-px on the upscaled output, so each
  // boundary GB-pixel paints a 2×(scale+2) ring inside its 8×8 block.
  const strokeR = 0;
  const strokeG = 255;
  const strokeB = 0;
  for (const b of blotches) {
    const m = b.mask;
    const mw = b.maskWidth;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (m[y * mw + x] === 0) continue;
        // Is this pixel on the boundary? (any 4-neighbour outside)
        const leftOut = x === 0 || m[y * mw + (x - 1)] === 0;
        const rightOut = x === mw - 1 || m[y * mw + (x + 1)] === 0;
        const topOut = y === 0 || m[(y - 1) * mw + x] === 0;
        const botOut = y === h - 1 || m[(y + 1) * mw + x] === 0;
        if (!leftOut && !rightOut && !topOut && !botOut) continue;
        // Paint the 8×8 block's outer ring on the upscaled image,
        // 2-px-thick on whichever sides are boundary edges.
        const px0 = x * scale;
        const py0 = y * scale;
        const paint = (sx: number, sy: number) => {
          const oi = (sy * outW + sx) * 4;
          rgba[oi] = strokeR;
          rgba[oi + 1] = strokeG;
          rgba[oi + 2] = strokeB;
          rgba[oi + 3] = 255;
        };
        if (topOut) {
          for (let dx = 0; dx < scale; dx++) {
            paint(px0 + dx, py0);
            paint(px0 + dx, py0 + 1);
          }
        }
        if (botOut) {
          for (let dx = 0; dx < scale; dx++) {
            paint(px0 + dx, py0 + scale - 1);
            paint(px0 + dx, py0 + scale - 2);
          }
        }
        if (leftOut) {
          for (let dy = 0; dy < scale; dy++) {
            paint(px0, py0 + dy);
            paint(px0 + 1, py0 + dy);
          }
        }
        if (rightOut) {
          for (let dy = 0; dy < scale; dy++) {
            paint(px0 + scale - 1, py0 + dy);
            paint(px0 + scale - 2, py0 + dy);
          }
        }
      }
    }
  }

  return { rgba, width: outW, height: outH };
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

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  let erodeRadius = BLOTCH_DEFAULT_ERODE_RADIUS;
  let minArea = BLOTCH_DEFAULT_MIN_AREA;
  let asJson = false;
  let overlay = false;
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
    } else if (a === "--overlay") {
      overlay = true;
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
      "Usage: pnpm blotch -- [--erode-radius N] [--min-area N] [--json] [--overlay]\n" +
      "                     <gbcam.png> [<gbcam.png> ...]\n" +
      "       pnpm blotch -- --dir <root> [--overlay]\n" +
      "\n" +
      "  --overlay  write <stem>_gbcam_blotches.png next to each input image\n" +
      "             with detected blotches outlined.",
    );
    process.exit(1);
  }
  paths.sort();

  const results: ImageResult[] = [];
  for (const p of paths) {
    try {
      const r = await analyse(p, erodeRadius, minArea);
      results.push(r);
      if (overlay) {
        const { data: grayData, w, h } = await loadGray(p);
        const { rgba, width, height } = renderBlotchOverlay(grayData, w, h, r.blotches);
        const outPath = p.replace(/_gbcam\.png$/, "_gbcam_blotches.png");
        await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
          raw: { width, height, channels: 4 },
        })
          .png()
          .toFile(outPath);
      }
    } catch (e) {
      console.error(`error processing ${p}: ${(e as Error).message}`);
    }
  }

  if (asJson) {
    // JSON serialisation drops the Uint8Array masks — they're useful
    // only for the overlay step and would explode the output size.
    const trimmed = results.map((r) => ({
      ...r,
      blotches: r.blotches.map(({ mask: _m, maskWidth: _mw, ...rest }) => rest),
    }));
    console.log(JSON.stringify(trimmed, null, 2));
  } else {
    console.log(`images: ${results.length}  (erodeRadius=${erodeRadius}, minArea=${minArea})`);
    for (const r of results) printResult(r);
    let total = 0;
    for (const r of results) total += r.blotches.length;
    console.log(`\n=== Aggregate ===`);
    console.log(`  ${total} blotch(es) across ${results.length} image(s)`);
  }
}
