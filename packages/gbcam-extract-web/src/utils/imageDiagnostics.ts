import type { GBImageData } from "gbcam-extract";

export interface CornerSamples {
  tl: [number, number, number, number];
  tr: [number, number, number, number];
  bl: [number, number, number, number];
  br: [number, number, number, number];
  center: [number, number, number, number];
}

export interface NormalizedSamples {
  q25_25: [number, number, number, number];
  q75_25: [number, number, number, number];
  q25_75: [number, number, number, number];
  q75_75: [number, number, number, number];
}

export interface LoadDiagnostics {
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;

  fileWidth: number | null;
  fileHeight: number | null;
  fileWidthSource: "jpeg-sof" | "png-ihdr" | "unknown";

  decodedWidth: number;
  decodedHeight: number;
  decodedSubsampled: boolean;

  inputPixelHash: string;
  inputCornerSamples: CornerSamples;
  inputNormalizedSamples: NormalizedSamples;

  userAgent: string;
  devicePixelRatio: number;
  canvasColorSpace: string;
  imageBitmapSupported: boolean;

  loaderPath: "createImageBitmap" | "image-fallback";
  loadMs: number;
}

export interface OutputDiagnostics {
  grayscaleHash: string;
  paletteHistogram: { BK: number; DG: number; LG: number; WH: number };
  intermediateHashes?: {
    warp: string;
    correct: string;
    crop: string;
    sample: string;
  };
}

/** FNV-1a 32-bit hash of bytes, returned as 8-char hex. */
export function hashBytes(buf: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

/**
 * Read JPEG/PNG file header to discover the image's true encoded dimensions —
 * independent of any browser-side subsampling.
 */
async function readFileHeaderDimensions(file: File): Promise<{
  width: number;
  height: number;
  source: "jpeg-sof" | "png-ihdr" | "unknown";
}> {
  const slice = file.slice(0, Math.min(file.size, 65536));
  const buf = new Uint8Array(await slice.arrayBuffer());

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR chunk starts at byte 8 (length(4) + "IHDR"(4) = 16)
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const w =
      ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0;
    const h =
      ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0;
    return { width: w, height: h, source: "png-ihdr" };
  }

  // JPEG: starts with FF D8. Walk markers looking for SOF (C0..CF except C4/C8/CC).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      // Skip fill bytes (0xFF padding)
      while (i < buf.length && buf[i] === 0xff) i++;
      if (i >= buf.length) break;
      const marker = buf[i];
      i++;

      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (i + 7 > buf.length) break;
        const h = (buf[i + 3] << 8) | buf[i + 4];
        const w = (buf[i + 5] << 8) | buf[i + 6];
        return { width: w, height: h, source: "jpeg-sof" };
      }

      // Standalone markers without payload
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        continue;
      }

      if (i + 2 > buf.length) break;
      const len = (buf[i] << 8) | buf[i + 1];
      if (len < 2) break;
      i += len;
    }
  }

  return { width: 0, height: 0, source: "unknown" };
}

async function loadViaCreateImageBitmap(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file, {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "default",
  });
}

function loadViaImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

function probeCanvasColorSpace(): string {
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d", {
      colorSpace: "srgb",
    } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
    const attrs = (ctx as { getContextAttributes?: () => { colorSpace?: string } } | null)
      ?.getContextAttributes?.();
    return attrs?.colorSpace || "srgb";
  } catch {
    return "unknown";
  }
}

/**
 * Load a File into GBImageData using createImageBitmap (with sRGB canvas)
 * and capture diagnostics describing decode behaviour.
 */
