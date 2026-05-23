/**
 * border-curve-overlay.ts — dense per-pixel border detection + overlay
 *
 * Diagnoses what the inner DG border looks like in the warp output WITHOUT
 * the assumptions the pipeline detector makes (narrow peak search, contrast
 * threshold). Builds an overlay PNG showing:
 *   • Bright green line at canonical border position (reference).
 *   • Magenta crosses at per-column/row detected DG-strip-centre position
 *     (every 4 image-px along the long axis), with wide ±20 image-px peak
 *     search so we catch the user-described 5-10 px deviations.
 *   • Yellow line connecting consecutive detections (= the actual border
 *     curve, easy to compare visually against canonical).
 *
 * Run: `pnpm tsx scripts/border-curve-overlay.ts <warp.png> [--out <path>]`
 *      (also handles a whole directory of *_warp.png files when given a dir)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCALE = 8;
// Match common.ts: INNER_TOP=15, INNER_BOT=128, INNER_LEFT=15, INNER_RIGHT=144
const INNER_TOP = 15, INNER_BOT = 128, INNER_LEFT = 15, INNER_RIGHT = 144;
const EXP_TOP = INNER_TOP * SCALE;          // 120 — outer edge of DG strip on top
const EXP_BOT = (INNER_BOT + 1) * SCALE;    // 1032 — outer edge of DG strip on bottom
const EXP_LEFT = INNER_LEFT * SCALE;        // 120
const EXP_RIGHT = (INNER_RIGHT + 1) * SCALE; // 1160
const SEARCH_HALF = 3 * SCALE;              // ±24 image-px — comfortably > the user-reported 5-10 px

// Detection criteria. Tightened from the previous "any drop ≥ 30" version
// because that latches onto bright-WH-camera→dark-camera transitions deeper
// inside the camera area. The real WH→DG transition is ~84 luma drop (WH
// luma 244, DG luma 160) so 50 is a clear lower bound for an actual border.
const ABOVE_MIN = 200;     // outer side must read sustained-bright (WH frame)
const BELOW_MAX = 200;     // inner side must read sustained-dim (in DG strip)
const MIN_DROP = 50;       // luma drop threshold
const OUTLIER_MAX_DEV = 6; // image-px — after detection, reject points >OUTLIER_MAX_DEV from the local 5-point median

// Step along the long axis at half-an-LCD-pixel granularity.
const STEP = SCALE / 2;    // = 4 image-px = sample every 0.5 GB-pixels along each side

type Img = { data: Uint8Array; width: number; height: number; channels: number };

async function loadRaw(file: string): Promise<Img> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels };
}

function px(img: Img, x: number, y: number, c: 0 | 1 | 2): number {
  return img.data[(y * img.width + x) * img.channels + c];
}

function setPx(img: Img, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || x >= img.width || y < 0 || y >= img.height) return;
  const i = (y * img.width + x) * img.channels;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
}

/** DG signature 2B-R-G clipped to [0,255]. HIGH only on DG-coloured pixels. */
function dgAt(img: Img, x: number, y: number): number {
  const r = px(img, x, y, 0);
  const g = px(img, x, y, 1);
  const b = px(img, x, y, 2);
  const v = 2 * b - r - g;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** ITU-R BT.601 luma. WH≈244, LG≈180, DG≈160, BK≈0. */
function lumaAt(img: Img, x: number, y: number): number {
  return 0.299 * px(img, x, y, 0) + 0.587 * px(img, x, y, 1) + 0.114 * px(img, x, y, 2);
}

/**
 * Find the WH→DG transition by scanning OUTSIDE → INSIDE along the
 * perpendicular axis and returning the FIRST position where the criteria
 * are satisfied:
 *   - above mean (outer 4 rows) ≥ ABOVE_MIN — must be in the WH frame
 *   - max(below 4 rows) ≤ BELOW_MAX — must enter sustained-dim region
 *     (= DG strip, not a single dark camera pixel that bright-WH camera
 *     content sits on top of)
 *   - above − below ≥ MIN_DROP — a real transition, not noise
 *
 * Why "first satisfying" rather than "max drop": with the wider search
 * range (±24 px), the largest luma drop in the search window can sit
 * DEEP IN THE CAMERA AREA at a bright-WH-camera-pixel → dark-camera-pixel
 * transition (e.g., a BK pixel adjacent to WH content). The user reported
 * this exact pattern on 213416 LEFT — "three black GB cam image pixels
 * close to the left edge cause three of the magenta crosses way too far
 * right". Walking outside-in stops at the OUTERMOST border, which is the
 * actual DG strip boundary.
 */
function findWhToDgEdge(
  sample: (t: number) => number,
  canonical: number,
  direction: 1 | -1, // 1 = outward is smaller t (TOP/LEFT); -1 = reverse (BOT/RIGHT)
): { edge: number; drop: number } | null {
  const lo = Math.floor(canonical - SEARCH_HALF);
  const hi = Math.ceil(canonical + SEARCH_HALF);
  // Pre-sample.
  const vals: number[] = [];
  for (let t = lo; t <= hi; t++) vals.push(sample(t));
  const R = 4; // 4-row mean each side
  // For each candidate e, compute above (outer) and below (inner) means
  // PLUS max(below) to enforce sustained-dim.
  const measure = (e: number) => {
    let aboveSum = 0, belowSum = 0, belowMax = -Infinity;
    for (let i = 1; i <= R; i++) {
      const oi = direction === 1 ? e - i : e + i; // outer index
      const ii = direction === 1 ? e + i : e - i; // inner index
      aboveSum += vals[oi];
      belowSum += vals[ii];
      if (vals[ii] > belowMax) belowMax = vals[ii];
    }
    return { above: aboveSum / R, below: belowSum / R, belowMax };
  };
  // Walk outside-in. For direction +1, outer = smaller t, so e walks
  // low→high. For direction -1, outer = larger t, so e walks high→low.
  let firstE = -1;
  if (direction === 1) {
    for (let e = R; e < vals.length - R; e++) {
      const m = measure(e);
      if (m.above >= ABOVE_MIN && m.belowMax <= BELOW_MAX && (m.above - m.below) >= MIN_DROP) {
        firstE = e; break;
      }
    }
  } else {
    for (let e = vals.length - R - 1; e >= R; e--) {
      const m = measure(e);
      if (m.above >= ABOVE_MIN && m.belowMax <= BELOW_MAX && (m.above - m.below) >= MIN_DROP) {
        firstE = e; break;
      }
    }
  }
  if (firstE < 0) return null;
  // Sub-pixel: parabolic refinement around firstE using (above-below) signal.
  const f = (e: number): number => {
    const m = measure(e);
    return m.above - m.below;
  };
  let off = 0;
  if (firstE > R && firstE < vals.length - R - 1) {
    const a = f(firstE - 1), b = f(firstE), c = f(firstE + 1);
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-6) {
      off = 0.5 * (a - c) / denom;
      if (off < -0.5) off = -0.5;
      if (off > 0.5) off = 0.5;
    }
  }
  const m = measure(firstE);
  return { edge: lo + firstE + off, drop: m.above - m.below };
}

