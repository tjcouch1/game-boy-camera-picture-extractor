/**
 * debug.ts — Debug-data collector and image-drawing helpers used by every
 * pipeline step when `debug: true` is passed to `processPicture()`.
 *
 * The collector captures three things:
 *   - images:  named GBImageData buffers (PNG-renderable)
 *   - log:     human-readable diagnostic lines, in order
 *   - metrics: structured per-step metrics (numbers, arrays, objects)
 *
 * Drawing helpers are pure-JS (no opencv) so they work in browsers and Node.
 */

import { type GBImageData, createGBImageData } from "./common.js";

// ─── Types ───

export interface PipelineDebug {
  /**
   * Named debug images. Names follow the convention `<step>_<letter>_<topic>`
   * (e.g. `warp_a_corners`, `correct_b_white_surface`). The same name should
   * be used across runs so callers can diff outputs.
   */
  images: Record<string, GBImageData>;
  /** Diagnostic log lines emitted during the run, in execution order. */
  log: string[];
  /** Per-step structured metrics. Top-level keys are step names. */
  metrics: Record<string, Record<string, unknown>>;
}

export interface DebugCollector {
  addImage(name: string, img: GBImageData): void;
  log(message: string): void;
  setMetric(step: string, key: string, value: unknown): void;
  setMetrics(step: string, metrics: Record<string, unknown>): void;
  readonly data: PipelineDebug;
}

export function createDebugCollector(): DebugCollector {
  const data: PipelineDebug = { images: {}, log: [], metrics: {} };
  return {
    addImage(name, img) {
      data.images[name] = img;
    },
    log(message) {
      data.log.push(message);
    },
    setMetric(step, key, value) {
      if (!data.metrics[step]) data.metrics[step] = {};
      data.metrics[step][key] = value;
    },
    setMetrics(step, metrics) {
      if (!data.metrics[step]) data.metrics[step] = {};
      Object.assign(data.metrics[step], metrics);
    },
    data,
  };
}

// ─── Image utilities ───

/** Clone an RGBA image so callers can mutate it without affecting the source. */
export function cloneImage(img: GBImageData): GBImageData {
  const out = createGBImageData(img.width, img.height);
  out.data.set(img.data);
  return out;
}

/** Set a single pixel (no bounds check beyond a fast skip). */
function setPixel(
  img: GBImageData,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const idx = (y * img.width + x) * 4;
  img.data[idx] = r;
  img.data[idx + 1] = g;
  img.data[idx + 2] = b;
  img.data[idx + 3] = a;
}

/** Draw a filled axis-aligned rectangle with optional alpha blending. */
export function fillRect(
  img: GBImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: [number, number, number],
  alpha = 255,
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.floor(x + w));
  const y1 = Math.min(img.height, Math.floor(y + h));
  const a = alpha / 255;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * img.width + px) * 4;
      img.data[i] = Math.round(img.data[i] * (1 - a) + rgb[0] * a);
      img.data[i + 1] = Math.round(img.data[i + 1] * (1 - a) + rgb[1] * a);
      img.data[i + 2] = Math.round(img.data[i + 2] * (1 - a) + rgb[2] * a);
      img.data[i + 3] = 255;
    }
  }
}

/** Draw a hollow rectangle outline with the given pixel-thickness border. */
export function strokeRect(
  img: GBImageData,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: [number, number, number],
  thickness = 1,
): void {
  fillRect(img, x, y, w, thickness, rgb);
  fillRect(img, x, y + h - thickness, w, thickness, rgb);
  fillRect(img, x, y, thickness, h, rgb);
  fillRect(img, x + w - thickness, y, thickness, h, rgb);
}

/** Draw a filled disc (used for marker dots). */
export function fillCircle(
  img: GBImageData,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number],
): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(img.width - 1, Math.ceil(cx + radius));
  const y1 = Math.min(img.height - 1, Math.ceil(cy + radius));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) {
        setPixel(img, px, py, rgb[0], rgb[1], rgb[2]);
      }
    }
  }
}

/** Bresenham-style line draw (1 px wide). */
export function drawLine(
  img: GBImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
  thickness = 1,
): void {
  let xa = Math.round(x0);
  let ya = Math.round(y0);
  const xb = Math.round(x1);
  const yb = Math.round(y1);
  const dx = Math.abs(xb - xa);
  const dy = -Math.abs(yb - ya);
  const sx = xa < xb ? 1 : -1;
  const sy = ya < yb ? 1 : -1;
  let err = dx + dy;
  const half = Math.floor(thickness / 2);

  while (true) {
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        setPixel(img, xa + ox, ya + oy, rgb[0], rgb[1], rgb[2]);
      }
    }
    if (xa === xb && ya === yb) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      xa += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ya += sy;
    }
  }
}

/** Connect a sequence of points; closes the loop when `closed` is true. */
export function drawPolyline(
  img: GBImageData,
  points: Array<[number, number]>,
  rgb: [number, number, number],
  thickness = 1,
  closed = false,
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length - 1; i++) {
    drawLine(
      img,
      points[i][0],
      points[i][1],
      points[i + 1][0],
      points[i + 1][1],
      rgb,
      thickness,
    );
  }
  if (closed) {
    const a = points[points.length - 1];
    const b = points[0];
    drawLine(img, a[0], a[1], b[0], b[1], rgb, thickness);
  }
}

// ─── Colormap ───

