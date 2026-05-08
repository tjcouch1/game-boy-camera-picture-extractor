#!/usr/bin/env tsx
/*
 * Plan A "ground-truth" harness — measures the OUTER edge of each interior
 * dash on a warp PNG and reports its distance from the corresponding screen
 * edge. The user's canonical metric (per round-2 feedback):
 *
 *   "the dashes are 9-10px from the right edge of the screen, but they should
 *    be 8px from the side. ... You can use the same detection with the left
 *    and bottom. The top is a little trickier because it goes from DG to BK."
 *
 * Canonical outer-edge distances per side (= distance from screen edge to
 * the OUTER edge of the BK body, in image-px at scale=8):
 *   - TOP:    48  (BK body at GB rows 6-7;   outer = row 48)
 *   - BOTTOM: 40  (BK body at GB rows 137-138; outer = row 1112; 1152-1112=40)
 *   - LEFT:    8  (BK body at GB cols 1-2;   outer = col 8)
 *   - RIGHT:   8  (BK body at GB cols 157-158; outer = col 1272; 1280-1272=8)
 *
 * Algorithm per dash:
 *   1. Build a perpendicular 1D profile of the chosen channel (default
 *      grayscale — matches what the user perceives) in a narrow band
 *      (width = scale image-px) centred on the dash's canonical long-axis
 *      position. Profile spans an "outer-half + inner-half" search window
 *      around the canonical perpendicular centroid.
 *   2. Box-smooth by `scale` then gaussian σ=1.0.
 *   3. Find the BK floor: argmin within ±2 LCD-px of the canonical
 *      perpendicular centroid.
 *   4. Find the outer baseline: max of the smoothed profile on the OUTER
 *      side of the floor (= toward the screen edge).
 *   5. Threshold = floor + 0.5 × (baseline − floor).
 *   6. Scan from floorIdx outward; return the first sub-pixel position
 *      where smoothed profile ≥ threshold (linear-interp between adjacent
 *      samples).
 *   7. Distance from screen edge = |screen_edge_coord − crossing_coord|.
 *      Bias = distance − canonical.
 *
 * Channel options (--channel):
 *   - "gray"      (default): standard luma 0.299·R + 0.587·G + 0.114·B
 *   - "g":        only the G channel (sub-pixel = middle of LCD pixel,
 *                 less affected by adjacent-pixel B bleed)
 *   - "rg":       (R + G) / 2
 *   - "rgb":      (R + G + B) / 3 (no luma weighting)
 *
 * Usage:
 *   tsx scripts/dash-distance-from-edge.ts <warp.png> [<warp.png> ...]
 *   tsx scripts/dash-distance-from-edge.ts --dir <path-to-test-output>
 *   tsx scripts/dash-distance-from-edge.ts --channel g <warp.png>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import sharp from "sharp";

const SCALE = 8;
const SCREEN_W = 160 * SCALE; // 1280
const SCREEN_H = 144 * SCALE; // 1152

// Canonical outer-edge distances from the screen edge (image-px).
const CANONICAL_DIST = {
  top: 48,    // BK body rows 6-7 → outer row 48
  bottom: 40, // BK body rows 137-138 → outer row 1112; 1152-1112 = 40
  left: 8,    // BK body cols 1-2 → outer col 8
  right: 8,   // BK body cols 157-158 → outer col 1272; 1280-1272 = 8
} as const;

// Canonical perpendicular centroid (image-px) of the BK body for each side.
const CANONICAL_CENTROID = {
  top: 7 * SCALE,     // 56  (centroid Y in pixel-edge coords = 7)
  bottom: 138 * SCALE, // 1104
  left: 2 * SCALE,     // 16
  right: 158 * SCALE,  // 1264
} as const;

// Interior dash long-axis positions (in GB-pixel-edge units; multiply by scale).
const DASH_INTERIOR_TOP_BOTTOM_X = [
  12.5, 22.5, 32, 42, 51.5, 60.5, 70.5, 80, 90, 100.5, 110.5, 120, 130, 139.5, 148.5,
] as const;
const DASH_INTERIOR_LEFT_Y = [
  19.5, 29.5, 39.5, 48.5, 58, 68, 77.5, 87.5, 96.5, 106, 116, 125.5,
] as const;
const DASH_INTERIOR_RIGHT_Y = [
  15, 24.5, 35, 45, 55, 64.5, 75, 85, 95, 104.5, 115, 125,
] as const;

type Side = "top" | "bottom" | "left" | "right";
type Channel = "gray" | "g" | "rg" | "rgb";

interface DashMeasurement {
  side: Side;
  /** Canonical long-axis centre (image-px) of the dash. */
  longAxis: number;
  /** Sub-pixel position of the threshold-crossing on the OUTER side
   *  (image-px in warp coordinates). */
  outerCrossing: number | null;
  /** Distance from the screen edge to the outer crossing (image-px). */
  distFromEdge: number | null;
  /** Bias = distFromEdge − canonical (image-px). Positive = dash too far
   *  inward (= "too far right" for left side, "too far left" for right
   *  side, "too far down" for top, "too far up" for bottom). */
  bias: number | null;
}

