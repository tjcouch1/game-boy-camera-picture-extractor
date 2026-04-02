let cv: any = null;

export function getCV(): any {
  if (!cv) {
    throw new Error("OpenCV not initialized. Call initOpenCV() before using pipeline functions.");
  }
  return cv;
}

export async function initOpenCV(
  wasmPathOrModule?: string | any,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (cv) return;

  if (typeof wasmPathOrModule === "object" && wasmPathOrModule !== null) {
    cv = wasmPathOrModule;
    onProgress?.(100);
    return;
  }

  const path = wasmPathOrModule ?? "/opencv.js";

  return new Promise<void>((resolve, reject) => {
    (globalThis as any).Module = {
      onRuntimeInitialized: () => {
        cv = (globalThis as any).cv;
        onProgress?.(100);
        resolve();
      },
    };

    const script = document.createElement("script");
    script.src = path;
    script.async = true;
    script.onerror = () => reject(new Error(`Failed to load opencv.js from ${path}`));
    document.head.appendChild(script);
  });
}

export function withMats<T>(
  fn: (
    track: <M extends { delete(): void }>(m: M) => M,
    untrack: <M extends { delete(): void }>(m: M) => M,
  ) => T,
): T {
  const allocated = new Set<{ delete(): void }>();
  const track = <M extends { delete(): void }>(m: M): M => {
    allocated.add(m);
    return m;
  };
  const untrack = <M extends { delete(): void }>(m: M): M => {
    allocated.delete(m);
    return m;
  };
  try {
    return fn(track, untrack);
  } finally {
    for (const m of allocated) {
      m.delete();
    }
  }
}

export function imageDataToMat(img: { data: Uint8ClampedArray; width: number; height: number }): any {
  const c = getCV();
  const mat = new c.Mat(img.height, img.width, c.CV_8UC4);
  mat.data.set(img.data);
  return mat;
}

export function matToImageData(mat: any): { data: Uint8ClampedArray; width: number; height: number } {
  const c = getCV();
  let rgba: any;
  const channels = mat.channels();

  if (channels === 4) {
    rgba = mat;
  } else if (channels === 3) {
    rgba = new c.Mat();
    c.cvtColor(mat, rgba, c.COLOR_BGR2RGBA);
  } else if (channels === 1) {
    rgba = new c.Mat();
    c.cvtColor(mat, rgba, c.COLOR_GRAY2RGBA);
  } else {
    throw new Error(`Unsupported Mat channel count: ${channels}`);
  }

  const result = {
    data: new Uint8ClampedArray(rgba.data),
    width: rgba.cols,
    height: rgba.rows,
  };

  if (rgba !== mat) {
    rgba.delete();
  }

  return result;
}