export async function loadImageWithDiagnostics(file: File): Promise<{
  image: GBImageData;
  diagnostics: LoadDiagnostics;
}> {
  const t0 = performance.now();

  const headerInfoPromise = readFileHeaderDimensions(file).catch(
    () => ({ width: 0, height: 0, source: "unknown" as const }),
  );

  const supportsBitmap = typeof createImageBitmap === "function";

  let loaderPath: "createImageBitmap" | "image-fallback";
  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let decodedW: number;
  let decodedH: number;

  if (supportsBitmap) {
    try {
      bitmap = await loadViaCreateImageBitmap(file);
      decodedW = bitmap.width;
      decodedH = bitmap.height;
      loaderPath = "createImageBitmap";
    } catch {
      imgEl = await loadViaImage(file);
      decodedW = imgEl.naturalWidth;
      decodedH = imgEl.naturalHeight;
      loaderPath = "image-fallback";
    }
  } else {
    imgEl = await loadViaImage(file);
    decodedW = imgEl.naturalWidth;
    decodedH = imgEl.naturalHeight;
    loaderPath = "image-fallback";
  }

  const canvas = document.createElement("canvas");
  canvas.width = decodedW;
  canvas.height = decodedH;
  const ctx = canvas.getContext("2d", {
    colorSpace: "srgb",
  } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D;
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
  } else if (imgEl) {
    ctx.drawImage(imgEl, 0, 0);
  }
  const imageData = ctx.getImageData(0, 0, decodedW, decodedH);

  const sampleAt = (x: number, y: number): [number, number, number, number] => {
    const cx = Math.max(0, Math.min(decodedW - 1, x));
    const cy = Math.max(0, Math.min(decodedH - 1, y));
    const i = (cy * decodedW + cx) * 4;
    return [
      imageData.data[i],
      imageData.data[i + 1],
      imageData.data[i + 2],
      imageData.data[i + 3],
    ];
  };

  const headerInfo = await headerInfoPromise;
  const fileW = headerInfo.width || null;
  const fileH = headerInfo.height || null;
  const subsampled =
    fileW !== null &&
    fileH !== null &&
    (fileW !== decodedW || fileH !== decodedH);

  const diagnostics: LoadDiagnostics = {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || "unknown",
    fileLastModified: file.lastModified,
    fileWidth: fileW,
    fileHeight: fileH,
    fileWidthSource: headerInfo.source,
    decodedWidth: decodedW,
    decodedHeight: decodedH,
    decodedSubsampled: subsampled,
    inputPixelHash: hashBytes(imageData.data),
    inputCornerSamples: {
      tl: sampleAt(0, 0),
      tr: sampleAt(decodedW - 1, 0),
      bl: sampleAt(0, decodedH - 1),
      br: sampleAt(decodedW - 1, decodedH - 1),
      center: sampleAt(decodedW >> 1, decodedH >> 1),
    },
    inputNormalizedSamples: {
      q25_25: sampleAt(Math.round(decodedW * 0.25), Math.round(decodedH * 0.25)),
      q75_25: sampleAt(Math.round(decodedW * 0.75), Math.round(decodedH * 0.25)),
      q25_75: sampleAt(Math.round(decodedW * 0.25), Math.round(decodedH * 0.75)),
      q75_75: sampleAt(Math.round(decodedW * 0.75), Math.round(decodedH * 0.75)),
    },
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    canvasColorSpace: probeCanvasColorSpace(),
    imageBitmapSupported: supportsBitmap,
    loaderPath,
    loadMs: Math.round(performance.now() - t0),
  };

  return {
    image: { data: imageData.data, width: decodedW, height: decodedH },
    diagnostics,
  };
}

/** Compute a fingerprint of the pipeline output for cross-device comparison. */
export function computeOutputDiagnostics(
  grayscale: GBImageData,
  intermediates?: {
    warp: GBImageData;
    correct: GBImageData;
    crop: GBImageData;
    sample: GBImageData;
  },
): OutputDiagnostics {
  const histo = { BK: 0, DG: 0, LG: 0, WH: 0 };
  for (let i = 0; i < grayscale.data.length; i += 4) {
    const v = grayscale.data[i];
    if (v === 0) histo.BK++;
    else if (v === 82) histo.DG++;
    else if (v === 165) histo.LG++;
    else if (v === 255) histo.WH++;
  }

  const result: OutputDiagnostics = {
    grayscaleHash: hashBytes(grayscale.data),
    paletteHistogram: histo,
  };

  if (intermediates) {
    result.intermediateHashes = {
      warp: hashBytes(intermediates.warp.data),
      correct: hashBytes(intermediates.correct.data),
      crop: hashBytes(intermediates.crop.data),
      sample: hashBytes(intermediates.sample.data),
    };
  }

  return result;
}

