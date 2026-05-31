/**
 * calibrate-border-detection.ts — analyzes detector accuracy against ground truth.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SCALE = 8;
const CANON_TOP = 120, CANON_BOT = 1031, CANON_LEFT = 120, CANON_RIGHT = 1159;

type Img = { data: Uint8Array; width: number; height: number; channels: number };

async function loadRaw(file: string): Promise<Img> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels };
}

function px(img: Img, x: number, y: number, c: 0 | 1 | 2): number {
  if (x < 0 || x >= img.width || y < 0 || y >= img.height) return 0;
  return img.data[(y * img.width + x) * img.channels + c];
}

function dgAt(img: Img, x: number, y: number): number {
  const r = px(img, x, y, 0), g = px(img, x, y, 1), b = px(img, x, y, 2);
  const v = 2 * b - r - g; return v < 0 ? 0 : v > 255 ? 255 : v;
}

function lumaAt(img: Img, x: number, y: number): number {
  return 0.299 * px(img, x, y, 0) + 0.587 * px(img, x, y, 1) + 0.114 * px(img, x, y, 2);
}

/**
 * Robust Step-Transition Detector.
 * Instead of simple gradient, we find the point where the signal matches a WH -> DG step.
 * Signature: clip(Luma - DG, 0, 255). 
 * For WH: 255 - 0 = 255. 
 * For DG: 100 - 200 = -100 -> 0.
 * So we look for a step from 255 to 0.
 */
function findStepTransition(
  luma: (t: number) => number,
  dg: (t: number) => number,
  searchPos: number,
  direction: 1 | -1,
): { rawPerp: number; score: number; luma: number; variance: number } | null {
  const R_SEARCH = 4 * SCALE;
  const lo = Math.floor(searchPos - R_SEARCH), hi = Math.ceil(searchPos + R_SEARCH);
  const sig: number[] = [];
  const lum: number[] = [];
  for (let t = lo; t <= hi; t++) {
    const l = luma(t), d = dg(t);
    sig.push(Math.max(0, l - d));
    lum.push(l);
  }
  
  // Smoothing (Radius 3 = 7-tap)
  const sm: number[] = [];
  const K = 3;
  for (let i = 0; i < sig.length; i++) {
    let s = 0, n = 0; for (let j = -K; j <= K; j++) { const k = i + j; if (k >= 0 && k < sig.length) { s += sig[k]; n++; } }
    sm.push(s / n);
  }

  // Find max drop
  let bestE = -1, maxDrop = -1;
  const R = 6;
  for (let i = R; i < sm.length - R; i++) {
    const drop = direction === 1 ? (sm[i-R] - sm[i+R]) : (sm[i+R] - sm[i-R]);
    if (drop > maxDrop) { maxDrop = drop; bestE = i; }
  }
  if (bestE < 0 || maxDrop < 20) return null;

  // Refine to 50% crossing of the local max/min
  let localMax = -Infinity, localMin = Infinity;
  for (let i = bestE - R; i <= bestE + R; i++) {
    localMax = Math.max(localMax, sm[i]);
    localMin = Math.min(localMin, sm[i]);
  }
  const thresh = (localMax + localMin) / 2;
  let crossE = bestE;
  if (direction === 1) {
      for (let i = bestE - R; i < bestE + R; i++) if (sm[i] >= thresh && sm[i+1] < thresh) {
          const t = (sm[i] - thresh) / (sm[i] - sm[i+1]);
          crossE = i + t; break;
      }
  } else {
      for (let i = bestE + R; i > bestE - R; i--) if (sm[i] >= thresh && sm[i-1] < thresh) {
          const t = (sm[i] - thresh) / (sm[i] - sm[i-1]);
          crossE = i - t; break;
      }
  }

  // Calculate local variance (blur indicator)
  let sumL = 0, sumL2 = 0, count = 0;
  for (let i = Math.max(0, bestE-K); i <= Math.min(lum.length-1, bestE+K); i++) {
      sumL += lum[i]; sumL2 += lum[i]**2; count++;
  }
  const avgL = sumL / count;
  const variance = Math.sqrt(Math.max(0, sumL2 / count - avgL**2));

  return { rawPerp: lo + crossE, score: maxDrop, luma: lum[bestE], variance };
}

