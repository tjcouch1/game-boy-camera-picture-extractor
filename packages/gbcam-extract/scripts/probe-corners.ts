#!/usr/bin/env tsx
/*
 * Independently probe the inner-border corner positions in a warp PNG.
 * For each of the four corners, dumps:
 *  1. The current 1D detector's input profile (rowMeans / colMeans over a
 *     wide column / row band) and where its argmin-of-derivative + sub-px
 *     interpolation lands.
 *  2. A narrow-band local profile (cols/rows close to the corner only) and
 *     its argmin position.
 *  3. A 2D dark-mass centroid of the inner-border DG pixel near the corner.
 *
 * Usage: tsx scripts/probe-corners.ts <path-to-warp.png>
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { resolve } from "node:path";

const path = process.argv[2] ?? resolve(process.cwd(), "../../test-output/zelda-poster-3/debug/zelda-poster-3_warp.png");
const SCALE = 8;
const INNER_TOP = 15, INNER_LEFT = 15, INNER_BOT = 128, INNER_RIGHT = 144;
const SCREEN_W = 160, SCREEN_H = 144;

(async () => {
  const buf = readFileSync(path);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  console.log(`warp: ${W}x${H} channels=${C}`);

  // R-B+128 channel (matches what findBorderCorners uses).
  const rb = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * C], b = data[i * C + 2];
    rb[i] = Math.max(0, Math.min(255, r - b + 128));
  }
  // Grayscale (also useful).
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function rowMeansRB(r1: number, r2: number, c1: number, c2: number): number[] {
    const out: number[] = [];
    for (let r = r1; r < r2; r++) {
      let s = 0, n = 0;
      for (let c = c1; c < c2; c++) { s += rb[r * W + c]; n++; }
      out.push(n ? s / n : 0);
    }
    return out;
  }
  function colMeansRB(r1: number, r2: number, c1: number, c2: number): number[] {
    const out: number[] = [];
    for (let c = c1; c < c2; c++) {
      let s = 0, n = 0;
      for (let r = r1; r < r2; r++) { s += rb[r * W + c]; n++; }
      out.push(n ? s / n : 0);
    }
    return out;
  }
  // Match production warp.ts boxSmooth (always odd-width symmetric, with
  // mirror-reflect boundary handling).
  function boxSmooth(input: number[], width: number): number[] {
    if (width <= 1) return input.slice();
    const w = width % 2 === 0 ? width + 1 : width;
    const half = Math.floor(w / 2);
    const n = input.length;
    const output: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        let j = i + k;
        if (j < 0) j = -j;
        if (j >= n) j = 2 * n - 2 - j;
        j = Math.max(0, Math.min(n - 1, j));
        sum += input[j];
      }
      output[i] = sum / w;
    }
    return output;
  }
  function gaussian1d(p: number[], sigma: number): number[] {
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const k: number[] = [];
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      k.push(v); sum += v;
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const out = new Array(p.length).fill(0);
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
  function argminOfDerivative(p: number[]): number {
    if (p.length < 2) return 0;
    const d: number[] = [];
    for (let i = 0; i < p.length - 1; i++) d.push(p[i + 1] - p[i]);
    let k = 0, mn = d[0];
    for (let i = 1; i < d.length; i++) if (d[i] < mn) { mn = d[i]; k = i; }
    let delta = 0;
    if (k > 0 && k < d.length - 1) {
      const d0 = d[k - 1], d1 = d[k], d2 = d[k + 1];
      const den = d0 - 2 * d1 + d2;
      if (Math.abs(den) > 1e-10) delta = Math.max(-1, Math.min(1, 0.5 * (d0 - d2) / den));
    }
    return k + 1 + delta;
  }
  function firstDarkFromFrame(profile: number[], smoothSigma = 1.5, periodSmooth = SCALE): number {
    const prepped = periodSmooth > 1 ? boxSmooth(profile, periodSmooth) : profile;
    const p = gaussian1d(prepped, smoothSigma);
    return argminOfDerivative(p);
  }

  // Match findBorderCorners behavior:
  const srch = 6 * SCALE;
  const midCol = Math.floor((INNER_LEFT + INNER_RIGHT) / 2) * SCALE; // 79*8 = 632
  const midRow = Math.floor((INNER_TOP + INNER_BOT) / 2) * SCALE;     // 71*8 = 568

  const cLft: [number, number] = [Math.max(0, 10 * SCALE), midCol];
  const cRgt: [number, number] = [midCol, Math.min(W, 150 * SCALE)];
  const rTop: [number, number] = [Math.max(0, 10 * SCALE), midRow];
  const rBot: [number, number] = [midRow, Math.min(H, (SCREEN_H - 10) * SCALE)];

  function probeY(side: "top" | "bot", c0: number, c1: number, label: string) {
    const exp = side === "top" ? INNER_TOP * SCALE : (INNER_BOT + 1) * SCALE;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeansRB(r1, r2, c0, c1);
    const idx = firstDarkFromFrame(profile, 1.5, SCALE);
    const detected = side === "top" ? r1 + idx : (r2 - 1) - (firstDarkFromFrame([...profile].reverse(), 1.5, SCALE)) - (SCALE - 1);
    return { profile, r1, r2, c0, c1, idx, detected, label };
  }
  function probeX(side: "left" | "right", r0: number, r1_: number, label: string) {
    const exp = side === "left" ? INNER_LEFT * SCALE : (INNER_RIGHT + 1) * SCALE;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeansRB(r0, r1_, c1, c2);
    const idx = firstDarkFromFrame(profile, 1.5, SCALE);
    const detected = side === "left" ? c1 + idx : (c2 - 1) - (firstDarkFromFrame([...profile].reverse(), 1.5, SCALE)) - (SCALE - 1);
    return { profile, c1, c2, r0, r1_, idx, detected, label };
  }

  // The four corners use the wide bands as in findBorderCorners.
  const tlYprobe = probeY("top", cLft[0], cLft[1], "TL Y (wide)");
  const trYprobe = probeY("top", cRgt[0], cRgt[1], "TR Y (wide)");
  const blYprobe = probeY("bot", cLft[0], cLft[1], "BL Y (wide)");
  const brYprobe = probeY("bot", cRgt[0], cRgt[1], "BR Y (wide)");
  const tlXprobe = probeX("left", rTop[0], rTop[1], "TL X (wide)");
  const blXprobe = probeX("left", rBot[0], rBot[1], "BL X (wide)");
  const trXprobe = probeX("right", rTop[0], rTop[1], "TR X (wide)");
  const brXprobe = probeX("right", rBot[0], rBot[1], "BR X (wide)");

  console.log(`\n=== Wide-band detection (current findBorderCorners) ===`);
  console.log(`TL = (${tlXprobe.detected.toFixed(2)}, ${tlYprobe.detected.toFixed(2)})  [expected (120, 120)]`);
  console.log(`TR = (${trXprobe.detected.toFixed(2)}, ${trYprobe.detected.toFixed(2)})  [expected (1152, 120)]`);
  console.log(`BR = (${brXprobe.detected.toFixed(2)}, ${brYprobe.detected.toFixed(2)})  [expected (1152, 1024)]`);
  console.log(`BL = (${blXprobe.detected.toFixed(2)}, ${blYprobe.detected.toFixed(2)})  [expected (120, 1024)]`);

  // Narrow-band: cluster column range to ±2*scale around the *expected* corner column.
  function probeYNarrow(side: "top" | "bot", expectedX: number, label: string) {
    const c0 = Math.max(0, expectedX - 2 * SCALE);
    const c1 = Math.min(W, expectedX + 2 * SCALE);
    return probeY(side, c0, c1, label);
  }
  function probeXNarrow(side: "left" | "right", expectedY: number, label: string) {
    const r0 = Math.max(0, expectedY - 2 * SCALE);
    const r1 = Math.min(H, expectedY + 2 * SCALE);
    return probeX(side, r0, r1, label);
  }
  const tlY_n = probeYNarrow("top", INNER_LEFT * SCALE + SCALE / 2, "TL Y (±2 LCD-px around expectedX)");
  const trY_n = probeYNarrow("top", INNER_RIGHT * SCALE + SCALE / 2, "TR Y (narrow)");
  const blY_n = probeYNarrow("bot", INNER_LEFT * SCALE + SCALE / 2, "BL Y (narrow)");
  const brY_n = probeYNarrow("bot", INNER_RIGHT * SCALE + SCALE / 2, "BR Y (narrow)");
  const tlX_n = probeXNarrow("left", INNER_TOP * SCALE + SCALE / 2, "TL X (narrow)");
  const blX_n = probeXNarrow("left", INNER_BOT * SCALE + SCALE / 2, "BL X (narrow)");
  const trX_n = probeXNarrow("right", INNER_TOP * SCALE + SCALE / 2, "TR X (narrow)");
  const brX_n = probeXNarrow("right", INNER_BOT * SCALE + SCALE / 2, "BR X (narrow)");

  console.log(`\n=== Narrow-band detection (cols/rows ±2 LCD-px around expected corner) ===`);
  console.log(`TL = (${tlX_n.detected.toFixed(2)}, ${tlY_n.detected.toFixed(2)})`);
  console.log(`TR = (${trX_n.detected.toFixed(2)}, ${trY_n.detected.toFixed(2)})`);
  console.log(`BR = (${brX_n.detected.toFixed(2)}, ${brY_n.detected.toFixed(2)})`);
  console.log(`BL = (${blX_n.detected.toFixed(2)}, ${blY_n.detected.toFixed(2)})`);

  // 2D dark-mass centroid of the DG corner pixel.
  // Use a 5×5 LCD-pixel window (40×40 image-px) centred on the expected corner.
  // Threshold at 50th percentile of the local R-B+128 distribution; mass-weight
  // by max(0, threshold - rb[i]) so darker pixels (DG) weigh more.
  function darkCentroid2D(cx: number, cy: number, halfPx = 2.5 * SCALE) {
    const c0 = Math.max(0, Math.floor(cx - halfPx));
    const c1 = Math.min(W, Math.ceil(cx + halfPx));
    const r0 = Math.max(0, Math.floor(cy - halfPx));
    const r1 = Math.min(H, Math.ceil(cy + halfPx));
    // Threshold = midpoint of (min, max) within window.
    let mn = Infinity, mx = -Infinity;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const v = rb[r * W + c];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const thr = mn + (mx - mn) * 0.5;
    let sx = 0, sy = 0, sw = 0;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const v = rb[r * W + c];
        const w = Math.max(0, thr - v);
        sx += (c + 0.5) * w;
        sy += (r + 0.5) * w;
        sw += w;
      }
    }
    return sw > 0 ? [sx / sw - 0.5, sy / sw - 0.5] : [cx, cy];
  }
  // Centred on the centre of the DG corner pixel.
  const tlC = darkCentroid2D(INNER_LEFT * SCALE + SCALE / 2, INNER_TOP * SCALE + SCALE / 2);
  const trC = darkCentroid2D(INNER_RIGHT * SCALE + SCALE / 2, INNER_TOP * SCALE + SCALE / 2);
  const brC = darkCentroid2D(INNER_RIGHT * SCALE + SCALE / 2, INNER_BOT * SCALE + SCALE / 2);
  const blC = darkCentroid2D(INNER_LEFT * SCALE + SCALE / 2, INNER_BOT * SCALE + SCALE / 2);
  console.log(`\n=== 2D dark-mass centroid of inner-border DG corner (5x5 LCD-px window) ===`);
  console.log(`TL centroid = (${tlC[0].toFixed(2)}, ${tlC[1].toFixed(2)})  → outer-low = (${(tlC[0] - SCALE / 2).toFixed(2)}, ${(tlC[1] - SCALE / 2).toFixed(2)})`);
  console.log(`TR centroid = (${trC[0].toFixed(2)}, ${trC[1].toFixed(2)})  → outer-low = (${(trC[0] - SCALE / 2).toFixed(2)}, ${(trC[1] - SCALE / 2).toFixed(2)})`);
  console.log(`BR centroid = (${brC[0].toFixed(2)}, ${brC[1].toFixed(2)})  → outer-low = (${(brC[0] - SCALE / 2).toFixed(2)}, ${(brC[1] - SCALE / 2).toFixed(2)})`);
  console.log(`BL centroid = (${blC[0].toFixed(2)}, ${blC[1].toFixed(2)})  → outer-low = (${(blC[0] - SCALE / 2).toFixed(2)}, ${(blC[1] - SCALE / 2).toFixed(2)})`);

  // === New detector candidate: minimum-of-smoothed-profile ===
  // Algorithm:
  //   1. Symmetric box-smooth (odd-width = scale+1 for even scale) → centred
  //      smoothing without the asymmetric-window bias of the legacy detector.
  //   2. Gaussian sigma=1.0 for stability.
  //   3. Global min of smoothed profile within the search window
  //      = centre of the inner-border DG strip.
  //   4. Sub-pixel quadratic refinement around the minimum.
  //   5. Outer-low edge = strip_centre + 0.5 − scale/2 (converts the pixel-
  //      index minimum to the pixel-edge outer-low-coord edge of an
  //      8-pixel DG strip).
  function symBoxSmooth(p: number[], k: number): number[] {
    if (k <= 1) return p.slice();
    const half = Math.floor(k / 2);
    const out = new Array(p.length).fill(0);
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
  function dgStripOuterLow(profile: number[], scale: number, expectedCentreIdx: number): number {
    const sm = gaussian1d(symBoxSmooth(profile, scale + 1), 1.0);
    // Restrict search to ±2*scale around expected centre. This is the LCD-pixel
    // tolerance window — beyond this range the warp is too broken to recover
    // with a single-pass detector and we'd be picking up camera content noise.
    const lo = Math.max(0, Math.floor(expectedCentreIdx - 2 * scale));
    const hi = Math.min(sm.length - 1, Math.ceil(expectedCentreIdx + 2 * scale));
    let mi = lo, mv = sm[lo];
    for (let i = lo + 1; i <= hi; i++) if (sm[i] < mv) { mv = sm[i]; mi = i; }
    let delta = 0;
    if (mi > 0 && mi < sm.length - 1) {
      const v0 = sm[mi - 1], v1 = sm[mi], v2 = sm[mi + 1];
      const den = v0 - 2 * v1 + v2;
      if (Math.abs(den) > 1e-10) delta = Math.max(-1, Math.min(1, 0.5 * (v0 - v2) / den));
    }
    return (mi + delta) + 0.5 - scale / 2;
  }

  function newProbeY(side: "top" | "bot", c0: number, c1: number) {
    const exp = side === "top" ? INNER_TOP * SCALE : (INNER_BOT + 1) * SCALE;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeansRB(r1, r2, c0, c1);
    // The "centre of the DG strip" is at exp + scale/2 for top, exp - scale/2 for bottom.
    const expCentre = side === "top"
      ? INNER_TOP * SCALE + SCALE / 2 - r1
      : INNER_BOT * SCALE + SCALE / 2 - r1;
    return r1 + dgStripOuterLow(profile, SCALE, expCentre);
  }
  function newProbeX(side: "left" | "right", r0: number, r1_: number) {
    const exp = side === "left" ? INNER_LEFT * SCALE : (INNER_RIGHT + 1) * SCALE;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeansRB(r0, r1_, c1, c2);
    const expCentre = side === "left"
      ? INNER_LEFT * SCALE + SCALE / 2 - c1
      : INNER_RIGHT * SCALE + SCALE / 2 - c1;
    return c1 + dgStripOuterLow(profile, SCALE, expCentre);
  }

  console.log(`\n=== NEW: minimum-of-smoothed-profile (wide column band) ===`);
  console.log(`TL = (${newProbeX("left", rTop[0], rTop[1]).toFixed(2)}, ${newProbeY("top", cLft[0], cLft[1]).toFixed(2)})  [expected (120, 120)]`);
  console.log(`TR = (${newProbeX("right", rTop[0], rTop[1]).toFixed(2)}, ${newProbeY("top", cRgt[0], cRgt[1]).toFixed(2)})  [expected (1152, 120)]`);
  console.log(`BR = (${newProbeX("right", rBot[0], rBot[1]).toFixed(2)}, ${newProbeY("bot", cRgt[0], cRgt[1]).toFixed(2)})  [expected (1152, 1024)]`);
  console.log(`BL = (${newProbeX("left", rBot[0], rBot[1]).toFixed(2)}, ${newProbeY("bot", cLft[0], cLft[1]).toFixed(2)})  [expected (120, 1024)]`);

  // Narrow-band variant: only ±2 LCD-px around expected corner for the perpendicular axis.
  function newProbeYNarrow(side: "top" | "bot", expectedX: number) {
    const c0 = Math.max(0, expectedX - 2 * SCALE);
    const c1 = Math.min(W, expectedX + 2 * SCALE);
    return newProbeY(side, c0, c1);
  }
  function newProbeXNarrow(side: "left" | "right", expectedY: number) {
    const r0 = Math.max(0, expectedY - 2 * SCALE);
    const r1 = Math.min(H, expectedY + 2 * SCALE);
    return newProbeX(side, r0, r1);
  }
  console.log(`\n=== NEW: minimum-of-smoothed-profile (narrow corner-local band) ===`);
  console.log(`TL = (${newProbeXNarrow("left", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${newProbeYNarrow("top", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`TR = (${newProbeXNarrow("right", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${newProbeYNarrow("top", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BR = (${newProbeXNarrow("right", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${newProbeYNarrow("bot", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BL = (${newProbeXNarrow("left", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${newProbeYNarrow("bot", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);

  // === ALT: symmetric box-smooth + argmin-of-derivative (legacy logic, fixed boxSmooth) ===
  // The current detector's 2-px bias comes from boxSmooth using j=-half..+half-1
  // (asymmetric, biased -0.5). Switching to symmetric smoothing (j=-half..+half,
  // odd window) removes the bias while keeping the robust descent-detection.
  function firstDarkSym(profile: number[], smoothSigma = 1.5, periodSmooth = SCALE): number {
    // Use odd window = scale+1 for even scale.
    const width = periodSmooth % 2 === 0 ? periodSmooth + 1 : periodSmooth;
    const prepped = symBoxSmooth(profile, width);
    const p = gaussian1d(prepped, smoothSigma);
    return argminOfDerivative(p);
  }
  function altProbeY(side: "top" | "bot", c0: number, c1: number) {
    const exp = side === "top" ? INNER_TOP * SCALE : (INNER_BOT + 1) * SCALE;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeansRB(r1, r2, c0, c1);
    if (side === "top") return r1 + firstDarkSym(profile, 1.5, SCALE);
    const idx = firstDarkSym([...profile].reverse(), 1.5, SCALE);
    return (r2 - 1) - idx - (SCALE - 1);
  }
  function altProbeX(side: "left" | "right", r0: number, r1_: number) {
    const exp = side === "left" ? INNER_LEFT * SCALE : (INNER_RIGHT + 1) * SCALE;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeansRB(r0, r1_, c1, c2);
    if (side === "left") return c1 + firstDarkSym(profile, 1.5, SCALE);
    const idx = firstDarkSym([...profile].reverse(), 1.5, SCALE);
    return (c2 - 1) - idx - (SCALE - 1);
  }
  console.log(`\n=== ALT: symmetric-smooth + argmin-of-derivative (wide column band) ===`);
  console.log(`TL = (${altProbeX("left", rTop[0], rTop[1]).toFixed(2)}, ${altProbeY("top", cLft[0], cLft[1]).toFixed(2)})  [expected (120, 120)]`);
  console.log(`TR = (${altProbeX("right", rTop[0], rTop[1]).toFixed(2)}, ${altProbeY("top", cRgt[0], cRgt[1]).toFixed(2)})  [expected (1152, 120)]`);
  console.log(`BR = (${altProbeX("right", rBot[0], rBot[1]).toFixed(2)}, ${altProbeY("bot", cRgt[0], cRgt[1]).toFixed(2)})  [expected (1152, 1024)]`);
  console.log(`BL = (${altProbeX("left", rBot[0], rBot[1]).toFixed(2)}, ${altProbeY("bot", cLft[0], cLft[1]).toFixed(2)})  [expected (120, 1024)]`);

  // === ALT2: 80%-threshold-crossing scanning from DG floor outward ===
  // The "outer-low edge" of the DG strip is the first row/col, scanning from
  // the DG floor outward (toward WH frame), where smoothed R-B+128 has
  // returned 80% of the way back to WH baseline. This corresponds to where
  // the DG color is no longer visually "established" — i.e., the user's
  // perceived edge of the DG inner-border pixel.
  function dgEdgeOuterLow(profile: number[], scale: number, expectedCentreIdx: number, side: "low" | "high"): number {
    const sm = gaussian1d(symBoxSmooth(profile, scale + 1), 1.0);
    // Tight floor search: ±scale around expected centre.
    const tLo = Math.max(0, Math.floor(expectedCentreIdx - scale));
    const tHi = Math.min(sm.length - 1, Math.ceil(expectedCentreIdx + scale));
    let floor = Infinity, floorIdx = Math.round(expectedCentreIdx);
    for (let i = tLo; i <= tHi; i++) if (sm[i] < floor) { floor = sm[i]; floorIdx = i; }
    let baseline = -Infinity;
    for (let i = 0; i < sm.length; i++) if (sm[i] > baseline) baseline = sm[i];
    if (baseline - floor < 30) return expectedCentreIdx + 0.5 - scale / 2;
    // Threshold = floor + 0.2 * (baseline - floor) ≈ "80% of the way to DG floor".
    const threshold = floor + 0.2 * (baseline - floor);
    if (side === "low") {
      // Scan from floorIdx toward smaller i. Find largest i where sm[i] >= threshold.
      for (let i = floorIdx; i > 0; i--) {
        if (sm[i - 1] >= threshold) {
          const above = sm[i - 1], below = sm[i];
          const t = above > below ? (above - threshold) / (above - below) : 0.5;
          return (i - 1) + Math.max(0, Math.min(1, t));
        }
      }
      return 0;
    } else {
      // For BOT/RIGHT: outer-low edge is on the high-coord side of the DG strip
      // in the profile. Scan from floorIdx toward larger i. Find smallest i where sm[i] >= threshold.
      // outer-low edge = LOW-coord edge of DG strip = strip_centre - scale/2.
      // Equivalently, scanning from floor toward the camera-content side gives us the
      // edge of DG-toward-camera, which is also outer-low.
      for (let i = floorIdx; i < sm.length - 1; i++) {
        if (sm[i + 1] >= threshold) {
          const below = sm[i], above = sm[i + 1];
          const t = above > below ? (above - threshold) / (above - below) : 0.5;
          // Sub-pixel position of crossing (sm crosses threshold between i and i+1).
          const crossing = i + Math.max(0, Math.min(1, 1 - t));
          // outer-low edge = crossing - scale (= strip_centre - scale/2 if symmetric, but
          //  we want the LOW-coord edge, which is on the OTHER side of the strip).
          //  Actually for BOT/RIGHT the camera-facing edge IS the LOW-coord edge of DG.
          //  So the threshold-crossing on the camera-facing side = outer-low edge.
          // Wait no. For BOT, the DG strip is at rows 1024..1031. Camera at rows < 1024.
          // Scanning from floor (row 1027) toward LARGER i means scanning toward FRAME (rows > 1031).
          // That's the OPPOSITE of camera. So the threshold crossing on the "high-i" side
          // gives us the FRAME-facing edge of DG = OUTER-HIGH edge = row 1031.
          // For "outer-low" (= camera-facing = row 1024), I should scan toward SMALLER i.
          // Hmm let me just always scan toward the WH-side.
          return crossing;
        }
      }
      return sm.length - 1;
    }
  }
  function alt2ProbeY(side: "top" | "bot", c0: number, c1: number) {
    const exp = side === "top" ? INNER_TOP * SCALE : (INNER_BOT + 1) * SCALE;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeansRB(r1, r2, c0, c1);
    const expCentre = side === "top"
      ? INNER_TOP * SCALE + SCALE / 2 - r1
      : INNER_BOT * SCALE + SCALE / 2 - r1;
    // For TOP: WH is at rows < DG, so outer-low edge is on the LOW side (smaller i).
    // For BOT: camera is at rows < DG, so outer-low edge is also on the LOW side
    //         (since the camera-facing edge of bot DG = row 1024 < strip centre).
    const idx = dgEdgeOuterLow(profile, SCALE, expCentre, "low");
    return r1 + idx;
  }
  function alt2ProbeX(side: "left" | "right", r0: number, r1_: number) {
    const exp = side === "left" ? INNER_LEFT * SCALE : (INNER_RIGHT + 1) * SCALE;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeansRB(r0, r1_, c1, c2);
    const expCentre = side === "left"
      ? INNER_LEFT * SCALE + SCALE / 2 - c1
      : INNER_RIGHT * SCALE + SCALE / 2 - c1;
    const idx = dgEdgeOuterLow(profile, SCALE, expCentre, "low");
    return c1 + idx;
  }
  console.log(`\n=== ALT2: 80%-threshold-crossing on outer-low side (narrow band) ===`);
  function alt2YN(side: "top" | "bot", expectedX: number) {
    const c0 = Math.max(0, expectedX - 2 * SCALE);
    const c1 = Math.min(W, expectedX + 2 * SCALE);
    return alt2ProbeY(side, c0, c1);
  }
  function alt2XN(side: "left" | "right", expectedY: number) {
    const r0 = Math.max(0, expectedY - 2 * SCALE);
    const r1 = Math.min(H, expectedY + 2 * SCALE);
    return alt2ProbeX(side, r0, r1);
  }
  console.log(`TL = (${alt2XN("left", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${alt2YN("top", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`TR = (${alt2XN("right", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${alt2YN("top", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BR = (${alt2XN("right", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${alt2YN("bot", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BL = (${alt2XN("left", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${alt2YN("bot", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);

  // === ALT3: scan from WH-frame side toward DG strip; threshold-cross at 80% to floor ===
  // Profile is always passed in "frame-first" order: caller reverses profile for BOT/RIGHT.
  // - Smooths symmetrically.
  // - Finds DG floor in the tight ±scale window around expected centre.
  // - Computes WH baseline as max in the first quarter of the profile (always frame side).
  // - Threshold = floor + 0.2 × (baseline − floor).
  // - Returns the sub-pixel index where smoothed first drops below threshold,
  //   scanning from the FRAME side (low i) toward the DG strip.
  function firstDarkFromFrameV2(profile: number[], scale: number, expectedCentreIdx: number, frac = 0.1): number {
    const sm = gaussian1d(symBoxSmooth(profile, scale + 1), 1.0);
    const N = sm.length;
    // Floor: tight window around expected centre.
    const tLo = Math.max(0, Math.floor(expectedCentreIdx - scale));
    const tHi = Math.min(N - 1, Math.ceil(expectedCentreIdx + scale));
    let floor = Infinity, floorIdx = Math.round(expectedCentreIdx);
    for (let i = tLo; i <= tHi; i++) if (sm[i] < floor) { floor = sm[i]; floorIdx = i; }
    // Baseline: max in the first quarter (frame side; profile is frame-first).
    const baseEnd = Math.max(2, Math.floor(N / 4));
    let baseline = -Infinity;
    for (let i = 0; i < baseEnd; i++) if (sm[i] > baseline) baseline = sm[i];
    if (baseline - floor < 30) return expectedCentreIdx;
    const threshold = floor + frac * (baseline - floor);
    // Scan from frame side toward DG.
    for (let i = 0; i < floorIdx; i++) {
      if (sm[i + 1] < threshold && sm[i] >= threshold) {
        const above = sm[i], below = sm[i + 1];
        const t = (above - threshold) / (above - below);
        return i + Math.max(0, Math.min(1, t));
      }
    }
    return expectedCentreIdx;
  }
  function alt3ProbeY(side: "top" | "bot", c0: number, c1: number) {
    const exp = side === "top" ? INNER_TOP * SCALE : (INNER_BOT + 1) * SCALE;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeansRB(r1, r2, c0, c1);
    if (side === "top") {
      const expCentre = INNER_TOP * SCALE + SCALE / 2 - r1;
      return r1 + firstDarkFromFrameV2(profile, SCALE, expCentre, 0.3);
    }
    // BOT: reverse profile so frame side is first.
    const reversed = [...profile].reverse();
    // After reversing: index 0 = original (r2 - 1). DG strip centre in reversed coords =
    //   (profile.length - 1) - (INNER_BOT*SCALE + SCALE/2 - r1).
    const expCentreRev = (profile.length - 1) - (INNER_BOT * SCALE + SCALE / 2 - r1);
    const idx = firstDarkFromFrameV2(reversed, SCALE, expCentreRev, 0.3);
    // Map back: original-coord position of "outer-high edge" = (r2 - 1) - idx.
    // outer-low edge = outer-high - (scale - 1).
    return (r2 - 1) - idx - (SCALE - 1);
  }
  function alt3ProbeX(side: "left" | "right", r0: number, r1_: number) {
    const exp = side === "left" ? INNER_LEFT * SCALE : (INNER_RIGHT + 1) * SCALE;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeansRB(r0, r1_, c1, c2);
    if (side === "left") {
      const expCentre = INNER_LEFT * SCALE + SCALE / 2 - c1;
      return c1 + firstDarkFromFrameV2(profile, SCALE, expCentre, 0.3);
    }
    const reversed = [...profile].reverse();
    const expCentreRev = (profile.length - 1) - (INNER_RIGHT * SCALE + SCALE / 2 - c1);
    const idx = firstDarkFromFrameV2(reversed, SCALE, expCentreRev, 0.3);
    return (c2 - 1) - idx - (SCALE - 1);
  }
  function alt3YN(side: "top" | "bot", expectedX: number) {
    const c0 = Math.max(0, expectedX - 2 * SCALE);
    const c1 = Math.min(W, expectedX + 2 * SCALE);
    return alt3ProbeY(side, c0, c1);
  }
  function alt3XN(side: "left" | "right", expectedY: number) {
    const r0 = Math.max(0, expectedY - 2 * SCALE);
    const r1 = Math.min(H, expectedY + 2 * SCALE);
    return alt3ProbeX(side, r0, r1);
  }
  console.log(`\n=== ALT3: 80%-threshold-crossing scanned from frame side (narrow band) ===`);
  console.log(`TL = (${alt3XN("left", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${alt3YN("top", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`TR = (${alt3XN("right", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${alt3YN("top", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BR = (${alt3XN("right", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${alt3YN("bot", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BL = (${alt3XN("left", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${alt3YN("bot", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);

  // === ALT4: tight ±scale argmin → strip centre - scale/2 = outer-low ===
  // Find smoothed minimum within a tight ±scale (= ±1 LCD-px) window around the
  // expected DG strip centre. Sub-pixel quadratic interp around the minimum.
  // Convert centre → outer-low by subtracting scale/2 - 0.5 (pixel-edge convention).
  function dgStripCentreTight(profile: number[], scale: number, expectedCentreIdx: number): number {
    const sm = gaussian1d(symBoxSmooth(profile, scale + 1), 1.0);
    const N = sm.length;
    const tLo = Math.max(0, Math.floor(expectedCentreIdx - scale));
    const tHi = Math.min(N - 1, Math.ceil(expectedCentreIdx + scale));
    let mi = tLo, mv = sm[tLo];
    for (let i = tLo + 1; i <= tHi; i++) if (sm[i] < mv) { mv = sm[i]; mi = i; }
    let delta = 0;
    if (mi > 0 && mi < N - 1) {
      const v0 = sm[mi - 1], v1 = sm[mi], v2 = sm[mi + 1];
      const den = v0 - 2 * v1 + v2;
      if (Math.abs(den) > 1e-10) delta = Math.max(-1, Math.min(1, 0.5 * (v0 - v2) / den));
    }
    // Strip centre, in pixel-edge coords, is at (mi+delta) + 0.5 (pixel N's centre is at edge N+0.5).
    // Outer-low edge = strip_centre - scale/2 = (mi+delta) + 0.5 - scale/2.
    return (mi + delta) + 0.5 - scale / 2;
  }
  function alt4ProbeY(side: "top" | "bot", c0: number, c1: number) {
    const exp = side === "top" ? INNER_TOP * SCALE : (INNER_BOT + 1) * SCALE;
    const r1 = Math.max(0, exp - srch);
    const r2 = Math.min(H, exp + srch);
    const profile = rowMeansRB(r1, r2, c0, c1);
    const expCentre = side === "top"
      ? INNER_TOP * SCALE + SCALE / 2 - r1
      : INNER_BOT * SCALE + SCALE / 2 - r1;
    return r1 + dgStripCentreTight(profile, SCALE, expCentre);
  }
  function alt4ProbeX(side: "left" | "right", r0: number, r1_: number) {
    const exp = side === "left" ? INNER_LEFT * SCALE : (INNER_RIGHT + 1) * SCALE;
    const c1 = Math.max(0, exp - srch);
    const c2 = Math.min(W, exp + srch);
    const profile = colMeansRB(r0, r1_, c1, c2);
    const expCentre = side === "left"
      ? INNER_LEFT * SCALE + SCALE / 2 - c1
      : INNER_RIGHT * SCALE + SCALE / 2 - c1;
    return c1 + dgStripCentreTight(profile, SCALE, expCentre);
  }
  function alt4YN(side: "top" | "bot", expectedX: number) {
    const c0 = Math.max(0, expectedX - 2 * SCALE);
    const c1 = Math.min(W, expectedX + 2 * SCALE);
    return alt4ProbeY(side, c0, c1);
  }
  function alt4XN(side: "left" | "right", expectedY: number) {
    const r0 = Math.max(0, expectedY - 2 * SCALE);
    const r1 = Math.min(H, expectedY + 2 * SCALE);
    return alt4ProbeX(side, r0, r1);
  }
  console.log(`\n=== ALT4: ±scale argmin → centre−scale/2 (narrow band) ===`);
  console.log(`TL = (${alt4XN("left", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${alt4YN("top", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`TR = (${alt4XN("right", INNER_TOP * SCALE + SCALE / 2).toFixed(2)}, ${alt4YN("top", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BR = (${alt4XN("right", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${alt4YN("bot", INNER_RIGHT * SCALE + SCALE / 2).toFixed(2)})`);
  console.log(`BL = (${alt4XN("left", INNER_BOT * SCALE + SCALE / 2).toFixed(2)}, ${alt4YN("bot", INNER_LEFT * SCALE + SCALE / 2).toFixed(2)})`);

  // Dump per-row R-B+128 mean for the TL corner using narrow column band.
  console.log(`\n=== TL Y profile, narrow column band (cols ${INNER_LEFT * SCALE - 2 * SCALE}..${INNER_LEFT * SCALE + 2 * SCALE}) ===`);
  console.log(`row | rb mean (smoothed by box=8 then gauss=1.5)`);
  const profile = tlY_n.profile;
  const sm = gaussian1d(boxSmooth(profile, SCALE), 1.5);
  for (let i = 0; i < profile.length; i++) {
    const r = tlY_n.r1 + i;
    console.log(`${r.toString().padStart(4)} | raw=${profile[i].toFixed(1).padStart(6)}  smoothed=${sm[i].toFixed(1).padStart(6)}  ${i > 0 ? `Δ=${(sm[i] - sm[i-1]).toFixed(1).padStart(6)}` : ''}`);
  }
})();
