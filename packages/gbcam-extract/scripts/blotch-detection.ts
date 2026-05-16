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

/** 4-connected component labelling. Only labels cells where pred(value) is true. */
function findComponents(
  data: Uint8Array,
  w: number,
  h: number,
  pred: (v: number) => boolean,
): Blotch[] {
  const visited = new Uint8Array(w * h);
  const blotches: Blotch[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (visited[i]) continue;
    const v = data[i];
    if (!pred(v)) {
      visited[i] = 1;
      continue;
    }
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
      // 4-neighbours
      if (x > 0) {
        const nk = k - 1;
        if (!visited[nk] && data[nk] === v) { visited[nk] = 1; stack.push(nk); }
      }
      if (x < w - 1) {
        const nk = k + 1;
        if (!visited[nk] && data[nk] === v) { visited[nk] = 1; stack.push(nk); }
      }
      if (y > 0) {
        const nk = k - w;
        if (!visited[nk] && data[nk] === v) { visited[nk] = 1; stack.push(nk); }
      }
      if (y < h - 1) {
        const nk = k + w;
        if (!visited[nk] && data[nk] === v) { visited[nk] = 1; stack.push(nk); }
      }
    }
    blotches.push({
      color: v,
      colorName: COLOR_NAMES[v] ?? `?${v}`,
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

async function analyse(
  path: string, minSize: number, minArea: number,
): Promise<ImageResult> {
  const { data, w, h } = await loadGray(path);
  // Ignore BK (0). Detect DG/LG/WH connected components.
  const all = findComponents(data, w, h, (v) => v !== 0);
  // Keep only "large" components: bbox sides >= minSize OR area >= minArea.
  // Plan says "size ~12×12 and up", so default minSize = 12 (square edge)
  // and minArea = 12*12 = 144 px. Either criterion qualifies because real
  // blotches are often elongated or irregular.
  const big = all.filter(
    (b) => (b.bbox.w >= minSize && b.bbox.h >= minSize) || b.area >= minArea,
  );
  return {
    path,
    stem: basename(path).replace(/_gbcam\.png$/, "").replace(/\.png$/, ""),
    width: w,
    height: h,
    blotches: rankBlotches(big),
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

// ─── Validation against the plan's Round 7 user-confirmed list ───
// Each entry is keyed by stem. The user described regions in words; we
// translate to approximate bounding regions and a color, then check that
// our detector identifies a blotch of that color whose centroid sits
// inside the region. Loose matching — we just want to confirm the
// detector picks up what the user saw, not pixel-exact agreement.
//
// Image dimensions: 128 × 112.
interface ExpectedBlotch {
  color: number;
  /** Approximate region the user described as "where the blotch is". */
  region: { x0: number; y0: number; x1: number; y1: number };
  /** Human-readable description from the plan. */
  description: string;
}
interface ExpectedSet {
  // Each stem maps to a list of expected blotches.
  [stem: string]: ExpectedBlotch[];
}

// Current-HEAD expectations from the plan's Round 7 / blotch list.
const EXPECTED_CURRENT_HEAD: ExpectedSet = {
  "20260313_213443": [
    {
      color: 165,
      region: { x0: 0, y0: 0, x1: 70, y1: 50 },
      description: "large LG patch upper left",
    },
  ],
  "20260313_213457": [
    {
      color: 165,
      region: { x0: 25, y0: 0, x1: 95, y1: 50 },
      description: "large LG patch upper middle",
    },
  ],
  "20260328_165926": [
    {
      color: 82,
      region: { x0: 0, y0: 55, x1: 80, y1: 112 },
      description: "large DG patch bottom-left through center",
    },
  ],
  "20260328_165926~2-EDIT": [
    {
      color: 82,
      region: { x0: 0, y0: 55, x1: 80, y1: 112 },
      description: "large DG patch bottom-left through center",
    },
  ],
};

// 53017be expectations from the plan's Round 7 / blotch list.
const EXPECTED_53017BE: ExpectedSet = {
  "20260313_213443": [
    {
      color: 82,
      region: { x0: 0, y0: 0, x1: 50, y1: 45 },
      description: "large DG patch upper left",
    },
    {
      color: 165,
      region: { x0: 30, y0: 0, x1: 100, y1: 45 },
      description: "large LG patch right of DG (upper)",
    },
  ],
  "20260313_213457": [
    {
      color: 165,
      region: { x0: 0, y0: 0, x1: 50, y1: 45 },
      description: "large LG patch upper left",
    },
    {
      color: 165,
      region: { x0: 12, y0: 0, x1: 100, y1: 45 },
      description: "smaller LG patch right of it",
    },
  ],
  "20260328_165926": [
    {
      color: 255,
      region: { x0: 0, y0: 55, x1: 70, y1: 112 },
      description: "lots of WH in bottom-left (should be LG)",
    },
  ],
};

function containsCentroid(
  region: ExpectedBlotch["region"], c: { x: number; y: number },
): boolean {
  return c.x >= region.x0 && c.x <= region.x1 && c.y >= region.y0 && c.y <= region.y1;
}

function validate(
  results: ImageResult[], expected: ExpectedSet, label: string,
): void {
  console.log(`\n=== Validation against ${label} ===`);
  let totalExpected = 0;
  let totalFound = 0;
  for (const [stem, expectedList] of Object.entries(expected)) {
    const res = results.find((r) => r.stem === stem);
    if (!res) {
      console.log(`  [SKIP] ${stem} — no detection result for this stem`);
      continue;
    }
    for (const exp of expectedList) {
      totalExpected++;
      const matchingBlotch = res.blotches.find(
        (b) => b.color === exp.color && containsCentroid(exp.region, b.centroid),
      );
      if (matchingBlotch) {
        totalFound++;
        console.log(
          `  [OK]  ${stem}: ${exp.description} — found ${matchingBlotch.colorName} ` +
            `area=${matchingBlotch.area} at (${matchingBlotch.centroid.x.toFixed(1)},` +
            `${matchingBlotch.centroid.y.toFixed(1)})`,
        );
      } else {
        console.log(
          `  [MISS] ${stem}: ${exp.description} — no ${COLOR_NAMES[exp.color]} blotch ` +
            `centroid in (${exp.region.x0},${exp.region.y0})..(${exp.region.x1},${exp.region.y1})`,
        );
        if (res.blotches.length > 0) {
          console.log(`        candidates seen for this image:`);
          for (const b of res.blotches) console.log(`          ${fmtBlotch(b)}`);
        }
      }
    }
  }
  console.log(`  → ${totalFound}/${totalExpected} expected blotches matched`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let minSize = 12;
  let minArea = 144;
  let asJson = false;
  let runValidation = false;
  let validationSet: "current" | "53017be" | "auto" = "auto";
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      continue;
    } else if ((a === "--min-size" || a === "-s") && i + 1 < args.length) {
      minSize = parseInt(args[++i], 10);
    } else if ((a === "--min-area" || a === "-a") && i + 1 < args.length) {
      minArea = parseInt(args[++i], 10);
    } else if (a === "--json") {
      asJson = true;
    } else if (a === "--validate") {
      runValidation = true;
    } else if (a === "--validate-current") {
      runValidation = true;
      validationSet = "current";
    } else if (a === "--validate-53017be") {
      runValidation = true;
      validationSet = "53017be";
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
      "Usage: tsx scripts/blotch-detection.ts [--min-size N] [--min-area N] [--json] [--validate]\n" +
      "                                       <gbcam.png> [<gbcam.png> ...]\n" +
      "       tsx scripts/blotch-detection.ts --dir <root>",
    );
    process.exit(1);
  }
  paths.sort();

  const results: ImageResult[] = [];
  for (const p of paths) {
    try {
      const r = await analyse(p, minSize, minArea);
      results.push(r);
    } catch (e) {
      console.error(`error processing ${p}: ${(e as Error).message}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`images: ${results.length}  (min-size=${minSize}, min-area=${minArea})`);
    for (const r of results) printResult(r);
    let total = 0;
    for (const r of results) total += r.blotches.length;
    console.log(`\n=== Aggregate ===`);
    console.log(`  ${total} blotch(es) across ${results.length} image(s)`);
  }

  if (runValidation) {
    if (validationSet === "auto") {
      // Auto-detect: if any path is under sample-pictures-out-53017be, validate against 53017be set;
      // otherwise validate against current-HEAD set.
      const is53 = paths.some((p) => p.replace(/\\/g, "/").includes("sample-pictures-out-53017be"));
      validationSet = is53 ? "53017be" : "current";
    }
    if (validationSet === "53017be") validate(results, EXPECTED_53017BE, "53017be expected blotches");
    else validate(results, EXPECTED_CURRENT_HEAD, "current-HEAD expected blotches");
  }
}

main();
