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
const MIN_DG_RISE = 35; // Increased for better robustness

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
): { rawPerp: number; score: number } | null {
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
    for (let i = 1; i <= R; i++) {
      const oi = direction === 1 ? e - i : e + i;
      const ii = direction === 1 ? e + i : e - i;
      aboveSumL += valsLuma[oi];
      belowSumL += valsLuma[ii];
      aboveSumD += valsDg[oi];
      belowSumD += valsDg[ii];
    }
    const drop = (aboveSumL - belowSumL) / R;
    const dgRise = (belowSumD - aboveSumD) / R;
    return { score: drop + dgRise, aboveL: aboveSumL / R };
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

  return { rawPerp: lo + firstE + off, score: measure(firstE).score };
}

async function main() {
  const dir = "../../warp-hand-edited-points-branch-warp-and-diagnostics-subagent-plan-2026-05-23";
  const gt = JSON.parse(await fs.readFile(path.join(dir, "ground-truth.json"), "utf8"));

  const results: any[] = [];

  for (const imgEntry of gt.images) {
    const warpFile = path.join(dir, imgEntry.file);
    const img = await loadRaw(warpFile);
    console.log(`Analyzing ${imgEntry.file}...`);

    const analyzeSide = (sideName: string, points: any[], canon: number, direction: 1 | -1, horizontal: boolean) => {
      const errors: number[] = [];
      const rawPoints: any[] = [];
      for (const p of points) {
        const pos = horizontal ? p.x : p.y;
        const targetPerp = horizontal ? p.y : p.x;

        const lumaSampler = (t: number) => {
          const x = horizontal ? pos : Math.round(t);
          const y = horizontal ? Math.round(t) : pos;
          let s = 0, n = 0;
          for (let d = -2; d <= 2; d++) {
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
          for (let d = -2; d <= 2; d++) {
            const xi = horizontal ? Math.round(x + d) : x;
            const yi = horizontal ? y : Math.round(y + d);
            if (xi >= 0 && xi < img.width && yi >= 0 && yi < img.height) { s += dgAt(img, xi, yi); n++; }
          }
          return s / n;
        };

        const res = findRawEdge(lumaSampler, dgSampler, canon, direction);
        if (res) {
          const neededBias = direction === 1 ? (targetPerp - res.rawPerp) : (res.rawPerp - targetPerp);
          errors.push(neededBias);
          rawPoints.push({ pos, targetPerp, rawPerp: res.rawPerp, neededBias });
        }
      }
      if (errors.length > 0) {
        // Filter outliers: keep only those within 10px of the median
        const sorted = [...errors].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const filtered = errors.filter(e => Math.abs(e - median) < 10);
        
        const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
        console.log(`  ${sideName.padEnd(5)}: n=${filtered.length}/${errors.length}  meanNeededBias=${mean.toFixed(2)}  range=[${Math.min(...filtered).toFixed(2)}, ${Math.max(...filtered).toFixed(2)}]`);
        return mean;
      }
      return null;
    };

    const topBias = analyzeSide("TOP", imgEntry.top, CANON_TOP, 1, true);
    const botBias = analyzeSide("BOT", imgEntry.bot, CANON_BOT, -1, true);
    const leftBias = analyzeSide("LEFT", imgEntry.left, CANON_LEFT, 1, false);
    const rightBias = analyzeSide("RIGHT", imgEntry.right, CANON_RIGHT, -1, false);
    
    results.push({ file: imgEntry.file, topBias, botBias, leftBias, rightBias });
  }

  const avg = (key: string) => {
    const vals = results.map(r => r[key]).filter(v => v !== null);
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  console.log("\nAVERAGE NEEDED BIASES ACROSS IMAGES:");
  console.log(`  TOP   : ${avg("topBias").toFixed(2)}`);
  console.log(`  BOT   : ${avg("botBias").toFixed(2)}`);
  console.log(`  LEFT  : ${avg("leftBias").toFixed(2)}`);
  console.log(`  RIGHT : ${avg("rightBias").toFixed(2)}`);
}

main();
