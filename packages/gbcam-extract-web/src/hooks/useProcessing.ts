import { useState, useCallback } from "react";
import type { PipelineResult, GBImageData } from "gbcam-extract";
import { processPicture } from "gbcam-extract";

export interface ProcessingResult {
  result: PipelineResult;
  filename: string;
  processingTime: number;
}

function fileToGBImageData(file: File): Promise<GBImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({
        data: imageData.data,
        width: img.width,
        height: img.height,
      });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = URL.createObjectURL(file);
  });
}

export function useProcessing() {
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [results, setResults] = useState<ProcessingResult[]>([]);

  const processFiles = useCallback(async (files: File[], debug = false) => {
    setProcessing(true);
    setResults([]);

    const newResults: ProcessingResult[] = [];

    for (const file of files) {
      try {
        setCurrentStep(`Loading ${file.name}`);
        const gbImage = await fileToGBImageData(file);

        const start = performance.now();
        const result = await processPicture(gbImage, {
          debug,
          onProgress: (step) => setCurrentStep(`${file.name}: ${step}`),
        });
        const processingTime = performance.now() - start;

        newResults.push({ result, filename: file.name, processingTime });
        setResults([...newResults]);
      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err);
      }
    }

    setProcessing(false);
    setCurrentStep("");
  }, []);

  return { processFiles, processing, results, currentStep };
}