/**
 * Sub-pixel DG-strip centre along the perpendicular axis.
 * Returns the position where 2B-R-G peaks within ±PEAK_SEARCH_HALF of the
 * canonical centre, or null if the peak is weaker than `minContrast`.
 *
 * `sample(t)` reads DG signature at the perpendicular position t (averaged
 * across `parallelHalf` cells in the parallel axis to reduce noise).
 */
function findStripCentre(
  sample: (t: number) => number,
  canonicalCentre: number,
  minContrast: number,
): { centre: number; peakVal: number; contrast: number } | null {
  // Discrete peak search with small Gaussian smoothing.
  const lo = Math.floor(canonicalCentre - PEAK_SEARCH_HALF);
  const hi = Math.ceil(canonicalCentre + PEAK_SEARCH_HALF);
  // Pre-sample.
  const vals: number[] = [];
  for (let t = lo; t <= hi; t++) vals.push(sample(t));
  // Box smooth radius 2 (= 5-tap)
  const sm: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    let s = 0, n = 0;
    for (let j = -2; j <= 2; j++) {
      const k = i + j;
      if (k >= 0 && k < vals.length) { s += vals[k]; n++; }
    }
    sm.push(s / n);
  }
  // Argmax.
  let peakI = 0, peakV = sm[0];
  for (let i = 1; i < sm.length; i++) {
    if (sm[i] > peakV) { peakV = sm[i]; peakI = i; }
  }
  // Parabolic refinement.
  let off = 0;
  if (peakI > 0 && peakI < sm.length - 1) {
    const a = sm[peakI - 1], b = sm[peakI], c = sm[peakI + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-6) {
      off = 0.5 * (a - c) / denom;
      if (off < -0.5) off = -0.5;
      if (off > 0.5) off = 0.5;
    }
  }
  // Baseline: signature OUTWARD (the side closer to canonical_outer_idx in
  // raw warp; for the diagnostic we just use the lowest value in the search
  // range as baseline since both peak and the search window are inside the
  // DG strip's expected vicinity).
  let baseline = Infinity;
  for (const v of sm) if (v < baseline) baseline = v;
  const contrast = peakV - baseline;
  if (contrast < minContrast) return null;
  return { centre: lo + peakI + off, peakVal: peakV, contrast };
}

interface BorderCurve { detections: Array<{ pos: number; perp: number; contrast: number }> }