/**
 * JET colormap approximation (blue → cyan → yellow → red).
 * Input t is normalised to [0, 1]; output is 8-bit RGB.
 */
export function jet(t: number): [number, number, number] {
  const tc = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, Math.min(4 * tc - 1.5, 4.5 - 4 * tc)));
  const g = Math.max(0, Math.min(1, Math.min(4 * tc - 0.5, 3.5 - 4 * tc)));
  const b = Math.max(0, Math.min(1, Math.min(4 * tc + 0.5, 2.5 - 4 * tc)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Render a 2-D scalar field as a JET heatmap RGBA image. Values are normalised
 * by the field's own min/max so the dynamic range is fully visible.
 */
export function renderHeatmap(
  field: Float32Array | Float64Array,
  width: number,
  height: number,
): GBImageData {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(hi - lo, 1e-6);
  const out = createGBImageData(width, height);
  for (let i = 0; i < field.length; i++) {
    const t = (field[i] - lo) / span;
    const [r, g, b] = jet(t);
    const j = i * 4;
    out.data[j] = r;
    out.data[j + 1] = g;
    out.data[j + 2] = b;
    out.data[j + 3] = 255;
  }
  return out;
}

// ─── Layout ───

/** Concatenate two RGBA images side-by-side (heights must match). */
export function hstack(a: GBImageData, b: GBImageData): GBImageData {
  if (a.height !== b.height) {
    throw new Error(`hstack: height mismatch ${a.height} vs ${b.height}`);
  }
  const W = a.width + b.width;
  const out = createGBImageData(W, a.height);
  for (let y = 0; y < a.height; y++) {
    out.data.set(
      a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4),
      y * W * 4,
    );
    out.data.set(
      b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4),
      (y * W + a.width) * 4,
    );
  }
  return out;
}

/** Nearest-neighbour upscale by integer factor (used for tiny output images). */
export function upscale(img: GBImageData, factor: number): GBImageData {
  if (factor < 1 || !Number.isInteger(factor)) {
    throw new Error(`upscale: factor must be a positive integer, got ${factor}`);
  }
  if (factor === 1) return cloneImage(img);
  const W = img.width * factor;
  const H = img.height * factor;
  const out = createGBImageData(W, H);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const si = (y * img.width + x) * 4;
      const r = img.data[si];
      const g = img.data[si + 1];
      const b = img.data[si + 2];
      const a = img.data[si + 3];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const di = ((y * factor + dy) * W + (x * factor + dx)) * 4;
          out.data[di] = r;
          out.data[di + 1] = g;
          out.data[di + 2] = b;
          out.data[di + 3] = a;
        }
      }
    }
  }
  return out;
}

/** Crop an axis-aligned region. */
export function cropImage(
  img: GBImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): GBImageData {
  const out = createGBImageData(w, h);
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * img.width + x) * 4;
    out.data.set(
      img.data.subarray(srcStart, srcStart + w * 4),
      row * w * 4,
    );
  }
  return out;
}

// ─── Charts ───

/**
 * Render an RG colour-space scatter plot.
 *
 * Each (R, G) sample is plotted at column R, row 255-G on a 256x256 canvas
 * with black background. Cluster centers and palette targets are drawn as
 * larger crosses so the user can see how well clustering matched the palette.
 */
export interface RGScatterMarker {
  r: number;
  g: number;
  color: [number, number, number];
  size?: number;
  symbol?: "cross" | "ring";
}

export function renderRGScatter(
  rValues: ArrayLike<number>,
  gValues: ArrayLike<number>,
  pointColors: Array<[number, number, number]>,
  markers: RGScatterMarker[] = [],
): GBImageData {
  const SIZE = 256;
  const out = createGBImageData(SIZE, SIZE);
  // Black background
  for (let i = 0; i < SIZE * SIZE; i++) {
    out.data[i * 4 + 3] = 255;
  }
  // Light grid every 64 units
  const gridRGB: [number, number, number] = [40, 40, 40];
  for (let g = 64; g < SIZE; g += 64) {
    for (let i = 0; i < SIZE; i++) {
      setPixel(out, g, i, gridRGB[0], gridRGB[1], gridRGB[2]);
      setPixel(out, i, g, gridRGB[0], gridRGB[1], gridRGB[2]);
    }
  }
  // Sample points
  const n = rValues.length;
  for (let i = 0; i < n; i++) {
    const r = Math.max(0, Math.min(255, Math.round(rValues[i])));
    const g = Math.max(0, Math.min(255, Math.round(gValues[i])));
    const px = r;
    const py = 255 - g;
    const c = pointColors[i] ?? [200, 200, 200];
    setPixel(out, px, py, c[0], c[1], c[2]);
  }
  // Markers
  for (const m of markers) {
    const px = Math.max(0, Math.min(255, Math.round(m.r)));
    const py = Math.max(0, Math.min(255, 255 - Math.round(m.g)));
    const size = m.size ?? 5;
    if ((m.symbol ?? "cross") === "cross") {
      drawLine(out, px - size, py, px + size, py, m.color, 2);
      drawLine(out, px, py - size, px, py + size, m.color, 2);
    } else {
      // ring
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        const x = px + Math.round(size * Math.cos(rad));
        const y = py + Math.round(size * Math.sin(rad));
        setPixel(out, x, y, m.color[0], m.color[1], m.color[2]);
      }
    }
  }
  return out;
}
