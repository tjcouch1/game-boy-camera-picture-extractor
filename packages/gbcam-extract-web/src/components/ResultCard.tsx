import { useRef, useEffect, useState } from "react";
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
  onDelete?: () => void;
}

export function ResultCard({
  result,
  filename,
  processingTime,
  palette,
  paletteName,
  onDelete,
}: ResultCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => {
    canShare().then(setShareSupported);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const colored = applyPalette(result.grayscale, palette);
      // Validate that we have actual image data
      if (!colored || !colored.data || colored.data.length === 0) {
        console.error("Invalid image data received from applyPalette");
        return;
      }
      const scale = 2;
      canvas.width = colored.width * scale;
      canvas.height = colored.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const cloned = new Uint8ClampedArray(colored.data);
      const imgData = new ImageData(cloned, colored.width, colored.height);
      const tmp = document.createElement("canvas");
      tmp.width = colored.width;
      tmp.height = colored.height;
      tmp.getContext("2d")!.putImageData(imgData, 0, 0);
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.error("Error rendering image:", err);
    }
  }, [result, palette]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    const basename = filename.replace(/\.[^.]+$/, "");
    const sanitized = sanitizePaletteName(paletteName);
    const finalFilename = sanitized
      ? `${basename}_${sanitized}_gb.png`
      : `${basename}_gb.png`;
    link.download = finalFilename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      await shareImage(canvas, filename.replace(/\.[^.]+$/, "") + "_gb.png");
    } catch (err) {
      console.error("Failed to share image:", err);
    }
  };

  const handleCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      await copyImageToClipboard(canvas);
      setShowCopyFeedback(true);
      setTimeout(() => setShowCopyFeedback(false), 2000);
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 relative">
      <div className="flex items-start gap-4">
        <canvas
          ref={canvasRef}
          className="border border-gray-700 rounded"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate">
            {filename}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {processingTime.toFixed(0)}ms
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
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
        {onDelete && (
          <button
            onClick={onDelete}
            className="absolute top-2 right-2 p-1.5 bg-red-600 hover:bg-red-700 rounded text-white transition-colors"
            title="Delete result"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