// Local-median outlier rejection. For each detection, compare to the median
// of its ±2 neighbours (= 5-point window); drop the detection if it deviates
// by more than OUTLIER_MAX_DEV image-px. This kills isolated spikes (= rows
// where the detector latches onto a dark camera pixel before the local
// median can catch up) while preserving smooth curves.
function rejectOutliers(d: BorderCurve["detections"]): BorderCurve["detections"] {
  if (d.length < 5) return d;
  // Detections come in long-axis order already.
  const out: BorderCurve["detections"] = [];
  for (let i = 0; i < d.length; i++) {
    const w: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(d.length - 1, i + 2); j++) {
      if (j !== i) w.push(d[j].perp);
    }
    w.sort((a, b) => a - b);
    const med = w[Math.floor(w.length / 2)];
    if (Math.abs(d[i].perp - med) <= OUTLIER_MAX_DEV) out.push(d[i]);
  }
  return out;
}

function detectTopBorder(img: Img): BorderCurve {
  const out: BorderCurve["detections"] = [];
  // Scan only WITHIN the actual camera-area extent. Outside this range
  // there is no DG strip — the WH frame extends all the way and any
  // luma drop is from camera content elsewhere, not the inner border.
  for (let x = EXP_LEFT; x < EXP_RIGHT; x += STEP) {
    const sample = (t: number) => {
      const y = Math.round(t);
      if (y < 0 || y >= img.height) return 0;
      let s = 0, n = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xi = x + dx;
        if (xi >= 0 && xi < img.width) { s += lumaAt(img, xi, y); n++; }
      }
      return s / n;
    };
    // direction=+1: inner (DG side) is at higher Y than outer (WH side)
    const r = findWhToDgEdge(sample, EXP_TOP, 1);
    if (r === null) continue;
    out.push({ pos: x, perp: r.edge, contrast: r.drop });
  }
  return { detections: rejectOutliers(out) };
}

function detectBotBorder(img: Img): BorderCurve {
  const out: BorderCurve["detections"] = [];
  for (let x = EXP_LEFT; x < EXP_RIGHT; x += STEP) {
    const sample = (t: number) => {
      const y = Math.round(t);
      if (y < 0 || y >= img.height) return 0;
      let s = 0, n = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xi = x + dx;
        if (xi >= 0 && xi < img.width) { s += lumaAt(img, xi, y); n++; }
      }
      return s / n;
    };
    // direction=-1: inner (DG side) is at lower Y than outer (WH side)
    const r = findWhToDgEdge(sample, EXP_BOT, -1);
    if (r === null) continue;
    out.push({ pos: x, perp: r.edge, contrast: r.drop });
  }
  return { detections: rejectOutliers(out) };
}

function detectLeftBorder(img: Img): BorderCurve {
  const out: BorderCurve["detections"] = [];
  for (let y = EXP_TOP; y < EXP_BOT; y += STEP) {
    const sample = (t: number) => {
      const x = Math.round(t);
      if (x < 0 || x >= img.width) return 0;
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yi = y + dy;
        if (yi >= 0 && yi < img.height) { s += lumaAt(img, x, yi); n++; }
      }
      return s / n;
    };
    const r = findWhToDgEdge(sample, EXP_LEFT, 1);
    if (r === null) continue;
    out.push({ pos: y, perp: r.edge, contrast: r.drop });
  }
  return { detections: rejectOutliers(out) };
}

function detectRightBorder(img: Img): BorderCurve {
  const out: BorderCurve["detections"] = [];
  for (let y = EXP_TOP; y < EXP_BOT; y += STEP) {
    const sample = (t: number) => {
      const x = Math.round(t);
      if (x < 0 || x >= img.width) return 0;
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yi = y + dy;
        if (yi >= 0 && yi < img.height) { s += lumaAt(img, x, yi); n++; }
      }
      return s / n;
    };
    const r = findWhToDgEdge(sample, EXP_RIGHT, -1);
    if (r === null) continue;
    out.push({ pos: y, perp: r.edge, contrast: r.drop });
  }
  return { detections: rejectOutliers(out) };
}

function drawLine(
  img: Img, x0: number, y0: number, x1: number, y1: number,
  r: number, g: number, b: number,
): void {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    setPx(img, Math.round(x0 + dx * t), Math.round(y0 + dy * t), r, g, b);
  }
}

function drawDashed(
  img: Img, x0: number, y0: number, x1: number, y1: number,
  r: number, g: number, b: number, on = 6, off = 4,
): void {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    if ((i % (on + off)) < on) {
      const t = i / steps;
      setPx(img, Math.round(x0 + dx * t), Math.round(y0 + dy * t), r, g, b);
    }
  }
}

function drawCross(img: Img, x: number, y: number, size: number, r: number, g: number, b: number): void {
  for (let d = -size; d <= size; d++) {
    setPx(img, Math.round(x) + d, Math.round(y), r, g, b);
    setPx(img, Math.round(x), Math.round(y) + d, r, g, b);
  }
}

