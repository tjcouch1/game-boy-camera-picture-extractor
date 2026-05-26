/**
 * border-curve-overlay.ts — dense per-pixel border detection + overlay
 *
 * Diagnoses what the inner DG border looks like in the warp output.
 * Uses a 3D adaptive bias model calibrated against hand-edited ground truth.
 *
 * Run: `node --experimental-strip-types scripts/border-curve-overlay.ts <warp.png|dir>`
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCALE = 8;
const EXP_TOP = 120;
const EXP_BOT = 1031;
const EXP_LEFT = 120;
const EXP_RIGHT = 1159;
const SEARCH_HALF = 3 * SCALE;
const ABOVE_MIN_LUMA = 40;
const MIN_DG_RISE = 18;
const OUTLIER_MAX_DEV = 15;
const STEP = SCALE / 2;

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

function dgAt(img: Img, x: number, y: number): number {
  const r = px(img, x, y, 0), g = px(img, x, y, 1), b = px(img, x, y, 2);
  const v = 2 * b - r - g;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function lumaAt(img: Img, x: number, y: number): number {
  return 0.299 * px(img, x, y, 0) + 0.587 * px(img, x, y, 1) + 0.114 * px(img, x, y, 2);
}

interface DetectionPoint { pos: number; perp: number; rawPerp: number; aboveL: number; outerVariance: number; score: number }
interface BorderCurve { detections: DetectionPoint[] }

/** 3D Model Coefficients (offset, var, luma, score) */
const COEFFS: Record<string, [number, number, number, number]> = {
    TOP:   [38.6797, -0.4796, -0.1492, -0.1290],
    BOT:   [2.0711, 0.5738, 0.0598, -0.2070],
    LEFT:  [16.3671, -0.3670, -0.0195, -0.1119],
    RIGHT: [21.4907, -1.0077, -0.0310, -0.1834]
};

function findWhToDgEdge(
  luma: (t: number) => number,
  dg: (t: number) => number,
  canonical: number,
  direction: 1 | -1,
  side: "TOP" | "BOT" | "LEFT" | "RIGHT",
): DetectionPoint | null {
  const lo = Math.floor(canonical - SEARCH_HALF);
  const hi = Math.ceil(canonical + SEARCH_HALF);
  const rawLuma: number[] = [], rawDg: number[] = [];
  for (let t = lo; t <= hi; t++) { rawLuma.push(luma(t)); rawDg.push(dg(t)); }
  
  const valsLuma: number[] = [], valsDg: number[] = [];
  const K = 4;
  for (let i = 0; i < rawLuma.length; i++) {
    let sl = 0, sd = 0, n = 0;
    for (let j = -K; j <= K; j++) {
      const k = i + j;
      if (k >= 0 && k < rawLuma.length) { sl += rawLuma[k]; sd += rawDg[k]; n++; }
    }
    valsLuma.push(sl / n); valsDg.push(sd / n);
  }

  const R = 6;
  const measure = (e: number) => {
    let aboveSumL = 0, belowSumL = 0, aboveSumD = 0, belowSumD = 0;
    const aboveVals: number[] = [];
    for (let i = 1; i <= R; i++) {
      const oi = direction === 1 ? e - i : e + i;
      const ii = direction === 1 ? e + i : e - i;
      aboveSumL += valsLuma[oi]; belowSumL += valsLuma[ii];
      aboveSumD += valsDg[oi]; belowSumD += valsDg[ii];
      aboveVals.push(valsLuma[oi]);
    }
    const aboveL = aboveSumL / R;
    let v = 0;
    for (const val of aboveVals) v += (val - aboveL) ** 2;
    return { aboveL, score: (aboveSumL - belowSumL) / R + (belowSumD - aboveSumD) / R, outerVariance: Math.sqrt(v / R) };
  };

  let firstE = -1;
  if (direction === 1) {
    for (let e = R; e < valsLuma.length - R; e++) {
      const m = measure(e);
      if (m.aboveL >= ABOVE_MIN_LUMA && m.score >= MIN_DG_RISE) { firstE = e; break; }
    }
  } else {
    for (let e = valsLuma.length - R - 1; e >= R; e--) {
      const m = measure(e);
      if (m.aboveL >= ABOVE_MIN_LUMA && m.score >= MIN_DG_RISE) { firstE = e; break; }
    }
  }
  if (firstE < 0) return null;

  const m = measure(firstE);
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
  const c = COEFFS[side];
  const bias = c[0] + c[1] * m.outerVariance + c[2] * m.aboveL + c[3] * m.score;

  return { pos: 0, perp: rawPerp + direction * bias, rawPerp, aboveL: m.aboveL, outerVariance: m.outerVariance, score: m.score };
}

