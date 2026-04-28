import { useEffect, useMemo, useRef } from "react";
import type { GBImageData, PipelineResult } from "gbcam-extract";
import { ChevronDown } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shadcn/components/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shadcn/components/collapsible";
import { Badge } from "@/shadcn/components/badge";
import { Button } from "@/shadcn/components/button";
import { Card } from "@/shadcn/components/card";

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
    <Card
      className="flex flex-col items-center gap-1 p-2 shrink-0"
      style={{ maxWidth: maxW }}
    >
      <p className="text-xs font-medium text-muted-foreground text-center break-all">
        {label}
      </p>
      <canvas
        ref={canvasRef}
        className="rounded border"
        style={{ imageRendering: "pixelated" }}
      />
      <Badge variant="secondary" className="text-[10px]">
        {image.width} × {image.height}
      </Badge>
    </Card>
  );
}

function groupDebugImages(
  images: Record<string, GBImageData>,
): Array<{ step: string; entries: Array<[string, GBImageData]> }> {
  const groups = new Map<string, Array<[string, GBImageData]>>();
  for (const [name, img] of Object.entries(images)) {
    const step = name.split("_")[0] ?? "other";
    if (!groups.has(step)) groups.set(step, []);
    groups.get(step)!.push([name, img]);
  }
  const stepOrder = ["warp", "correct", "crop", "sample", "quantize"];
  return stepOrder
    .filter((s) => groups.has(s))
    .map((step) => ({
      step,
      entries: groups.get(step)!.sort(([a], [b]) => a.localeCompare(b)),
    }));
}

export function PipelineDebugViewer({
  intermediates,
  debug,
}: PipelineDebugViewerProps) {
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

  if (!intermediates && !debug) return null;

  const hasMetrics = !!debug && Object.keys(debug.metrics).length > 0;
  const hasLog = !!debug && debug.log.length > 0;

  const defaultOpen: string[] = [];
  if (intermediateSteps.length > 0) defaultOpen.push("intermediate");

  return (
    <Collapsible className="mt-2 rounded-lg bg-muted/40 p-3">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
      >
        Debug: Pipeline Diagnostics
        <ChevronDown
          className="transition-transform data-[state=open]:rotate-180"
          data-icon="inline-end"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Accordion multiple defaultValue={defaultOpen} className="mt-2">
          {intermediateSteps.length > 0 && (
            <AccordionItem value="intermediate">
              <AccordionTrigger>Intermediate Steps</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-wrap items-start gap-3">
                  {intermediateSteps.map((step) => (
                    <StepCanvas
                      key={step.label}
                      label={step.label}
                      image={step.image}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {debugImageGroups.length > 0 && (
            <AccordionItem value="debug-images">
              <AccordionTrigger>Debug Images</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  {debugImageGroups.map(({ step, entries }) => (
                    <div key={step}>
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {step}
                      </p>
                      <div className="flex flex-wrap items-start gap-3">
                        {entries.map(([name, img]) => (
                          <StepCanvas key={name} label={name} image={img} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {hasMetrics && (
            <AccordionItem value="metrics">
              <AccordionTrigger>Metrics</AccordionTrigger>
              <AccordionContent>
                <pre className="overflow-x-auto whitespace-pre rounded bg-background/60 p-2 text-[11px]">
                  {JSON.stringify(debug!.metrics, null, 2)}
                </pre>
              </AccordionContent>
            </AccordionItem>
          )}

          {hasLog && (
            <AccordionItem value="log">
              <AccordionTrigger>Log ({debug!.log.length} lines)</AccordionTrigger>
              <AccordionContent>
                <pre className="overflow-x-auto whitespace-pre rounded bg-background/60 p-2 text-[11px]">
                  {debug!.log.join("\n")}
                </pre>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </CollapsibleContent>
    </Collapsible>
  );
}