function solveRidge(X: number[][], Y: number[], lambda: number): number[] | null {
    const n = Y.length, m = X.length;
    const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    const B: number[] = new Array(m).fill(0);
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
            for (let k = 0; k < n; k++) A[i][j] += X[i][k] * X[j][k];
            if (i === j) A[i][j] += lambda;
        }
        for (let k = 0; k < n; k++) B[i] += X[i][k] * Y[k];
    }
    return solveLinearSystem(A, B);
}

function solveLinearSystem(A: number[][], B: number[]): number[] | null {
    const n = B.length;
    for (let i = 0; i < n; i++) {
        let max = i; for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
        [A[i], A[max]] = [A[max], A[i]]; [B[i], B[max]] = [B[max], B[i]];
        if (Math.abs(A[i][i]) < 1e-12) return null;
        for (let j = i + 1; j < n; j++) { const r = A[j][i] / A[i][i]; B[j] -= r * B[i]; for (let k = i; k < n; k++) A[j][k] -= r * A[i][k]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = 0; for (let j = i + 1; j < n; j++) s += A[i][j] * x[j]; x[i] = (B[i] - s) / A[i][i]; }
    return x;
}

async function main() {
  const dir = "../../warp-hand-edited-points-branch-warp-and-diagnostics-subagent-plan-2026-05-23";
  const gt = JSON.parse(await fs.readFile(path.join(dir, "ground-truth.json"), "utf8"));
  
  const sideData: Record<string, { luma: number[]; variance: number[]; dc: number[]; dc2: number[]; nb: number[] }> = {
    TOP: { luma: [], variance: [], dc: [], dc2: [], nb: [] }, BOT: { luma: [], variance: [], dc: [], dc2: [], nb: [] },
    LEFT: { luma: [], variance: [], dc: [], dc2: [], nb: [] }, RIGHT: { luma: [], variance: [], dc: [], dc2: [], nb: [] }
  };

  for (const imgEntry of gt.images) {
    const img = await loadRaw(path.join(dir, imgEntry.file));
    for (const sideName of ["TOP", "BOT", "LEFT", "RIGHT"]) {
        const horiz = (sideName === "TOP" || sideName === "BOT"), direction = (sideName === "TOP" || sideName === "LEFT") ? 1 : -1;
        const sideCenter = horiz ? (CANON_LEFT + CANON_RIGHT) / 2 : (CANON_TOP + CANON_BOT) / 2;
        const halfLen = horiz ? (CANON_RIGHT - CANON_LEFT) / 2 : (CANON_BOT - CANON_TOP) / 2;
        const pts = [...imgEntry[sideName.toLowerCase()], ... (sideName==="TOP"?[imgEntry.corners[0],imgEntry.corners[1]]:sideName==="BOT"?[imgEntry.corners[3],imgEntry.corners[2]]:sideName==="LEFT"?[imgEntry.corners[0],imgEntry.corners[3]]:[imgEntry.corners[1],imgEntry.corners[2]])];
        for (const p of pts) {
            const pos = horiz ? p.x : p.y, target = horiz ? p.y : p.x;
            const lS = (t: number) => {
              const x = horiz ? pos : Math.round(t), y = horiz ? Math.round(t) : pos;
              let s = 0, n = 0; for (let d = -8; d <= 8; d++) { // 17-tap longitudinal
                const xi = horiz ? Math.round(x+d) : x, yi = horiz ? y : Math.round(y+d);
                if (xi>=0 && xi<img.width && yi>=0 && yi<img.height) { s+=lumaAt(img,xi,yi); n++; }
              }
              return s / n;
            };
            const dS = (t: number) => {
              const x = horiz ? pos : Math.round(t), y = horiz ? Math.round(t) : pos;
              let s = 0, n = 0; for (let d = -8; d <= 8; d++) { // 17-tap longitudinal
                const xi = horiz ? Math.round(x+d) : x, yi = horiz ? y : Math.round(y+d);
                if (xi>=0 && xi<img.width && yi>=0 && yi<img.height) { s+=dgAt(img,xi,yi); n++; }
              }
              return s / n;
            };
            const res = findStepTransition(lS, dS, target, direction);
            if (res) {
                const dc = (pos - sideCenter) / halfLen;
                sideData[sideName].nb.push(direction === 1 ? (target - res.rawPerp) : (res.rawPerp - target));
                sideData[sideName].luma.push(res.luma); sideData[sideName].variance.push(res.variance);
                sideData[sideName].dc.push(dc); sideData[sideName].dc2.push(dc * dc);
            }
        }
    }
  }

  const models: Record<string, number[]> = {};
  for (const side of ["TOP", "BOT", "LEFT", "RIGHT"]) {
    const d = sideData[side]; if (d.nb.length < 5) continue;
    // Model: bias = a*luma + b*variance + c*dc + d*dc2 + offset
    const sol = solveRidge([d.luma, d.variance, d.dc, d.dc2, new Array(d.nb.length).fill(1)], d.nb, 0.1);
    if (sol) {
        models[side] = sol;
        console.log(`MODEL FOR ${side}: bias = ${sol[4].toFixed(4)} + (${sol[0].toFixed(4)})*luma + (${sol[1].toFixed(4)})*var + (${sol[2].toFixed(4)})*dc + (${sol[3].toFixed(4)})*dc2`);
    }
  }

  console.log("\nPER-IMAGE MAE VALIDATION:");
  for (const imgEntry of gt.images) {
    const img = await loadRaw(path.join(dir, imgEntry.file));
    process.stdout.write(`${imgEntry.file.padEnd(45)}`);
    for (const sideName of ["TOP", "BOT", "LEFT", "RIGHT"]) {
      const model = models[sideName]; if (!model) { process.stdout.write(` ${sideName[0]}: N/A `); continue; }
      const dir_ = (sideName === "TOP" || sideName === "LEFT") ? 1 : -1, horiz = (sideName === "TOP" || sideName === "BOT");
      const sideCenter = horiz ? (CANON_LEFT + CANON_RIGHT) / 2 : (CANON_TOP + CANON_BOT) / 2;
      const halfLen = horiz ? (CANON_RIGHT - CANON_LEFT) / 2 : (CANON_BOT - CANON_TOP) / 2;
      const pts = [...imgEntry[sideName.toLowerCase()], ... (sideName==="TOP"?[imgEntry.corners[0],imgEntry.corners[1]]:sideName==="BOT"?[imgEntry.corners[3],imgEntry.corners[2]]:sideName==="LEFT"?[imgEntry.corners[0],imgEntry.corners[3]]:[imgEntry.corners[1],imgEntry.corners[2]])];
      let sumAbsErr = 0, count = 0;
      for (const p of pts) {
        const pos = horiz ? p.x : p.y, target = horiz ? p.y : p.x;
        const lS = (t: number) => {
          const x = horiz ? pos : Math.round(t), y = horiz ? Math.round(t) : pos;
          let s = 0, n = 0; for (let d = -8; d <= 8; d++) {
            const xi = horiz ? Math.round(x+d) : x, yi = horiz ? y : Math.round(y+d);
            if (xi>=0 && xi<img.width && yi>=0 && yi<img.height) { s+=lumaAt(img,xi,yi); n++; }
          }
          return s / n;
        };
        const dS = (t: number) => {
          const x = horiz ? pos : Math.round(t), y = horiz ? Math.round(t) : pos;
          let s = 0, n = 0; for (let d = -8; d <= 8; d++) {
            const xi = horiz ? Math.round(x+d) : x, yi = horiz ? y : Math.round(y+d);
            if (xi>=0 && xi<img.width && yi>=0 && yi<img.height) { s+=dgAt(img,xi,yi); n++; }
          }
          return s / n;
        };
        const res = findStepTransition(lS, dS, target, dir_);
        if (res) {
          const dc = (pos - sideCenter) / halfLen;
          const predBias = model[0] * res.luma + model[1] * res.variance + model[2] * dc + model[3] * (dc * dc) + model[4];
          sumAbsErr += Math.abs(res.rawPerp + dir_ * predBias - target); count++;
        }
      }
      process.stdout.write(` ${sideName[0]}:${(count > 0 ? sumAbsErr / count : 0).toFixed(2).padStart(5)}`);
    }
    console.log();
  }
}

main();