function rejectOutliers(d: DetectionPoint[]): DetectionPoint[] {
  if (d.length < 5) return d;
  const out: DetectionPoint[] = [];
  for (let i = 0; i < d.length; i++) {
    const w: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(d.length - 1, i + 2); j++) if (j !== i) w.push(d[j].perp);
    w.sort((a, b) => a - b);
    if (Math.abs(d[i].perp - w[Math.floor(w.length / 2)]) <= OUTLIER_MAX_DEV) out.push(d[i]);
  }
  return out;
}

function detect(img: Img, side: "TOP" | "BOT" | "LEFT" | "RIGHT"): BorderCurve {
  const out: DetectionPoint[] = [];
  const horizontal = (side === "TOP" || side === "BOT");
  const canon = side === "TOP" ? EXP_TOP : side === "BOT" ? EXP_BOT : side === "LEFT" ? EXP_LEFT : EXP_RIGHT;
  const dir = (side === "TOP" || side === "LEFT") ? 1 : -1;
  const start = horizontal ? EXP_LEFT : EXP_TOP;
  const end = horizontal ? EXP_RIGHT : EXP_BOT;

  for (let p = start; p < end; p += STEP) {
    const luma = (t: number) => {
      const x = horizontal ? Math.round(p) : Math.round(t);
      const y = horizontal ? Math.round(t) : Math.round(p);
      let s = 0, n = 0;
      for (let d = -4; d <= 4; d++) {
        const xi = horizontal ? Math.round(x + d) : x;
        const yi = horizontal ? y : Math.round(y + d);
        if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += lumaAt(img, xi, yi); n++; }
      }
      return s / n;
    };
    const dg = (t: number) => {
      const x = horizontal ? Math.round(p) : Math.round(t);
      const y = horizontal ? Math.round(t) : Math.round(p);
      let s = 0, n = 0;
      for (let d = -4; d <= 4; d++) {
        const xi = horizontal ? Math.round(x + d) : x;
        const yi = horizontal ? y : Math.round(y + d);
        if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += dgAt(img, xi, yi); n++; }
      }
      return s / n;
    };
    const res = findWhToDgEdge(luma, dg, canon, dir, side);
    if (res) { res.pos = p; out.push(res); }
  }
  return { detections: rejectOutliers(out) };
}

function drawLine(img: Img, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  const dx = x1 - x0, dy = y1 - y0, steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    setPx(img, Math.round(x0 + dx * t), Math.round(y0 + dy * t), r, g, b);
  }
}

async function processOne(inFile: string, outFile: string): Promise<void> {
  const img = await loadRaw(inFile);
  const top = detect(img, "TOP"), bot = detect(img, "BOT"), lft = detect(img, "LEFT"), rgt = detect(img, "RIGHT");
  
  const stats = (curve: BorderCurve, canon: number, name: string): void => {
    const vals = curve.detections.map(d => d.perp);
    if (vals.length === 0) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.log(`  ${name}: n=${vals.length} meanBias=${(mean - canon).toFixed(2)}`);
  };
  console.log(path.basename(inFile));
  stats(top, EXP_TOP, "TOP  "); stats(bot, EXP_BOT, "BOT  "); stats(lft, EXP_LEFT, "LEFT "); stats(rgt, EXP_RIGHT, "RIGHT");

  const drawCurve = (curve: BorderCurve, horizontal: boolean) => {
    const d = curve.detections;
    for (let i = 0; i < d.length; i++) {
      const x = horizontal ? d[i].pos : d[i].perp, y = horizontal ? d[i].perp : d[i].pos;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) setPx(img, Math.round(x) + dx, Math.round(y) + dy, 255, 0, 255);
      if (i + 1 < d.length) drawLine(img, x, y, horizontal ? d[i + 1].pos : d[i + 1].perp, horizontal ? d[i + 1].perp : d[i + 1].pos, 255, 255, 0);
    }
  };
  drawCurve(top, true); drawCurve(bot, true); drawCurve(lft, false); drawCurve(rgt, false);
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } }).png().toFile(outFile);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputs = args.filter(a => !a.startsWith("-"));
  for (const inp of inputs) {
    const stat = await fs.stat(inp);
    if (stat.isDirectory()) {
      for (const f of await fs.readdir(inp)) if (f.endsWith("_warp.png")) await processOne(path.join(inp, f), path.join(inp, f.replace("_warp.png", "_warp_curve_overlay.png")));
    } else await processOne(inp, inp.replace(".png", "_curve_overlay.png"));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
