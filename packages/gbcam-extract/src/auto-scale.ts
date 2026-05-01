import { SCREEN_W, SCREEN_H } from "./common.js";

export type Point = [number, number];
export type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL

export interface AutoScaleResult {
  edgeLengths: { top: number; bottom: number; left: number; right: number };
  maxHorizontal: number;
  maxVertical: number;
  scale: number;
}

/**
 * Pick the smallest integer scale that does not downsample the detected
 * screen quad along either axis.
 *
 *   scale = max(1, ceil(max(maxHorizEdge / SCREEN_W, maxVertEdge / SCREEN_H)))
 */
export function computeAutoScale(corners: Corners): AutoScaleResult {
  const [TL, TR, BR, BL] = corners;
  const top = euclidean(TL, TR);
  const bottom = euclidean(BL, BR);
  const left = euclidean(TL, BL);
  const right = euclidean(TR, BR);
  const maxHorizontal = Math.max(top, bottom);
  const maxVertical = Math.max(left, right);
  const ratio = Math.max(maxHorizontal / SCREEN_W, maxVertical / SCREEN_H);
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const scale = Math.max(1, Math.ceil(safeRatio));
  return {
    edgeLengths: { top, bottom, left, right },
    maxHorizontal,
    maxVertical,
    scale,
  };
}

function euclidean(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}
