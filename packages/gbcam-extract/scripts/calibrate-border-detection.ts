/**
 * calibrate-border-detection.ts — compares algorithmic detections against hand-edited points.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCALE = 8;
const CANON_TOP = 120;
const CANON_BOT = 1031;
const CANON_LEFT = 120;
const CANON_RIGHT = 1159;

const SEARCH_HALF = 3 * SCALE;
const ABOVE_MIN_LUMA = 40;
const MIN_DG_RISE = 20;

type Img = { data: Uint8Array; width: number; height: number; channels: number };

async function loadRaw(file: string): Promise<Img> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels };
}

function px(img: Img, x: number, y: number, c: 0 | 1 | 2): number {
  return img.data[(y * img.width + x) * img.channels + c];
}

function dgAt(img: Img, x: number, y: number): number {
  const r = px(img, x, y, 0), g = px(img, x, y, 1), b = px(img, x, y, 2);
  const v = 2 * b - r - g;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function lumaAt(img: Img, x: number, y: number): number {
  return 0.299 * px(img, x, y, 0) + 0.587 * px(img, x, y, 1) + 0.114 * px(img, x, y, 2);
}

function findRawEdge(
  luma: (t: number) => number,
  dg: (t: number) => number,
  canonical: number,
  direction: 1 | -1,
): { rawPerp: number; score: number; outerVariance: number } | null {
  const lo = Math.floor(canonical - SEARCH_HALF);
  const hi = Math.ceil(canonical + SEARCH_HALF);
  const rawLuma: number[] = [];
  const rawDg: number[] = [];
  for (let t = lo; t <= hi; t++) {
    rawLuma.push(luma(t));
    rawDg.push(dg(t));
  }
  
  const valsLuma: number[] = [];
  const valsDg: number[] = [];
  const K = 4;
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

  const R = 6;
  const measure = (e: number) => {
    let aboveSumL = 0, belowSumL = 0;
    let aboveSumD = 0, belowSumD = 0;
    const aboveVals: number[] = [];
    for (let i = 1; i <= R; i++) {
      const oi = direction === 1 ? e - i : e + i;
      const ii = direction === 1 ? e + i : e - i;
      aboveSumL += valsLuma[oi];
      belowSumL += valsLuma[ii];
      aboveSumD += valsDg[oi];
      belowSumD += valsDg[ii];
      aboveVals.push(valsLuma[oi]);
    }
    const aboveL = aboveSumL / R;
    const belowL = belowSumL / R;
    
    let v = 0;
    for (const val of aboveVals) v += (val - aboveL) ** 2;
    const outerVariance = Math.sqrt(v / R);

    const drop = aboveL - belowL;
    const dgRise = (belowSumD - aboveSumD) / R;
    return { score: drop + dgRise, aboveL, outerVariance };
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

  const m = measure(firstE);
  const f = (e: number): number => measure(e).score;
  const a = f(firstE - 1), b = f(firstE), c = f(firstE + 1);

  let off = 0;
  const denom = a - 2 * b + c;
  if (Math.abs(denom) > 1e-6) {
    off = 0.5 * (a - c) / denom;
    off = Math.max(-0.5, Math.min(0.5, off));
  }

  return { rawPerp: lo + firstE + off, score: b, outerVariance: m.outerVariance };
}

async function main() {
  const dir = "../../warp-hand-edited-points-branch-warp-and-diagnostics-subagent-plan-2026-05-23";
  const gt = JSON.parse(await fs.readFile(path.join(dir, "ground-truth.json"), "utf8"));

  for (const imgEntry of gt.images) {
    const warpFile = path.join(dir, imgEntry.file);
    const img = await loadRaw(warpFile);
    console.log(`Analyzing ${imgEntry.file}...`);

    const analyzeSide = (sideName: string, points: any[], canon: number, direction: 1 | -1, horizontal: boolean) => {
      const data: any[] = [];
      for (const p of points) {
        const pos = horizontal ? p.x : p.y;
        const targetPerp = horizontal ? p.y : p.x;

        const lumaSampler = (t: number) => {
          const x = horizontal ? pos : Math.round(t);
          const y = horizontal ? Math.round(t) : pos;
          let s = 0, n = 0;
          for (let d = -4; d <= 4; d++) {
            const xi = horizontal ? Math.round(x + d) : x;
            const yi = horizontal ? y : Math.round(y + d);
            if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += lumaAt(img, xi, yi); n++; }
          }
          return s / n;
        };
        const dgSampler = (t: number) => {
          const x = horizontal ? pos : Math.round(t);
          const y = horizontal ? Math.round(t) : pos;
          let s = 0, n = 0;
          for (let d = -4; d <= 4; d++) {
            const xi = horizontal ? Math.round(x + d) : x;
            const yi = horizontal ? y : Math.round(y + d);
            if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += dgAt(img, xi, yi); n++; }
          }
          return s / n;
        };

        const res = findRawEdge(lumaSampler, dgSampler, canon, direction);
        if (res) {
          const v = res.outerVariance;
          let bias = 0;
          if (sideName === "TOP") bias = Math.max(2.5, 9.0 - 6.3 * v);
          else if (sideName === "BOT") bias = Math.max(4.0, 9.0 - 4.0 * v);
          else if (sideName === "LEFT") bias = Math.max(5.0, 11.0 - 1.2 * v);
          else if (sideName === "RIGHT") bias = Math.max(6.0, 9.0 - 0.8 * v);

          const detectedPerp = res.rawPerp + direction * bias;
          const error = direction * (targetPerp - detectedPerp);
          data.push({ error });
        }
      }
      if (data.length > 0) {
        const sorted = [...data].sort((a, b) => a.error - b.error);
        const median = sorted[Math.floor(sorted.length / 2)].error;
        const filtered = data.filter(d => Math.abs(d.error - median) < 10);
        
        const meanError = filtered.reduce((a, b) => a + b.error, 0) / filtered.length;
        console.log(`  ${sideName.padEnd(5)}: n=${filtered.length}/${data.length}  meanError=${meanError.toFixed(2)}`);
      }
    };

    analyzeSide("TOP", imgEntry.top, CANON_TOP, 1, true);
    analyzeSide("BOT", imgEntry.bot, CANON_BOT, -1, true);
    analyzeSide("LEFT", imgEntry.left, CANON_LEFT, 1, false);
    analyzeSide("RIGHT", imgEntry.right, CANON_RIGHT, -1, false);
  }
}

main();
