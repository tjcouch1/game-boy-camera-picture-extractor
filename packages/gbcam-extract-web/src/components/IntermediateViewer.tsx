import { useRef, useEffect, useState } from "react";
import type { GBImageData } from "gbcam-extract";

interface IntermediateViewerProps {
  intermediates: {
    warp: GBImageData;
    correct: GBImageData;
    crop: GBImageData;
    sample: GBImageData;
  };
}

function StepCanvas({
  label,
  image,
}: {
  label: string;
  image: GBImageData;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Scale down large images to fit, cap at 256px wide
    const maxW = 256;
    const scale = image.width > maxW ? maxW / image.width : 1;
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);

    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const cloned = new Uint8ClampedArray(image.data);
    const imgData = new ImageData(cloned, image.width, image.height);
    const tmp = document.createElement("canvas");
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext("2d")!.putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }, [image]);

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <canvas
        ref={canvasRef}
        className="border border-gray-700 rounded"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="text-[10px] text-gray-600">
        {image.width} x {image.height}
      </p>
    </div>
  );
}

export function IntermediateViewer({ intermediates }: IntermediateViewerProps) {
  const [expanded, setExpanded] = useState(false);

  const steps: { label: string; image: GBImageData }[] = [
    { label: "Warp", image: intermediates.warp },
    { label: "Correct", image: intermediates.correct },
    { label: "Crop", image: intermediates.crop },
    { label: "Sample", image: intermediates.sample },
  ];

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-medium text-gray-400 hover:text-gray-300 flex items-center gap-1"
      >
        <span>{expanded ? "v" : ">"}</span>
        Debug: Intermediate Steps
      </button>
      {expanded && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {steps.map((step) => (
            <StepCanvas
              key={step.label}
              label={step.label}
              image={step.image}
            />
          ))}
        </div>
      )}
    </div>
  );
}
