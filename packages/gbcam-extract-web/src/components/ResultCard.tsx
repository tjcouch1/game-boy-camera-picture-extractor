import { useRef, useEffect, useState, useCallback } from "react";
import type { PipelineResult } from "gbcam-extract";
import { applyPalette } from "gbcam-extract";
import {
  canShare,
  shareImage,
  copyImageToClipboard,
} from "../utils/shareImage.js";
import { sanitizePaletteName } from "../utils/filenames.js";

interface ResultCardProps {
  result: PipelineResult;
  filename: string;
  processingTime: number;
  palette: [string, string, string, string];
  paletteName: string;
  outputScale?: number;
  previewScale?: number;
  onDelete?: () => void;
}

/** Build an off-screen canvas at the given scale for download/share/copy. */
function buildOutputCanvas(
  result: PipelineResult,
  palette: [string, string, string, string],
  scale: number,
): HTMLCanvasElement | null {
  try {
    if (!result.grayscale?.data) return null;
    const colored = applyPalette(result.grayscale, palette);
    if (!colored?.data?.length) return null;

    const canvas = document.createElement("canvas");
    canvas.width = colored.width * scale;
    canvas.height = colored.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    const tmp = document.createElement("canvas");
    tmp.width = colored.width;
    tmp.height = colored.height;
    tmp
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(colored.data), colored.width, colored.height),
        0,
        0,
      );
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null;
  }
}

export function ResultCard({
  result,
  filename,
  processingTime,
  palette,
  paletteName,
  outputScale = 1,
  previewScale = 2,
  onDelete,
}: ResultCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => {
    canShare().then(setShareSupported);
  }, []);

  // Render preview canvas at previewScale
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (!result.grayscale?.data) return;
      if (!(result.grayscale.data instanceof Uint8ClampedArray)) {
        console.warn("grayscale.data is not Uint8ClampedArray");
      }
      const colored = applyPalette(result.grayscale, palette);
      if (!colored?.data?.length) return;

      const scale = previewScale;
      canvas.width = colored.width * scale;
      canvas.height = colored.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;

      const tmp = document.createElement("canvas");
      tmp.width = colored.width;
      tmp.height = colored.height;
      tmp
        .getContext("2d")!
        .putImageData(
          new ImageData(new Uint8ClampedArray(colored.data), colored.width, colored.height),
          0,
          0,
        );
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.error("Error rendering image:", err);
    }
  }, [result, palette, previewScale]);

  const handleDownload = useCallback(() => {
    const outputCanvas = buildOutputCanvas(result, palette, outputScale);
    if (!outputCanvas) return;
    const basename = filename.replace(/\.[^.]+$/, "");
    const sanitized = sanitizePaletteName(paletteName);
    const link = document.createElement("a");
    link.download = sanitized ? `${basename}_${sanitized}_gb.png` : `${basename}_gb.png`;
    link.href = outputCanvas.toDataURL("image/png");
    link.click();
  }, [result, palette, outputScale, filename, paletteName]);

  const handleShare = useCallback(async () => {
    const outputCanvas = buildOutputCanvas(result, palette, outputScale);
    if (!outputCanvas) return;
    try {
      await shareImage(outputCanvas, filename.replace(/\.[^.]+$/, "") + "_gb.png");
    } catch (err) {
      console.error("Failed to share image:", err);
    }
  }, [result, palette, outputScale, filename]);

  const handleCopy = useCallback(async () => {
    const outputCanvas = buildOutputCanvas(result, palette, outputScale);
    if (!outputCanvas) return;
    try {
      await copyImageToClipboard(outputCanvas);
      setShowCopyFeedback(true);
      setTimeout(() => setShowCopyFeedback(false), 2000);
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  }, [result, palette, outputScale]);


  return (
    <div className="bg-gray-800 rounded-lg p-3 sm:p-4">
      {/* Header row: filename + delete */}
      <div className="flex items-start gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate" title={filename}>
            {filename}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{processingTime.toFixed(0)}ms</p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="shrink-0 w-7 h-7 flex items-center justify-center bg-red-600 hover:bg-red-700 rounded text-white transition-colors text-xs"
            title="Delete result"
          >
            ✕
          </button>
        )}
      </div>

      {/* Canvas + action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <canvas
          ref={canvasRef}
          className="border border-gray-700 rounded self-start"
          style={{ imageRendering: "pixelated", maxWidth: "100%" }}
        />
        <div className="flex flex-wrap gap-2 items-start content-start">
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors"
          >
            Download PNG
          </button>
          {shareSupported && (
            <button
              onClick={handleShare}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
            >
              Share
            </button>
          )}
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium transition-colors"
          >
            {showCopyFeedback ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
