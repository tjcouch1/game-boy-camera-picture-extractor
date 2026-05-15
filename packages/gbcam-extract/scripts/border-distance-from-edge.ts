#!/usr/bin/env tsx
/*
 * Inner-border-position harness — measures the WH-frame→DG-inner-border
 * threshold crossing on each side of a warp PNG and reports its distance
 * from the screen edge. Mirrors dash-distance-from-edge.ts in style.
 *
 * The DG inner border sits at GB-pixel boundary (15..16) on top/left and
 * (143..144) on bottom/right. Its OUTER edge (= the WH-frame side) is the
 * cleanest threshold crossing; we measure that.
 *
 * Canonical OUTER-edge distances per side (image-px at scale=8):
 *   - TOP:    120  (= row 15 boundary; outer = row 120)
 *   - BOTTOM: 120  (= row 128 boundary outer side; 1152 - 1032 = 120)
 *   - LEFT:   120
 *   - RIGHT:  120  (= col 144 boundary outer side; 1280 - 1160 = 120)
 *
 * Per-side scan: 17 evenly-spaced points along each side, far enough from
 * the corner that the corner artifacts don't pollute. Reports per-image
 * and aggregate mean/max/distribution.
 *
 * Usage:
 *   tsx scripts/border-distance-from-edge.ts <warp.png> [<warp.png> ...]
 *   tsx scripts/border-distance-from-edge.ts --dir <root>
 *   tsx scripts/border-distance-from-edge.ts --verbose <warp.png>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import sharp from "sharp";

const SCALE = 8;
const SCREEN_W = 160 * SCALE; // 1280
const SCREEN_H = 144 * SCALE; // 1152

// Canonical OUTER-edge distances from the screen edge (image-px).
// Top:    INNER_TOP=15 → outer-edge at row 15 boundary = y=120
// Bottom: INNER_BOT=128 → outer-edge at (128+1) boundary = y=1032; 1152-1032=120
// Left:   INNER_LEFT=15 → outer-edge col 15 boundary = x=120
// Right:  INNER_RIGHT=144 → outer-edge at (144+1) boundary = x=1160; 1280-1160=120
const CANONICAL_DIST = {
  top: 120,
  bottom: 120,
  left: 120,
  right: 120,
} as const;

// Sample positions (in image-px) along each side. Pick interior positions
// that avoid corner artifacts (= ~6 GB-pixels from each end).
const N_SAMPLES = 17;
function linspace(start: number, end: number, n: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(start + (end - start) * i / (n - 1));
  return arr;
}
const TOP_BOTTOM_SAMPLE_X = linspace(20 * SCALE, 140 * SCALE, N_SAMPLES);
const LEFT_RIGHT_SAMPLE_Y = linspace(20 * SCALE, 124 * SCALE, N_SAMPLES);

type Side = "top" | "bottom" | "left" | "right";

interface BorderMeasurement {
  side: Side;
  longAxis: number;
  outerCrossing: number | null;
  distFromEdge: number | null;
  bias: number | null;
}

interface ImageSummary {
  path: string;
  measurements: BorderMeasurement[];
  perSide: Record<Side, { count: number; meanBias: number; maxAbsBias: number; meanDist: number }>;
}

function makeGray(data: Buffer, W: number, H: number, channels: number): Float32Array {
  // DG-signature channel: clip(2B - R - G, 0, 255). DG (148, 148, 255) →
  // 214; WH (255, 255, 165) → -180 → 0; BK/LG → 0. Much more selective
  // than gray for finding the actual DG inner border (the gray-channel
  // approach picks up camera→dim-WH transitions instead in cases where
  // the WH frame is dim at corners — e.g., 165926 top-left).
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    const v = 2 * b - r - g;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

function meansAlong(
  chan: Float32Array, W: number,
  axis: "row" | "col", a1: number, a2: number, b1: number, b2: number,
): Float64Array {
  // For axis="row": output[i] = mean over cols b1..b2 of chan[(a1+i)*W + c]
  // For axis="col": output[i] = mean over rows a1..a2 of chan[r*W + (b1+i)]
  if (axis === "row") {
    const out = new Float64Array(a2 - a1);
    for (let i = 0; i < a2 - a1; i++) {
      let s = 0, n = 0;
      const r = a1 + i;
      for (let c = b1; c < b2; c++) {
        s += chan[r * W + c]; n++;
      }
      out[i] = s / Math.max(1, n);
    }
    return out;
  } else {
    const out = new Float64Array(b2 - b1);
    for (let i = 0; i < b2 - b1; i++) {
      let s = 0, n = 0;
      const c = b1 + i;
      for (let r = a1; r < a2; r++) {
        s += chan[r * W + c]; n++;
      }
      out[i] = s / Math.max(1, n);
    }
    return out;
  }
}

function symBox(p: Float64Array, k: number): Float64Array {
  if (k <= 1) return p.slice();
  const odd = k % 2 === 0 ? k + 1 : k;
  const half = Math.floor(odd / 2);
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) {
    let s = 0, n = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < p.length) { s += p[idx]; n++; }
    }
    out[i] = s / Math.max(1, n);
  }
  return out;
}

function gaussSmooth(p: Float64Array, sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v; sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) {
    let s = 0;
    for (let j = -radius; j <= radius; j++) {
      const idx = Math.max(0, Math.min(p.length - 1, i + j));
      s += p[idx] * k[j + radius];
    }
    out[i] = s;
  }
  return out;
}

/**
 * Find the OUTER edge of the inner DG border by threshold-crossing on
 * the WH-frame side. The "strip centre" is at canonOuterIdx - frameDir*0.5
 * LCD-px (= the centre of the 1-GB-px DG strip). Floor = argmin of smoothed
 * profile within ±0.5 LCD-px of strip centre. Baseline = profile value
 * 1.5 LCD-px outward from canonical (= deep WH frame). Threshold = floor +
 * 0.5*(baseline - floor). Scan from floor outward; report sub-pixel
 * crossing where profile rises through threshold.
 *
 * frameDir = -1 for TOP/LEFT (= scan toward smaller index), +1 for BOTTOM/RIGHT.
 */
