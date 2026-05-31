/**
 * border-curve-overlay.ts — dense per-pixel border detection + overlay
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCALE = 8;
const EXP_TOP = 120, EXP_BOT = 1031, EXP_LEFT = 120, EXP_RIGHT = 1159;
const SEARCH_HALF = 8 * SCALE, STEP = SCALE / 2;

type Img = { data: Uint8Array; width: number; height: number; channels: number };

async function loadRaw(file: string): Promise<Img> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels };
}

function px(img: Img, x: number, y: number, c: 0 | 1 | 2): number {
  const i = (y * img.width + x) * img.channels;
  return img.data[i + c];
}

function setPx(img: Img, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || x >= img.width || y < 0 || y >= img.height) return;
  const i = (y * img.width + x) * img.channels;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
}

function dgAt(img: Img, x: number, y: number): number {
  const r = px(img, x, y, 0), g = px(img, x, y, 1), b = px(img, x, y, 2);
  const v = 2 * b - r - g; return v < 0 ? 0 : v > 255 ? 255 : v;
}

function lumaAt(img: Img, x: number, y: number): number {
  return 0.299 * px(img, x, y, 0) + 0.587 * px(img, x, y, 1) + 0.114 * px(img, x, y, 2);
}

interface DetectionPoint { pos: number; perp: number; luma: number; score: number }

/** RIDGE SPATIAL MODEL Coefficients (luma, dc, dc2, offset) */
const COEFFS: Record<string, [number, number, number, number]> = {
    TOP:   [-0.0754, 0.2821, 5.7692, -4.0228],
    BOT:   [0.0114, 1.2960, 1.6506, 3.2540],
    LEFT:  [0.0018, 0.4695, -0.5391, 0.1378],
    RIGHT: [0.0160, 1.4675, -0.1872, 0.1451]
};

function findRefinedTransition(
  luma: (t: number) => number,
  dg: (t: number) => number,
  direction: 1 | -1,
  expected: number,
): { rawPerp: number; luma: number; score: number } | null {
  const lo = Math.floor(expected - SEARCH_HALF), hi = Math.ceil(expected + SEARCH_HALF);
  const vals: number[] = [];
  for (let t = lo; t <= hi; t++) vals.push(dg(t) + (255 - luma(t)));
  const sm: number[] = [];
  const K = 4;
  for (let i = 0; i < vals.length; i++) {
    let s = 0, n = 0; for (let j = -K; j <= K; j++) { const k = i+j; if (k>=0 && k<vals.length) { s+=vals[k]; n++; } }
    sm.push(s/n);
  }
  let bestE = -1, maxGrad = -1;
  for (let i = 1; i < sm.length - 1; i++) {
    const grad = direction === 1 ? (sm[i+1] - sm[i-1]) : (sm[i-1] - sm[i+1]);
    if (grad > maxGrad) { maxGrad = grad; bestE = i; }
  }
  if (bestE < 0) return null;
  const f = (idx: number) => {
    const i = Math.round(idx); if (i < 1 || i >= sm.length - 1) return 0;
    return direction === 1 ? (sm[i+1] - sm[i-1]) : (sm[i-1] - sm[i+1]);
  };
  const a = f(bestE - 1), b = f(bestE), c = f(bestE + 1);
  let off = 0; const den = a - 2*b + c;
  if (Math.abs(den) > 1e-6) { off = 0.5 * (a - c) / den; off = Math.max(-0.5, Math.min(0.5, off)); }
  const lS: number[] = []; for (let t = lo; t <= hi; t++) lS.push(luma(t));
  return { rawPerp: lo + bestE + off, luma: lS[bestE], score: maxGrad };
}

function detect(img: Img, side: "TOP" | "BOT" | "LEFT" | "RIGHT"): { detections: DetectionPoint[] } {
  const out: DetectionPoint[] = [];
  const horiz = (side === "TOP" || side === "BOT"), canon = side === "TOP" ? EXP_TOP : side === "BOT" ? EXP_BOT : side === "LEFT" ? EXP_LEFT : EXP_RIGHT;
  const dir = (side === "TOP" || side === "LEFT") ? 1 : -1, start = horiz ? EXP_LEFT : EXP_TOP, end = horiz ? EXP_RIGHT : EXP_BOT;
  const sideCenter = horiz ? (EXP_LEFT + EXP_RIGHT) / 2 : (EXP_TOP + EXP_BOT) / 2;
  const halfLen = horiz ? (EXP_RIGHT - EXP_LEFT) / 2 : (EXP_BOT - EXP_TOP) / 2;

  for (let p = start; p < end; p += STEP) {
    const lSampler = (t: number) => {
      const x = horiz ? Math.round(p) : Math.round(t), y = horiz ? Math.round(t) : Math.round(p);
      let s = 0, n = 0; for (let d = -32; d <= 32; d++) {
        const xi = horiz ? Math.round(x + d) : x, yi = horiz ? y : Math.round(y + d);
        if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += lumaAt(img, xi, yi); n++; }
      }
      return s / n;
    };
    const dSampler = (t: number) => {
      const x = horiz ? Math.round(p) : Math.round(t), y = horiz ? Math.round(t) : Math.round(p);
      let s = 0, n = 0; for (let d = -32; d <= 32; d++) {
        const xi = horiz ? Math.round(x + d) : x, yi = horiz ? y : Math.round(y + d);
        if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += dgAt(img, xi, yi); n++; }
      }
      return s / n;
    };
    const res = findRefinedTransition(lSampler, dSampler, dir, canon);
    if (res) {
        const dc = (p - sideCenter) / halfLen;
        const c = COEFFS[side];
        const bias = c[0] * res.luma + c[1] * dc + c[2] * (dc * dc) + c[3];
        out.push({ pos: p, perp: res.rawPerp + dir * bias, luma: res.luma, score: res.score });
    }
  }
  if (out.length < 5) return { detections: out };
  const filtered: DetectionPoint[] = [];
  for (let i = 0; i < out.length; i++) {
    const window: number[] = [];
    for (let j = Math.max(0, i - 5); j <= Math.min(out.length - 1, i + 5); j++) window.push(out[j].perp);
    window.sort((a, b) => a - b);
    filtered.push({ ...out[i], perp: window[Math.floor(window.length / 2)] });
  }
  return { detections: filtered };
}

async function processOne(inFile: string, outFile: string): Promise<void> {
  const img = await loadRaw(inFile);
  const top = detect(img, "TOP"), bot = detect(img, "BOT"), lft = detect(img, "LEFT"), rgt = detect(img, "RIGHT");
  const drawC = (c: { detections: DetectionPoint[] }, horiz: boolean) => {
    for (const d of c.detections) {
      const x = horiz ? d.pos : d.perp, y = horiz ? d.perp : d.pos;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) setPx(img, Math.round(x) + dx, Math.round(y) + dy, 255, 0, 255);
    }
  };
  drawC(top, true); drawC(bot, true); drawC(lft, false); drawC(rgt, false);
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } }).png().toFile(outFile);
  console.log(`Saved ${outFile}`);
}

async function main(): Promise<void> {
  const inputs = process.argv.slice(2).filter(a => !a.startsWith("-"));
  for (const inp of inputs) {
    const stat = await fs.stat(inp);
    if (stat.isDirectory()) { for (const f of await fs.readdir(inp)) if (f.endsWith("_warp.png")) await processOne(path.join(inp, f), path.join(inp, f.replace("_warp.png", "_warp_curve_overlay.png"))); }
    else await processOne(inp, inp.replace(".png", "_curve_overlay.png"));
  }
}

main().catch(console.error);
