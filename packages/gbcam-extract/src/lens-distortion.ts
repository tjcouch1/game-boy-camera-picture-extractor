/**
 * lens-distortion.ts — Apply radial lens distortion correction to a BGR Mat.
 *
 * Calibration model: K = [[fx, 0, cx], [0, fy, cy], [0, 0, 1]] with fx=fy=W
 * (the source image width as a focal-length proxy for typical cellphone
 * cameras with ~70° FOV); principal point at the image centre. Distortion
 * uses only the first radial coefficient k1.
 */

import { getCV } from "./opencv.js";

export interface CameraIntrinsics {
  /** 3×3 camera matrix (cv.CV_64F). Caller must `.delete()` when done. */
  K: any;
}

/** Build camera-intrinsics calibration for a `W×H` image. */
export function makeCalibration(W: number, H: number): CameraIntrinsics {
  const cv = getCV();
  const K = cv.matFromArray(3, 3, cv.CV_64F, [
    W, 0, W / 2,
    0, W, H / 2,
    0, 0, 1,
  ]);
  return { K };
}

/**
 * Apply radial-distortion correction with the given k1 to a BGR Mat. Returns
 * a new Mat owned by the caller.
 */
export function undistortBgr(bgr: any, K: any, k1: number): any {
  const cv = getCV();
  const dist = cv.matFromArray(1, 5, cv.CV_64F, [k1, 0, 0, 0, 0]);
  const out = new cv.Mat();
  cv.undistort(bgr, out, K, dist);
  dist.delete();
  return out;
}