function findBorderEdge(
  profile: Float64Array, canonOuterIdx: number, frameDir: 1 | -1, scale: number,
): number | null {
  const sm = gaussSmooth(symBox(profile, scale + 1), 1.0);
  // DG-signature channel: DG strip is HIGH; surrounding WH/camera are LOW.
  // Find peak (argmax) within ±1 LCD-px of canonical strip centre, then
  // outer edge as crossing at half-peak going from peak toward outer side.
  const stripCentreIdx = canonOuterIdx - frameDir * (scale / 2);
  const peakHalf = Math.max(1, scale);
  const peakLo = Math.max(0, Math.floor(stripCentreIdx - peakHalf));
  const peakHi = Math.min(sm.length - 1, Math.ceil(stripCentreIdx + peakHalf));
  if (peakLo >= peakHi) return null;
  let peakIdx = peakLo, peakVal = sm[peakLo];
  for (let i = peakLo + 1; i <= peakHi; i++) {
    if (sm[i] > peakVal) { peakVal = sm[i]; peakIdx = i; }
  }
  const baselineIdx = Math.max(0, Math.min(
    sm.length - 1,
    Math.round(canonOuterIdx + frameDir * 1.5 * scale),
  ));
  const baselineVal = sm[baselineIdx];
  if (peakVal - baselineVal < 30) return null;
  const threshold = baselineVal + 0.5 * (peakVal - baselineVal);
  let i = peakIdx;
  while (i + frameDir >= 0 && i + frameDir < sm.length) {
    const a = sm[i];
    const b = sm[i + frameDir];
    if (a >= threshold && b < threshold) {
      const t = (a - threshold) / (a - b);
      return i + frameDir * Math.max(0, Math.min(1, t));
    }
    i += frameDir;
  }
  return null;
}

