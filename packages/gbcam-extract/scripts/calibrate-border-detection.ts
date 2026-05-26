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
const MIN_DG_RISE = 18;

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
): { rawPerp: number; score: number; outerVariance: number; aboveL: number } | null {
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

  // FIRST-EDGE DETECTION
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

  const mFinal = measure(firstE);
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

  return { rawPerp: lo + firstE + off, score: mFinal.score, outerVariance: mFinal.outerVariance, aboveL: mFinal.aboveL };
}

function solveLinearSystem(A: number[][], B: number[]): number[] | null {
    const n = B.length;
    for (let i = 0; i < n; i++) {
        let max = i;
        for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
        [A[i], A[max]] = [A[max], A[i]];
        [B[i], B[max]] = [B[max], B[i]];
        if (Math.abs(A[i][i]) < 1e-12) return null;
        for (let j = i + 1; j < n; j++) {
            const ratio = A[j][i] / A[i][i];
            B[j] -= ratio * B[i];
            for (let k = i; k < n; k++) A[j][k] -= ratio * A[i][k];
        }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) sum += A[i][j] * x[j];
        x[i] = (B[i] - sum) / A[i][i];
    }
    return x;
}

async function main() {
  const dir = "../../warp-hand-edited-points-branch-warp-and-diagnostics-subagent-plan-2026-05-23";
  const gt = JSON.parse(await fs.readFile(path.join(dir, "ground-truth.json"), "utf8"));

  const allData: Record<string, { x: number[]; y: number[]; l: number[]; s: number[] }> = {
    TOP: { x: [], y: [], l: [], s: [] },
    BOT: { x: [], y: [], l: [], s: [] },
    LEFT: { x: [], y: [], l: [], s: [] },
    RIGHT: { x: [], y: [], l: [], s: [] }
  };

  for (const imgEntry of gt.images) {
    const warpFile = path.join(dir, imgEntry.file);
    const img = await loadRaw(warpFile);

    const collectData = (sideName: string, points: any[], canon: number, direction: 1 | -1, horizontal: boolean) => {
      for (const p of points) {
        const pos = horizontal ? p.x : p.y;
        const targetPerp = horizontal ? p.y : p.x;
        if (Math.abs(targetPerp - canon) > 20) continue;

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
          const neededBias = direction === 1 ? (targetPerp - res.rawPerp) : (res.rawPerp - targetPerp);
          allData[sideName].x.push(res.outerVariance);
          allData[sideName].y.push(neededBias);
          allData[sideName].l.push(res.aboveL);
          allData[sideName].s.push(res.score);
        }
      }
    };

    collectData("TOP", imgEntry.top, CANON_TOP, 1, true);
    collectData("BOT", imgEntry.bot, CANON_BOT, -1, true);
    collectData("LEFT", imgEntry.left, CANON_LEFT, 1, false);
    collectData("RIGHT", imgEntry.right, CANON_RIGHT, -1, false);
  }

  const results: any[] = [];
  for (const side of ["TOP", "BOT", "LEFT", "RIGHT"]) {
    const d = allData[side];
    if (d.x.length < 5) continue;

    const n = d.y.length;
    const X = [d.x, d.l, d.s, new Array(n).fill(1)];
    const m = X.length;
    const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    const B: number[] = new Array(m).fill(0);
    
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
            for (let k = 0; k < n; k++) A[i][j] += X[i][k] * X[j][k];
        }
        for (let k = 0; k < n; k++) B[i] += X[i][k] * d.y[k];
    }
    
    const sol = solveLinearSystem(A, B);
    if (sol) {
        const [a, b, c, offset] = sol;
        console.log(`\nOPTIMIZED 3D MODEL FOR ${side}:`);
        console.log(`  bias = ${offset.toFixed(4)} + (${a.toFixed(4)})*var + (${b.toFixed(4)})*luma + (${c.toFixed(4)})*score`);
        let err = 0;
        for (let k=0; k<n; k++) err += Math.abs(d.y[k] - (a*d.x[k] + b*d.l[k] + c*d.s[k] + offset));
        console.log(`  Mean residual error: ${(err/n).toFixed(2)}px`);
        results.push({ side, a, b, c, offset });
    }
  }

  console.log("\nPER-IMAGE VALIDATION (FIRST-EDGE 3D):");
  for (const imgEntry of gt.images) {
    const warpFile = path.join(dir, imgEntry.file);
    const img = await loadRaw(warpFile);
    process.stdout.write(`${imgEntry.file.padEnd(45)}`);

    for (const sideName of ["TOP", "BOT", "LEFT", "RIGHT"]) {
      const model = results.find(r => r.side === sideName);
      if (!model) { process.stdout.write(` ${sideName[0]}:  N/A`); continue; }
      const direction = (sideName === "TOP" || sideName === "LEFT") ? 1 : -1;
      const canon = sideName === "TOP" ? CANON_TOP : sideName === "BOT" ? CANON_BOT : sideName === "LEFT" ? CANON_LEFT : CANON_RIGHT;
      const horizontal = (sideName === "TOP" || sideName === "BOT");
      const points = imgEntry[sideName.toLowerCase()];
      let sumBias = 0, count = 0;
      for (const p of points) {
        const targetPerp = horizontal ? p.y : p.x;
        if (Math.abs(targetPerp - canon) > 20) continue;
        const pos = horizontal ? p.x : p.y;
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
          const predictedBias = model.a * res.outerVariance + model.b * res.aboveL + model.c * res.score + model.offset;
          const detected = res.rawPerp + direction * predictedBias;
          sumBias += (detected - targetPerp) * direction;
          count++;
        }
      }
      process.stdout.write(` ${sideName[0]}:${(count > 0 ? sumBias / count : 0).toFixed(2).padStart(5)}`);
    }
    console.log();
  }
}

main();
