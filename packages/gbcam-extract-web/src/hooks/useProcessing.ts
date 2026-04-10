import { useState, useCallback } from "react";
import type { PipelineResult, GBImageData } from "gbcam-extract";
import { processPicture } from "gbcam-extract";

export interface ProcessingResult {
  result: PipelineResult;
  filename: string;
  processingTime: number;
}

export interface CurrentImageProgress {
  filename: string;
  currentStep: string;
  index: number; // current image position (0-based)
  total: number; // total images to process
}

export interface ProcessingProgress {
  totalImages: number;
  completedImages: number;
  currentImageProgress: CurrentImageProgress | null;
  overallProgress: number; // 0-100
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
  const [progress, setProgress] = useState<ProcessingProgress>({
    totalImages: 0,
    completedImages: 0,
    currentImageProgress: null,
    overallProgress: 0,
  });
  const [results, setResults] = useState<ProcessingResult[]>([]);

  const processFiles = useCallback(async (files: File[], debug = false) => {
    setProcessing(true);
    setProgress({
      totalImages: files.length,
      completedImages: 0,
      currentImageProgress: null,
      overallProgress: 0,
    });
    setResults([]);

    const newResults: ProcessingResult[] = [];

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      try {
        setProgress((prev) => ({
          ...prev,
          currentImageProgress: {
            filename: file.name,
            currentStep: "Loading",
            index: fileIndex,
            total: files.length,
          },
        }));

        const gbImage = await fileToGBImageData(file);

        const start = performance.now();
        const result = await processPicture(gbImage, {
          debug,
          onProgress: (step) => {
            setProgress((prev) => ({
              ...prev,
              currentImageProgress: prev.currentImageProgress
                ? {
                    ...prev.currentImageProgress,
                    currentStep: step,
                  }
                : null,
            }));
          },
        });
        const processingTime = performance.now() - start;

        newResults.push({ result, filename: file.name, processingTime });
        setResults([...newResults]);

        const completedCount = fileIndex + 1;
        const overallProgress = Math.round(
          (completedCount / files.length) * 100,
        );
        setProgress((prev) => ({
          totalImages: files.length,
          completedImages: completedCount,
          currentImageProgress:
            completedCount < files.length
              ? {
                  filename: "",
                  currentStep: "",
                  index: completedCount,
                  total: files.length,
                }
              : null,
          overallProgress,
        }));
      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err);
        const completedCount = fileIndex + 1;
        const overallProgress = Math.round(
          (completedCount / files.length) * 100,
        );
        setProgress((prev) => ({
          totalImages: files.length,
          completedImages: completedCount,
          currentImageProgress:
            completedCount < files.length
              ? {
                  filename: "",
                  currentStep: "",
                  index: completedCount,
                  total: files.length,
                }
              : null,
          overallProgress,
        }));
      }
    }

    setProcessing(false);
    setProgress({
      totalImages: files.length,
      completedImages: files.length,
      currentImageProgress: null,
      overallProgress: 100,
    });
  }, []);

  return { processFiles, processing, progress, results };
}
