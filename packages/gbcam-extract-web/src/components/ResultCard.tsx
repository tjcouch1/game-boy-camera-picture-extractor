import { useRef, useEffect } from "react";
import type { PipelineResult } from "gbcam-extract";
import { applyPalette } from "gbcam-extract";

interface ResultCardProps {
  result: PipelineResult;
  filename: string;
  processingTime: number;
  palette: [string, string, string, string];
}

export function ResultCard({
  result,
  filename,
  processingTime,
  palette,
}: ResultCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const colored = applyPalette(result.grayscale, palette);
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
  }, [result, palette]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = filename.replace(/\.[^.]+$/, "") + "_gb.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
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
          <button
            onClick={handleDownload}
            className="mt-3 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors"
          >
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}