const fmtRGBA = (s: [number, number, number, number]): string =>
  `${s[0]},${s[1]},${s[2]},${s[3]}`;

/** Format one image's diagnostics as plain text for copy/share. */
export function formatDiagnosticsText(
  filename: string,
  load: LoadDiagnostics,
  output: OutputDiagnostics,
  processingTimeMs: number,
): string {
  const c = load.inputCornerSamples;
  const q = load.inputNormalizedSamples;
  const h = output.paletteHistogram;
  const lines = [
    `# ${filename}`,
    `processingTime: ${processingTimeMs.toFixed(0)}ms`,
    `loadTime: ${load.loadMs}ms`,
    ``,
    `## File`,
    `name: ${load.fileName}`,
    `size: ${load.fileSize} bytes`,
    `type: ${load.fileType}`,
    `lastModified: ${new Date(load.fileLastModified).toISOString()}`,
    `headerDims: ${load.fileWidth ?? "?"}x${load.fileHeight ?? "?"} (source: ${load.fileWidthSource})`,
    ``,
    `## Decoded input`,
    `dims: ${load.decodedWidth}x${load.decodedHeight}`,
    `subsampled: ${load.decodedSubsampled}${load.decodedSubsampled ? " ⚠ DECODED < FILE" : ""}`,
    `loaderPath: ${load.loaderPath}`,
    `inputPixelHash: ${load.inputPixelHash}`,
    `corners (RGBA): TL=${fmtRGBA(c.tl)} TR=${fmtRGBA(c.tr)} BL=${fmtRGBA(c.bl)} BR=${fmtRGBA(c.br)} CENTER=${fmtRGBA(c.center)}`,
    `quadrants (RGBA): 25,25=${fmtRGBA(q.q25_25)} 75,25=${fmtRGBA(q.q75_25)} 25,75=${fmtRGBA(q.q25_75)} 75,75=${fmtRGBA(q.q75_75)}`,
    ``,
    `## Pipeline output`,
    `grayscaleHash: ${output.grayscaleHash}`,
    `histogram: BK=${h.BK} DG=${h.DG} LG=${h.LG} WH=${h.WH}`,
  ];
  if (output.intermediateHashes) {
    const ih = output.intermediateHashes;
    lines.push(
      `intermediates: warp=${ih.warp} correct=${ih.correct} crop=${ih.crop} sample=${ih.sample}`,
    );
  }
  return lines.join("\n");
}

/** Format a full run (multiple images + shared environment) as plain text. */
export function formatRunDiagnosticsText(
  results: Array<{
    filename: string;
    load: LoadDiagnostics;
    output: OutputDiagnostics;
    processingTimeMs: number;
  }>,
): string {
  const env = results[0]?.load;
  const header: string[] = [
    `# Game Boy Camera Extractor — Debug Run`,
    `timestamp: ${new Date().toISOString()}`,
    `imageCount: ${results.length}`,
  ];
  if (env) {
    header.push(
      `userAgent: ${env.userAgent}`,
      `devicePixelRatio: ${env.devicePixelRatio}`,
      `canvasColorSpace: ${env.canvasColorSpace}`,
      `imageBitmapSupported: ${env.imageBitmapSupported}`,
    );
  }
  header.push(
    `============================================================`,
    ``,
  );
  return (
    header.join("\n") +
    results
      .map((r) =>
        formatDiagnosticsText(
          r.filename,
          r.load,
          r.output,
          r.processingTimeMs,
        ),
      )
      .join("\n\n")
  );
}
