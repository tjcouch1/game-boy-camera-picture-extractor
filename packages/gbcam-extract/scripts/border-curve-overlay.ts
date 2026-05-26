/**
 * border-curve-overlay.ts — dense per-pixel border detection + overlay
 *
 * Diagnoses what the inner DG border looks like in the warp output WITHOUT
 * the assumptions the pipeline detector makes (narrow peak search, contrast
 * threshold). Builds an overlay PNG showing:
 *   • Bright green line at canonical border position (reference).
 *   • Magenta crosses at per-column/row detected DG-strip-centre position
 *     (every 4 image-px along the long axis), with wide ±24 image-px peak
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
const EXP_TOP = 120;
const EXP_BOT = 1031;
const EXP_LEFT = 120;
const EXP_RIGHT = 1159;
const SEARCH_HALF = 3 * SCALE;              // ±24 image-px — comfortably > the user-reported 5-10 px

// Detection criteria. Adaptive to handle dim images and sub-pixel noise.
const ABOVE_MIN_LUMA = 40;   // Very low to handle dimmest top regions
const MIN_DG_RISE = 35;      // Minimum jump in (Luma Drop + DG Rise)
const OUTLIER_MAX_DEV = 15;  // image-px

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

interface DetectionPoint {
  pos: number;      // long-axis position
  perp: number;     // final biased perpendicular position
  rawPerp: number;  // pre-biased perpendicular position
  drop: number;     // luma drop
  dgRise: number;   // DG signature jump
  aboveL: number;   // luma on outer side
  belowL: number;   // luma on inner side
  aboveD: number;   // DG on outer side
  belowD: number;   // DG on inner side
  score: number;    // combined signal strength
}

interface BorderCurve {
  detections: DetectionPoint[];
}

/**
 * Find the WH→DG transition by scanning OUTSIDE → INSIDE along the
 * perpendicular axis.
 */
function findWhToDgEdge(
  luma: (t: number) => number,
  dg: (t: number) => number,
  canonical: number,
  direction: 1 | -1, // 1 = outward is smaller t (TOP/LEFT); -1 = reverse (BOT/RIGHT)
  side: "TOP" | "BOT" | "LEFT" | "RIGHT",
): DetectionPoint | null {
  const lo = Math.floor(canonical - SEARCH_HALF);
  const hi = Math.ceil(canonical + SEARCH_HALF);
  const rawLuma: number[] = [];
  const rawDg: number[] = [];
  for (let t = lo; t <= hi; t++) {
    rawLuma.push(luma(t));
    rawDg.push(dg(t));
  }
  
  // Stronger box filter smoothing (size 9) to remove erratic jumps
  const valsLuma: number[] = [];
  const valsDg: number[] = [];
  const K = 4; // radius
  for (let i = 0; i < rawLuma.length; i++) {
    let sl = 0, sd = 0, n = 0;
    for (let j = -K; j <= K; j++) {
      const k = i + j;
      if (k >= 0 && k < rawLuma.length) {
        sl += rawLuma[k];
        sd += rawDg[k];
        n++;
      }
    }
    valsLuma.push(sl / n);
    valsDg.push(sd / n);
  }

  const R = 6; // Check window size
  const measure = (e: number) => {
    let aboveSumL = 0, belowSumL = 0;
    let aboveSumD = 0, belowSumD = 0;
    for (let i = 1; i <= R; i++) {
      const oi = direction === 1 ? e - i : e + i; // outer index
      const ii = direction === 1 ? e + i : e - i; // inner index
      aboveSumL += valsLuma[oi];
      belowSumL += valsLuma[ii];
      aboveSumD += valsDg[oi];
      belowSumD += valsDg[ii];
    }
    const aboveL = aboveSumL / R;
    const belowL = belowSumL / R;
    const aboveD = aboveSumD / R;
    const belowD = belowSumD / R;
    
    const drop = aboveL - belowL;
    const dgRise = belowD - aboveD;
    const score = drop + dgRise;
    
    return { aboveL, belowL, aboveD, belowD, drop, dgRise, score };
  };

  let firstE = -1;
  if (direction === 1) {
    for (let e = R; e < valsLuma.length - R; e++) {
      const m = measure(e);
      if (m.aboveL >= ABOVE_MIN_LUMA && m.score >= MIN_DG_RISE) {
        firstE = e; break;
      }
    }
  } else {
    for (let e = valsLuma.length - R - 1; e >= R; e--) {
      const m = measure(e);
      if (m.aboveL >= ABOVE_MIN_LUMA && m.score >= MIN_DG_RISE) {
        firstE = e; break;
      }
    }
  }
  if (firstE < 0) return null;

  // Parabolic refinement
  const f = (e: number): number => measure(e).score;
  let off = 0;
  if (firstE > R && firstE < valsLuma.length - R - 1) {
    const a = f(firstE - 1), b = f(firstE), c = f(firstE + 1);
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-6) {
      off = 0.5 * (a - c) / denom;
      off = Math.max(-0.5, Math.min(0.5, off));
    }
  }

  const rawPerp = lo + firstE + off;
  const m = measure(firstE);

  /**
   * Biases (Move INWARD in image-pixels)
   * Calibrated based on hand-edited ground-truth points.
   */
  let bias = 0;
  if (side === "TOP") bias = 5.75;
  if (side === "BOT") bias = 7.60;
  if (side === "LEFT") bias = 6.95;
  if (side === "RIGHT") bias = 8.26;

  const perp = rawPerp + direction * bias;

  return {
    pos: 0, // set by caller
    perp,
    rawPerp,
    drop: m.drop,
    dgRise: m.dgRise,
    aboveL: m.aboveL,
    belowL: m.belowL,
    aboveD: m.aboveD,
    belowD: m.belowD,
    score: m.score
  };
}