function measureBorder(
  chan: Float32Array, W: number, H: number, side: Side, longAxisCentre: number,
): BorderMeasurement {
  // Long axis = direction the border runs. Perpendicular axis = direction
  // we measure threshold-crossing in.
  const isHorizontal = side === "top" || side === "bottom";
  const longHalf = SCALE / 2; // average over 1 LCD-px width
  // Search window: ±6 GB-px = ±48 image-px around canonical perpendicular position
  const PERP_HALF = 6 * SCALE;
  const canonOuter = side === "top" ? CANONICAL_DIST.top
                   : side === "bottom" ? SCREEN_H - CANONICAL_DIST.bottom
                   : side === "left" ? CANONICAL_DIST.left
                   : SCREEN_W - CANONICAL_DIST.right;
  let profile: Float64Array;
  let profileOrigin: number;
  let frameDir: 1 | -1;

  if (isHorizontal) {
    // border runs horizontally; sample column at longAxisCentre, perpendicular = Y
    const c1 = Math.max(0, Math.floor(longAxisCentre - longHalf));
    const c2 = Math.min(W, Math.ceil(longAxisCentre + longHalf));
    const r1 = Math.max(0, Math.floor(canonOuter - PERP_HALF));
    const r2 = Math.min(H, Math.ceil(canonOuter + PERP_HALF));
    profile = meansAlong(chan, W, "row", r1, r2, c1, c2);
    profileOrigin = r1;
    frameDir = side === "top" ? -1 : 1;
  } else {
    // border runs vertically; sample row at longAxisCentre, perpendicular = X
    const r1 = Math.max(0, Math.floor(longAxisCentre - longHalf));
    const r2 = Math.min(H, Math.ceil(longAxisCentre + longHalf));
    const c1 = Math.max(0, Math.floor(canonOuter - PERP_HALF));
    const c2 = Math.min(W, Math.ceil(canonOuter + PERP_HALF));
    profile = meansAlong(chan, W, "col", r1, r2, c1, c2);
    profileOrigin = c1;
    frameDir = side === "left" ? -1 : 1;
  }

  const canonOuterIdx = canonOuter - profileOrigin;
  const edge = findBorderEdge(profile, canonOuterIdx, frameDir, SCALE);
  if (edge === null) {
    return { side, longAxis: longAxisCentre, outerCrossing: null, distFromEdge: null, bias: null };
  }
  const crossing = profileOrigin + edge;
  const dist = side === "top" ? crossing
             : side === "left" ? crossing
             : side === "bottom" ? SCREEN_H - crossing
             : SCREEN_W - crossing;
  const canonical = side === "top" ? CANONICAL_DIST.top
                  : side === "bottom" ? CANONICAL_DIST.bottom
                  : side === "left" ? CANONICAL_DIST.left
                  : CANONICAL_DIST.right;
  const bias = dist - canonical;
  return { side, longAxis: longAxisCentre, outerCrossing: crossing, distFromEdge: dist, bias };
}

async function analyseImage(path: string): Promise<ImageSummary> {
  const buf = readFileSync(path);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const chan = makeGray(data, W, H, info.channels);

  const measurements: BorderMeasurement[] = [];
  for (const x of TOP_BOTTOM_SAMPLE_X) {
    measurements.push(measureBorder(chan, W, H, "top", x));
    measurements.push(measureBorder(chan, W, H, "bottom", x));
  }
  for (const y of LEFT_RIGHT_SAMPLE_Y) {
    measurements.push(measureBorder(chan, W, H, "left", y));
    measurements.push(measureBorder(chan, W, H, "right", y));
  }

  const perSide: ImageSummary["perSide"] = {
    top: { count: 0, meanBias: 0, maxAbsBias: 0, meanDist: 0 },
    bottom: { count: 0, meanBias: 0, maxAbsBias: 0, meanDist: 0 },
    left: { count: 0, meanBias: 0, maxAbsBias: 0, meanDist: 0 },
    right: { count: 0, meanBias: 0, maxAbsBias: 0, meanDist: 0 },
  };
  for (const m of measurements) {
    if (m.bias === null || m.distFromEdge === null) continue;
    const ps = perSide[m.side];
    ps.count++;
    ps.meanBias += m.bias;
    ps.meanDist += m.distFromEdge;
    if (Math.abs(m.bias) > ps.maxAbsBias) ps.maxAbsBias = Math.abs(m.bias);
  }
  for (const s of ["top", "bottom", "left", "right"] as Side[]) {
    if (perSide[s].count > 0) {
      perSide[s].meanBias /= perSide[s].count;
      perSide[s].meanDist /= perSide[s].count;
    }
  }
  return { path, measurements, perSide };
}

