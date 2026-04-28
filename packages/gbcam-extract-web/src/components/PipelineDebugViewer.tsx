import { useRef, useEffect, useState, useMemo } from "react";
import type { GBImageData, PipelineResult } from "gbcam-extract";

interface PipelineDebugViewerProps {
  intermediates?: PipelineResult["intermediates"];
  debug?: PipelineResult["debug"];
}

/** Render a GBImageData onto a canvas, scaled to fit `maxW` pixels wide. */
function StepCanvas({
  label,
  image,
  maxW = 256,
}: {
  label: string;
  image: GBImageData;
  maxW?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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
  }, [image, maxW]);

  return (
    <div
      className="flex flex-col items-center gap-1 shrink-0"
      style={{ maxWidth: maxW }}
    >
      <p className="text-xs text-gray-400 font-medium text-center break-all">
        {label}
      </p>
      <canvas
        ref={canvasRef}
        className="border border-gray-700 rounded"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="text-[10px] text-gray-600">
        {image.width} × {image.height}
      </p>
    </div>
  );
}

/** Group debug image keys by the step they belong to (prefix before first underscore). */
function groupDebugImages(
  images: Record<string, GBImageData>,
): Array<{ step: string; entries: Array<[string, GBImageData]> }> {
  const groups = new Map<string, Array<[string, GBImageData]>>();
  for (const [name, img] of Object.entries(images)) {
    const step = name.split("_")[0] ?? "other";
    if (!groups.has(step)) groups.set(step, []);
    groups.get(step)!.push([name, img]);
  }
  // Stable order matching the pipeline
  const stepOrder = ["warp", "correct", "crop", "sample", "quantize"];
  return stepOrder
    .filter((s) => groups.has(s))
    .map((step) => ({
      step,
      entries: groups.get(step)!.sort(([a], [b]) => a.localeCompare(b)),
    }));
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-gray-300 hover:text-gray-100 flex items-center gap-1"
      >
        <span>{open ? "v" : ">"}</span>
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function PipelineDebugViewer({
  intermediates,
  debug,
}: PipelineDebugViewerProps) {
  const [expanded, setExpanded] = useState(false);

  const intermediateSteps = useMemo(() => {
    if (!intermediates) return [];
    return [
      { label: "Warp", image: intermediates.warp },
      { label: "Correct", image: intermediates.correct },
      { label: "Crop", image: intermediates.crop },
      { label: "Sample", image: intermediates.sample },
    ];
  }, [intermediates]);

  const debugImageGroups = useMemo(
    () => (debug?.images ? groupDebugImages(debug.images) : []),
    [debug],
  );

  // Nothing to show
  if (!intermediates && !debug) return null;

  const hasMetrics = !!debug && Object.keys(debug.metrics).length > 0;
  const hasLog = !!debug && debug.log.length > 0;

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-medium text-gray-400 hover:text-gray-300 flex items-center gap-1"
      >
        <span>{expanded ? "v" : ">"}</span>
        Debug: Pipeline Diagnostics
      </button>

      {expanded && (
        <div className="mt-2">
          {intermediateSteps.length > 0 && (
            <CollapsibleSection title="Intermediate Steps" defaultOpen>
              <div className="flex flex-wrap gap-3 items-start">
                {intermediateSteps.map((step) => (
                  <StepCanvas
                    key={step.label}
                    label={step.label}
                    image={step.image}
                  />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {debugImageGroups.length > 0 && (
            <CollapsibleSection title="Debug Images">
              <div className="space-y-3">
                {debugImageGroups.map(({ step, entries }) => (
                  <div key={step}>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      {step}
                    </p>
                    <div className="flex flex-wrap gap-3 items-start">
                      {entries.map(([name, img]) => (
                        <StepCanvas key={name} label={name} image={img} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {hasMetrics && (
            <CollapsibleSection title="Metrics">
              <pre className="text-[11px] text-gray-300 bg-gray-900/60 rounded p-2 overflow-x-auto whitespace-pre">
                {JSON.stringify(debug!.metrics, null, 2)}
              </pre>
            </CollapsibleSection>
          )}

          {hasLog && (
            <CollapsibleSection title={`Log (${debug!.log.length} lines)`}>
              <pre className="text-[11px] text-gray-300 bg-gray-900/60 rounded p-2 overflow-x-auto whitespace-pre">
                {debug!.log.join("\n")}
              </pre>
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  );
}