async function processOne(inFile: string, outFile: string): Promise<void> {
  const img = await loadRaw(inFile);
  if (img.channels < 3) throw new Error(`Expected ≥3 channels, got ${img.channels}`);

  const top = detectTopBorder(img);
  const bot = detectBotBorder(img);
  const lft = detectLeftBorder(img);
  const rgt = detectRightBorder(img);

  // Per-side stats
  const stats = (curve: BorderCurve, canon: number, name: string): void => {
    const vals = curve.detections.map((d) => d.perp);
    if (vals.length === 0) { console.log(`  ${name}: NO DETECTIONS`); return; }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals), max = Math.max(...vals);
    const deviations = vals.map((v) => Math.abs(v - canon));
    const maxDev = Math.max(...deviations);
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    console.log(
      `  ${name}: n=${vals.length}  ` +
      `range=[${min.toFixed(1)}, ${max.toFixed(1)}] (canon ${canon})  ` +
      `mean=${mean.toFixed(2)}  meanBias=${(mean - canon).toFixed(2)}  ` +
      `meanAbsDev=${meanDev.toFixed(2)}  maxAbsDev=${maxDev.toFixed(2)}`,
    );
  };
  console.log(path.basename(inFile));
  stats(top, EXP_TOP, "TOP   ");
  stats(bot, EXP_BOT, "BOT   ");
  stats(lft, EXP_LEFT, "LEFT  ");
  stats(rgt, EXP_RIGHT, "RIGHT ");

  // Draw overlay
  // Canonical rectangle in green dashed
  drawDashed(img, 0, EXP_TOP, img.width - 1, EXP_TOP, 0, 255, 0);
  drawDashed(img, 0, EXP_BOT, img.width - 1, EXP_BOT, 0, 255, 0);
  drawDashed(img, EXP_LEFT, 0, EXP_LEFT, img.height - 1, 0, 255, 0);
  drawDashed(img, EXP_RIGHT, 0, EXP_RIGHT, img.height - 1, 0, 255, 0);

  // Detected curves: yellow polyline + magenta dots; thick yellow if |dev|>2 px
  const drawCurve = (curve: BorderCurve, horizontal: boolean, canon: number): void => {
    const detections = curve.detections;
    for (let i = 0; i < detections.length; i++) {
      const d = detections[i];
      const x = horizontal ? d.pos : d.perp;
      const y = horizontal ? d.perp : d.pos;
      const dev = Math.abs(d.perp - canon);
      // Magenta cross at detected position (always)
      drawCross(img, x, y, 2, 255, 0, 220);
      // Yellow segment to next
      if (i + 1 < detections.length) {
        const nd = detections[i + 1];
        const nx = horizontal ? nd.pos : nd.perp;
        const ny = horizontal ? nd.perp : nd.pos;
        // Thick yellow if either endpoint deviation > 2 px
        const thick = dev > 2 || Math.abs(nd.perp - canon) > 2;
        drawLine(img, x, y, nx, ny, 255, 255, 0);
        if (thick) {
          // Add 1 px extra
          drawLine(img, x, y + 1, nx, ny + 1, 255, 220, 0);
          drawLine(img, x + 1, y, nx + 1, ny, 255, 220, 0);
        }
      }
    }
  };
  drawCurve(top, true, EXP_TOP);
  drawCurve(bot, true, EXP_BOT);
  drawCurve(lft, false, EXP_LEFT);
  drawCurve(rgt, false, EXP_RIGHT);

  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } })
    .png()
    .toFile(outFile);
  console.log(`  → ${outFile}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: border-curve-overlay.ts <warp.png|dir> [<warp.png|dir> ...] [--out <path>]");
    process.exit(1);
  }
  const outArgIdx = args.indexOf("--out");
  const explicitOut = outArgIdx >= 0 ? args[outArgIdx + 1] : null;
  const inputs = args.filter((a, i) => a !== "--out" && (outArgIdx < 0 || (i !== outArgIdx + 1)));

  const targets: Array<{ in: string; out: string }> = [];
  for (const inp of inputs) {
    const stat = await fs.stat(inp);
    if (stat.isDirectory()) {
      const files = await fs.readdir(inp);
      for (const f of files) {
        if (f.endsWith("_warp.png")) {
          const fullIn = path.join(inp, f);
          const outName = f.replace(/_warp\.png$/, "_warp_curve_overlay.png");
          targets.push({ in: fullIn, out: path.join(inp, outName) });
        }
      }
    } else {
      const out = explicitOut
        ?? inp.replace(/\.png$/, "_curve_overlay.png");
      targets.push({ in: inp, out });
    }
  }
  for (const t of targets) {
    try {
      await processOne(t.in, t.out);
    } catch (e) {
      console.error(`FAIL ${t.in}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