// Local-median outlier rejection.
function rejectOutliers(d: DetectionPoint[]): DetectionPoint[] {
  if (d.length < 5) return d;
  const out: DetectionPoint[] = [];
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
  const out: DetectionPoint[] = [];
  for (let x = EXP_LEFT; x < EXP_RIGHT; x += STEP) {
    const luma = (t: number) => {
      const y = Math.round(t);
      if (y < 0 || y >= img.height) return 0;
      let s = 0, n = 0;
      for (let dx = -2; dx <= 2; dx++) { // radius 2 horizontal smoothing
        const xi = Math.round(x + dx);
        if (xi >= 0 && xi < img.width) { s += lumaAt(img, xi, y); n++; }
      }
      return s / n;
    };
    const dg = (t: number) => {
      const y = Math.round(t);
      if (y < 0 || y >= img.height) return 0;
      let s = 0, n = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const xi = Math.round(x + dx);
        if (xi >= 0 && xi < img.width) { s += dgAt(img, xi, y); n++; }
      }
      return s / n;
    };
    const r = findWhToDgEdge(luma, dg, EXP_TOP, 1, "TOP");
    if (r === null) continue;
    r.pos = x;
    out.push(r);
  }
  return { detections: rejectOutliers(out) };
}

function detectBotBorder(img: Img): BorderCurve {
  const out: DetectionPoint[] = [];
  for (let x = EXP_LEFT; x < EXP_RIGHT; x += STEP) {
    const luma = (t: number) => {
      const y = Math.round(t);
      if (y < 0 || y >= img.height) return 0;
      let s = 0, n = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const xi = Math.round(x + dx);
        if (xi >= 0 && xi < img.width) { s += lumaAt(img, xi, y); n++; }
      }
      return s / n;
    };
    const dg = (t: number) => {
      const y = Math.round(t);
      if (y < 0 || y >= img.height) return 0;
      let s = 0, n = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const xi = Math.round(x + dx);
        if (xi >= 0 && xi < img.width) { s += dgAt(img, xi, y); n++; }
      }
      return s / n;
    };
    const r = findWhToDgEdge(luma, dg, EXP_BOT, -1, "BOT");
    if (r === null) continue;
    r.pos = x;
    out.push(r);
  }
  return { detections: rejectOutliers(out) };
}

function detectLeftBorder(img: Img): BorderCurve {
  const out: DetectionPoint[] = [];
  for (let y = EXP_TOP; y < EXP_BOT; y += STEP) {
    const luma = (t: number) => {
      const x = Math.round(t);
      if (x < 0 || x >= img.width) return 0;
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) { // radius 2 vertical smoothing
        const yi = Math.round(y + dy);
        if (yi >= 0 && yi < img.height) { s += lumaAt(img, x, yi); n++; }
      }
      return s / n;
    };
    const dg = (t: number) => {
      const x = Math.round(t);
      if (x < 0 || x >= img.width) return 0;
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yi = Math.round(y + dy);
        if (yi >= 0 && yi < img.height) { s += dgAt(img, x, yi); n++; }
      }
      return s / n;
    };
    const r = findWhToDgEdge(luma, dg, EXP_LEFT, 1, "LEFT");
    if (r === null) continue;
    r.pos = y;
    out.push(r);
  }
  return { detections: rejectOutliers(out) };
}

function detectRightBorder(img: Img): BorderCurve {
  const out: DetectionPoint[] = [];
  for (let y = EXP_TOP; y < EXP_BOT; y += STEP) {
    const luma = (t: number) => {
      const x = Math.round(t);
      if (x < 0 || x >= img.width) return 0;
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yi = Math.round(y + dy);
        if (yi >= 0 && yi < img.height) { s += lumaAt(img, x, yi); n++; }
      }
      return s / n;
    };
    const dg = (t: number) => {
      const x = Math.round(t);
      if (x < 0 || x >= img.width) return 0;
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yi = Math.round(y + dy);
        if (yi >= 0 && yi < img.height) { s += dgAt(img, x, yi); n++; }
      }
      return s / n;
    };
    const r = findWhToDgEdge(luma, dg, EXP_RIGHT, -1, "RIGHT");
    if (r === null) continue;
    r.pos = y;
    out.push(r);
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

  const debugFile = outFile.replace(/\.png$/, ".json");
  await fs.writeFile(debugFile, JSON.stringify({ top, bot, lft, rgt }, null, 2));

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
