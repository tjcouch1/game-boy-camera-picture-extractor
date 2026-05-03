#!/usr/bin/env tsx
/*
 * Independently measure the dashes' BK-body centroid in a warp PNG, scanning
 * outward from the screen edges. Used to cross-check the in-pipeline dash
 * detector when the user reports a visual misalignment that the detector
 * doesn't show.
 *
 * Strategy: find connected components of BK-body pixels (gray < 50) within
 * a band along each edge of the warp output (rows 0-15 for top, etc., scaled
 * by 8). For each component, report its bounding box and centroid. We sort
 * the per-side components and print them so they can be compared to the
 * expected DASH_INTERIOR_*_Y/X values.
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { resolve } from "node:path";

const path = process.argv[2] ?? resolve(process.cwd(), "../../sample-pictures-out/20260328_165926_warp.png");

(async () => {
  const buf = readFileSync(path);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  // Convert to grayscale via simple Y = 0.299 R + 0.587 G + 0.114 B.
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Find connected dark (gray < 50) components, report side-by-side.
  const isDark = (r: number, c: number) => gray[r * W + c] < 80;
  const visited = new Uint8Array(W * H);
  const comps: Array<{ r1: number; r2: number; c1: number; c2: number; cx: number; cy: number; n: number }> = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (visited[r * W + c] || !isDark(r, c)) continue;
      const stack: [number, number][] = [[r, c]];
      let r1 = r, r2 = r, c1 = c, c2 = c, sx = 0, sy = 0, n = 0;
      while (stack.length) {
        const [rr, cc] = stack.pop()!;
        if (rr < 0 || rr >= H || cc < 0 || cc >= W || visited[rr * W + cc] || !isDark(rr, cc)) continue;
        visited[rr * W + cc] = 1;
        if (rr < r1) r1 = rr;
        if (rr > r2) r2 = rr;
        if (cc < c1) c1 = cc;
        if (cc > c2) c2 = cc;
        sx += cc + 0.5;
        sy += rr + 0.5;
        n++;
        stack.push([rr + 1, cc], [rr - 1, cc], [rr, cc + 1], [rr, cc - 1]);
      }
      if (n >= 20) comps.push({ r1, r2, c1, c2, cx: sx / n, cy: sy / n, n });
    }
  }

  // Side classification: side regions in the warp at scale=8 are
  // top: rows 0-127 (= 16*8 - 1), but real dashes only at rows 40-63
  // bot: rows 1088-1151 (last 8 GB rows)
  // left: cols 0-127, right: cols 1152-1279.
  // Filter further: dashes are within the screen frame at warp rows ~40-63 (top), 1088-1111 (bottom), and X-cols ~10-30 (left), 1250-1270 (right).
  const top: typeof comps = [];
  const bot: typeof comps = [];
  const lft: typeof comps = [];
  const rgt: typeof comps = [];
  for (const k of comps) {
    // Ignore the giant background-or-corner-fused components — typical
    // dashes are 30-100 px.
    if (k.n > 200) continue;
    if (k.cy < 80) top.push(k);
    else if (k.cy > 1056) bot.push(k);
    else if (k.cx < 80) lft.push(k);
    else if (k.cx > 1199) rgt.push(k);
  }
  const fmt = (k: { cx: number; cy: number; r1: number; r2: number; c1: number; c2: number; n: number }) =>
    `cx=${k.cx.toFixed(1)},cy=${k.cy.toFixed(1)} bbox=[c${k.c1}-${k.c2},r${k.r1}-${k.r2}] n=${k.n}`;
  console.log(`File: ${path}`);
  console.log(`size ${W}x${H}, total comps: ${comps.length}`);
  top.sort((a, b) => a.cx - b.cx);
  bot.sort((a, b) => a.cx - b.cx);
  lft.sort((a, b) => a.cy - b.cy);
  rgt.sort((a, b) => a.cy - b.cy);
  console.log("\nTOP dashes:");
  for (const k of top) console.log("  " + fmt(k));
  console.log("\nBOTTOM dashes:");
  for (const k of bot) console.log("  " + fmt(k));
  console.log("\nLEFT dashes:");
  for (const k of lft) console.log("  " + fmt(k));
  console.log("\nRIGHT dashes:");
  for (const k of rgt) console.log("  " + fmt(k));
})();
