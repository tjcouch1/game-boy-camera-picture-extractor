import { useRef, useEffect, useState, useCallback } from "react";
import type { PipelineResult } from "gbcam-extract";
import { applyPalette } from "gbcam-extract";
import {
  canShare,
  shareImage,
  copyImageToClipboard,
} from "../utils/shareImage.js";
import { sanitizePaletteName } from "../utils/filenames.js";
import { Button } from "@/shadcn/components/button";
import { Badge } from "@/shadcn/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@/shadcn/components/card";
import { toast } from "sonner";
import { X, Download, Share2, Copy as CopyIcon } from "lucide-react";

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
        new ImageData(
          new Uint8ClampedArray(colored.data),
          colored.width,
          colored.height,
        ),
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
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => {
    setShareSupported(canShare());
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
          new ImageData(
            new Uint8ClampedArray(colored.data),
            colored.width,
            colored.height,
          ),
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
    link.download = sanitized
      ? `${basename}_${sanitized}_gb.png`
      : `${basename}_gb.png`;
    link.href = outputCanvas.toDataURL("image/png");
    link.click();
  }, [result, palette, outputScale, filename, paletteName]);

  const handleShare = useCallback(async () => {
    const outputCanvas = buildOutputCanvas(result, palette, outputScale);
    if (!outputCanvas) return;
    try {
      await shareImage(
        outputCanvas,
        filename.replace(/\.[^.]+$/, "") + "_gb.png",
      );
    } catch (err) {
      console.error("Failed to share image:", err);
    }
  }, [result, palette, outputScale, filename]);

  const handleCopy = useCallback(async () => {
    const outputCanvas = buildOutputCanvas(result, palette, outputScale);
    if (!outputCanvas) return;
    try {
      await copyImageToClipboard(outputCanvas);
      toast.success("Image copied to clipboard");
    } catch (err) {
      const errorMsg = (err as Error).message || "Failed to copy";
      toast.error(`Copy failed: ${errorMsg}`);
      console.error("Failed to copy image:", err);
    }
  }, [result, palette, outputScale]);

  return (
    <Card className="p-3 sm:p-4">
      <CardHeader className="p-0 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" title={filename}>
            {filename}
          </p>
          <Badge variant="secondary" className="mt-0.5">
            {processingTime.toFixed(0)}ms
          </Badge>
        </div>
        {onDelete && (
          <CardAction>
            <Button
              variant="destructive"
              size="icon"
              onClick={onDelete}
              aria-label="Delete result"
              className="size-7"
            >
              <X />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col sm:flex-row gap-3 p-0">
        <canvas
          ref={canvasRef}
          className="rounded border self-start"
          style={{ imageRendering: "pixelated", maxWidth: "100%" }}
        />
        <div className="flex flex-wrap gap-2 items-start content-start">
          <Button onClick={handleDownload}>
            <Download data-icon="inline-start" />
            Download PNG
          </Button>
          {shareSupported && (
            <Button variant="secondary" onClick={handleShare}>
              <Share2 data-icon="inline-start" />
              Share
            </Button>
          )}
          <Button variant="secondary" onClick={handleCopy} aria-label="Copy image">
            <CopyIcon data-icon="inline-start" />
            Copy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