function fmt(n: number, w = 7, d = 2): string {
  return n.toFixed(d).padStart(w);
}

function printSummary(summary: ImageSummary, verbose: boolean): void {
  const stem = basename(summary.path).replace(/_warp\.png$/, "").replace(/\.png$/, "");
  console.log(`\n=== ${stem} ===`);
  console.log(`side    | n  | meanDist | meanBias | maxAbs   | canonical`);
  for (const s of ["top", "bottom", "left", "right"] as Side[]) {
    const ps = summary.perSide[s];
    const can = CANONICAL_DIST[s];
    console.log(
      `${s.padEnd(7)} | ${ps.count.toString().padStart(2)} | ${fmt(ps.meanDist, 8, 2)} | ` +
      `${fmt(ps.meanBias, 8, 2)} | ${fmt(ps.maxAbsBias, 8, 2)} | ${can}`
    );
  }
  if (verbose) {
    console.log(`\n  per-point detail (longAxis | outerCross | dist | bias):`);
    for (const m of summary.measurements) {
      const oc = m.outerCrossing === null ? "  null" : fmt(m.outerCrossing, 8, 2);
      const dist = m.distFromEdge === null ? "  null" : fmt(m.distFromEdge, 8, 2);
      const bias = m.bias === null ? "  null" : fmt(m.bias, 7, 2);
      console.log(`    ${m.side.padEnd(7)} ${fmt(m.longAxis, 7, 1)} | ${oc} | ${dist} | ${bias}`);
    }
  }
}

function printAggregate(summaries: ImageSummary[]): void {
  if (summaries.length < 2) return;
  console.log(`\n=== Aggregate over ${summaries.length} images ===`);
  console.log(`side    | meanBias | meanAbsBias | maxAbsBias`);
  type Side = "top" | "bottom" | "left" | "right";
  for (const s of ["top", "bottom", "left", "right"] as Side[]) {
    let sumBias = 0, sumAbs = 0, maxAbs = 0, n = 0;
    for (const sum of summaries) {
      const ps = sum.perSide[s];
      if (ps.count === 0) continue;
      sumBias += ps.meanBias;
      sumAbs += Math.abs(ps.meanBias);
      if (ps.maxAbsBias > maxAbs) maxAbs = ps.maxAbsBias;
      n++;
    }
    if (n === 0) continue;
    console.log(
      `${s.padEnd(7)} | ${fmt(sumBias / n, 8, 2)} | ${fmt(sumAbs / n, 11, 2)} | ${fmt(maxAbs, 8, 2)}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let verbose = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--dir" && i + 1 < args.length) {
      const dir = args[++i];
      const stack = [dir];
      while (stack.length) {
        const p = stack.pop()!;
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
          for (const e of readdirSync(p)) stack.push(join(p, e));
        } else if (p.endsWith("_warp.png")) {
          const norm = p.replace(/\\/g, "/");
          if (/\/debug\//.test(norm) || norm.endsWith("/debug")) paths.push(p);
        }
      }
    } else {
      paths.push(resolve(a));
    }
  }
  if (paths.length === 0) {
    console.error(
      "Usage: tsx scripts/border-distance-from-edge.ts [--verbose] " +
      "<warp.png> [<warp.png> ...]\n" +
      "       tsx scripts/border-distance-from-edge.ts --dir <root>"
    );
    process.exit(1);
  }

  console.log(`images: ${paths.length}`);
  const summaries: ImageSummary[] = [];
  for (const p of paths) {
    try {
      const sum = await analyseImage(p);
      printSummary(sum, verbose);
      summaries.push(sum);
    } catch (e) {
      console.error(`error processing ${p}: ${(e as Error).message}`);
    }
  }
  printAggregate(summaries);
}

main();