interface ImageSummary {
  path: string;
  measurements: DashMeasurement[];
  perSide: Record<Side, { count: number; meanBias: number; maxAbsBias: number; meanDist: number }>;
}

function makeChannel(data: Buffer, W: number, H: number, channels: number, channel: Channel): Float32Array {
  const out = new Float32Array(W * H);
  if (channel === "gray") {
    for (let i = 0; i < W * H; i++) {
      const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2];
      out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  } else if (channel === "g") {
    for (let i = 0; i < W * H; i++) out[i] = data[i * channels + 1];
  } else if (channel === "rg") {
    for (let i = 0; i < W * H; i++) {
      out[i] = (data[i * channels] + data[i * channels + 1]) / 2;
    }
  } else {
    for (let i = 0; i < W * H; i++) {
      out[i] = (data[i * channels] + data[i * channels + 1] + data[i * channels + 2]) / 3;
    }
  }
  return out;
}

function symBoxSmooth(p: Float64Array, k: number): Float64Array {
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

function gaussian1d(p: Float64Array, sigma: number): Float64Array {
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
 * Compute mean of `chan` over a rectangular band, returning a 1D profile
 * along the perpendicular axis.
 *
 * @param axis "row" → profile per-row (y-perpendicular sweep, x-band),
 *             "col" → profile per-col (x-perpendicular sweep, y-band).
 * @param r1, r2 row range (used as y-band when axis="col", as sweep when axis="row")
 * @param c1, c2 col range (used as x-band when axis="row", as sweep when axis="col")
 */
function meansAlong(
  chan: Float32Array, W: number,
  axis: "row" | "col",
  r1: number, r2: number, c1: number, c2: number,
): Float64Array {
  if (axis === "row") {
    const out = new Float64Array(r2 - r1);
    for (let r = r1; r < r2; r++) {
      let s = 0, n = 0;
      for (let c = c1; c < c2; c++) { s += chan[r * W + c]; n++; }
      out[r - r1] = n ? s / n : 0;
    }
    return out;
  } else {
    const out = new Float64Array(c2 - c1);
    for (let c = c1; c < c2; c++) {
      let s = 0, n = 0;
      for (let r = r1; r < r2; r++) { s += chan[r * W + c]; n++; }
      out[c - c1] = n ? s / n : 0;
    }
    return out;
  }
}

/**
 * Find the sub-pixel position where the smoothed profile crosses
 * `threshold` going from `floorIdx` toward `direction` (= +1 or -1).
 *
 * Returns the absolute index (sub-pixel) within the profile, or null if
 * no crossing is found.
 */
function findThresholdCrossing(
  smoothed: Float64Array,
  floorIdx: number,
  direction: 1 | -1,
  threshold: number,
): number | null {
  let i = floorIdx;
  while (i + direction >= 0 && i + direction < smoothed.length) {
    const a = smoothed[i];
    const b = smoothed[i + direction];
    if (a < threshold && b >= threshold) {
      // Crossing is between i and i+direction.
      const t = (threshold - a) / (b - a);
      return i + direction * Math.max(0, Math.min(1, t));
    }
    i += direction;
  }
  return null;
}

interface DashAnalysis {
  outerCrossing: number | null;
  floorVal: number;
  baselineVal: number;
  threshold: number;
}

/**
 * Analyse a single 1D profile representing the perpendicular cross-section
 * of a dash. Returns the absolute sub-pixel coordinate of the outer
 * threshold-crossing.
 *
 * @param profile The perpendicular 1D profile.
 * @param profileOrigin The absolute coordinate (image-px) at profile[0].
 * @param canonCentre Canonical perpendicular centroid of BK body (absolute image-px).
 * @param outerDir +1 if outer side is at higher index in profile, -1 if lower.
 *                 (For top: outer = lower row = -1. For bottom: outer = higher row = +1.
 *                  For left: outer = lower col = -1. For right: outer = higher col = +1.)
 */
function analyseProfile(
  profile: Float64Array,
  profileOrigin: number,
  canonCentre: number,
  outerDir: 1 | -1,
): DashAnalysis {
  const sm = gaussian1d(symBoxSmooth(profile, SCALE + 1), 1.0);

  // Floor: argmin within ±2 LCD-px of canonCentre.
  const canonIdx = canonCentre - profileOrigin;
  const floorLo = Math.max(0, Math.floor(canonIdx - 2 * SCALE));
  const floorHi = Math.min(sm.length - 1, Math.ceil(canonIdx + 2 * SCALE));
  let floorIdx = floorLo, floorVal = sm[floorLo];
  for (let i = floorLo + 1; i <= floorHi; i++) {
    if (sm[i] < floorVal) { floorVal = sm[i]; floorIdx = i; }
  }

  // Baseline: max of smoothed profile on the outer side of floorIdx.
  // Restrict to a sensible window (outer side, up to canonCentre + 8 LCD-px).
  let baselineVal = -Infinity;
  if (outerDir === 1) {
    const outerHi = Math.min(sm.length - 1, floorIdx + 8 * SCALE);
    for (let i = floorIdx + 1; i <= outerHi; i++) {
      if (sm[i] > baselineVal) baselineVal = sm[i];
    }
  } else {
    const outerLo = Math.max(0, floorIdx - 8 * SCALE);
    for (let i = outerLo; i < floorIdx; i++) {
      if (sm[i] > baselineVal) baselineVal = sm[i];
    }
  }
  if (!isFinite(baselineVal)) baselineVal = floorVal;

  const threshold = floorVal + 0.5 * (baselineVal - floorVal);
  const crossingIdx = findThresholdCrossing(sm, floorIdx, outerDir, threshold);
  const outerCrossing = crossingIdx === null ? null : profileOrigin + crossingIdx;
  return { outerCrossing, floorVal, baselineVal, threshold };
}

function measureDash(
  chan: Float32Array, W: number, H: number,
  side: Side, longAxisCentre: number,
): DashMeasurement {
  // Narrow band along the long axis: ±0.5 LCD-px = scale-px-wide window.
  // Just wide enough to average out per-image-pixel noise without
  // including the adjacent dash or non-dash region.
  const longHalf = SCALE / 2;
  // Search window along the perpendicular axis: from screen edge inward
  // by 12 GB-pixels (= 96 image-px), enough to cover the full frame.
  const perpHalf = 6 * SCALE;
  const canonCentre = CANONICAL_CENTROID[side];

  let profile: Float64Array;
  let profileOrigin: number;
  let outerDir: 1 | -1;

  if (side === "top" || side === "bottom") {
    // Long axis = X, perpendicular = Y.
    const c1 = Math.max(0, Math.floor(longAxisCentre - longHalf));
    const c2 = Math.min(W, Math.ceil(longAxisCentre + longHalf));
    const r1 = Math.max(0, Math.floor(canonCentre - perpHalf));
    const r2 = Math.min(H, Math.ceil(canonCentre + perpHalf));
    profile = meansAlong(chan, W, "row", r1, r2, c1, c2);
    profileOrigin = r1;
    outerDir = side === "top" ? -1 : 1;
  } else {
    // Long axis = Y, perpendicular = X.
    const r1 = Math.max(0, Math.floor(longAxisCentre - longHalf));
    const r2 = Math.min(H, Math.ceil(longAxisCentre + longHalf));
    const c1 = Math.max(0, Math.floor(canonCentre - perpHalf));
    const c2 = Math.min(W, Math.ceil(canonCentre + perpHalf));
    profile = meansAlong(chan, W, "col", r1, r2, c1, c2);
    profileOrigin = c1;
    outerDir = side === "left" ? -1 : 1;
  }

  const analysis = analyseProfile(profile, profileOrigin, canonCentre, outerDir);
  if (analysis.outerCrossing === null) {
    return { side, longAxis: longAxisCentre, outerCrossing: null, distFromEdge: null, bias: null };
  }
  const dist = side === "top" ? analysis.outerCrossing
             : side === "left" ? analysis.outerCrossing
             : side === "bottom" ? SCREEN_H - analysis.outerCrossing
             : SCREEN_W - analysis.outerCrossing;
  const bias = dist - CANONICAL_DIST[side];
  return {
    side,
    longAxis: longAxisCentre,
    outerCrossing: analysis.outerCrossing,
    distFromEdge: dist,
    bias,
  };
}

async function analyseImage(path: string, channel: Channel): Promise<ImageSummary> {
  const buf = readFileSync(path);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const chan = makeChannel(data, W, H, info.channels, channel);

  const measurements: DashMeasurement[] = [];
  for (const gbx of DASH_INTERIOR_TOP_BOTTOM_X) {
    measurements.push(measureDash(chan, W, H, "top", gbx * SCALE));
  }
  for (const gbx of DASH_INTERIOR_TOP_BOTTOM_X) {
    measurements.push(measureDash(chan, W, H, "bottom", gbx * SCALE));
  }
  for (const gby of DASH_INTERIOR_LEFT_Y) {
    measurements.push(measureDash(chan, W, H, "left", gby * SCALE));
  }
  for (const gby of DASH_INTERIOR_RIGHT_Y) {
    measurements.push(measureDash(chan, W, H, "right", gby * SCALE));
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

function fmt(n: number, w = 6, d = 2): string {
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
    console.log(`\n  per-dash detail (longAxis | outerCross | dist | bias):`);
    for (const m of summary.measurements) {
      const oc = m.outerCrossing === null ? "  null" : fmt(m.outerCrossing, 7, 2);
      const dist = m.distFromEdge === null ? " null" : fmt(m.distFromEdge, 6, 2);
      const bias = m.bias === null ? " null" : fmt(m.bias, 6, 2);
      console.log(`    ${m.side.padEnd(7)} ${fmt(m.longAxis, 7, 1)} | ${oc} | ${dist} | ${bias}`);
    }
  }
}

function printAggregate(summaries: ImageSummary[]): void {
  if (summaries.length < 2) return;
  console.log(`\n=== Aggregate over ${summaries.length} images ===`);
  console.log(`side    | meanBias | meanAbsBias | maxAbsBias`);
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
  let channel: Channel = "gray";
  let verbose = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--channel" && i + 1 < args.length) {
      channel = args[++i] as Channel;
    } else if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--dir" && i + 1 < args.length) {
      const dir = args[++i];
      // Recursively find _warp.png files under dir. Only include files
      // whose parent directory is named "debug" (= the canonical pipeline
      // output location); skip duplicate copies that may exist under the
      // test-output/<name>/ root from older runs.
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
      "Usage: tsx scripts/dash-distance-from-edge.ts [--channel gray|g|rg|rgb] [--verbose] " +
      "<warp.png> [<warp.png> ...]\n" +
      "       tsx scripts/dash-distance-from-edge.ts --dir <root>"
    );
    process.exit(1);
  }

  console.log(`channel: ${channel}, images: ${paths.length}`);
  const summaries: ImageSummary[] = [];
  for (const p of paths) {
    try {
      const sum = await analyseImage(p, channel);
      printSummary(sum, verbose);
      summaries.push(sum);
    } catch (e) {
      console.error(`error processing ${p}: ${(e as Error).message}`);
    }
  }
  printAggregate(summaries);
}

main();
