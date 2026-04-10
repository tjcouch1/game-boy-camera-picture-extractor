import { useState } from "react";
import type { PipelineResult } from "gbcam-extract";
import { useOpenCV } from "./hooks/useOpenCV.js";
import { LoadingBar } from "./components/LoadingBar.js";
import { ImageInput } from "./components/ImageInput.js";
import { useProcessing } from "./hooks/useProcessing.js";
import type { ProcessingProgress } from "./hooks/useProcessing.js";
import { ResultCard } from "./components/ResultCard.js";
import { PalettePicker } from "./components/PalettePicker.js";
import { IntermediateViewer } from "./components/IntermediateViewer.js";
import { useDraftPalette } from "./hooks/useDraftPalette.js";
import { sanitizePaletteName } from "./utils/filenames.js";

function ProgressDisplay({ progress }: { progress: ProcessingProgress }) {
  if (!progress.currentImageProgress) return null;

  return (
    <div className="mt-4 space-y-2">
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>
            Image {progress.currentImageProgress.index + 1} of{" "}
            {progress.totalImages}: {progress.currentImageProgress.filename}
          </span>
          <span>{progress.overallProgress}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-500 h-full transition-all"
            style={{ width: `${progress.overallProgress}%` }}
          />
        </div>
      </div>
      <div className="text-xs text-gray-400">
        Step: {progress.currentImageProgress.currentStep || "Starting..."}
      </div>
    </div>
  );
}

export default function App() {
  const { status, progress: cvProgress, error } = useOpenCV();
  const { processFiles, processing, progress, results } = useProcessing();
  const { draft, hasDraft } = useDraftPalette();
  const [palette, setPalette] = useState<[string, string, string, string]>([
    "#FFFFFF",
    "#A5A5A5",
    "#525252",
    "#000000",
  ]);
  const [paletteName, setPaletteName] = useState("Custom");
  const [debug, setDebug] = useState(false);

  // Use draft palette if it exists, otherwise use selected palette
  const effectivePalette = hasDraft && draft ? draft : palette;

  const handlePaletteSelect = (
    colors: [string, string, string, string],
    name: string,
  ) => {
    setPalette(colors);
    setPaletteName(name);
  };

  const handleImagesSelected = (files: File[]) => {
    processFiles(files, debug);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">GB Camera Picture Extractor</h1>

        {status === "loading" && (
          <div className="mb-6">
            <LoadingBar progress={cvProgress} label="Loading OpenCV.js..." />
          </div>
        )}

        {status === "error" && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded">
            <p className="text-red-300">Failed to load OpenCV: {error}</p>
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="mb-6 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={debug}
                  onChange={(e) => setDebug(e.target.checked)}
                  className="rounded"
                />
                Debug mode
              </label>
            </div>

            <ImageInput
              onImagesSelected={handleImagesSelected}
              disabled={processing}
            />

            {processing && <ProgressDisplay progress={progress} />}

            {results.length > 0 && (
              <>
                <div className="mt-6 mb-4">
                  <PalettePicker
                    selected={effectivePalette}
                    onSelect={setPalette}
                    onSelectWithName={handlePaletteSelect}
                  />
                </div>

                {results.length > 1 && (
                  <div className="mb-4">
                    <button
                      onClick={() => {
                        results.forEach((r) => {
                          downloadResult(
                            r.filename,
                            r.result,
                            effectivePalette,
                            paletteName,
                          );
                        });
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
                    >
                      Download All ({results.length})
                    </button>
                  </div>
                )}

                <div className="grid gap-4">
                  {results.map((r, i) => (
                    <div key={i}>
                      <ResultCard
                        result={r.result}
                        filename={r.filename}
                        processingTime={r.processingTime}
                        palette={effectivePalette}
                        paletteName={paletteName}
                      />
                      {r.result.intermediates && (
                        <IntermediateViewer
                          intermediates={r.result.intermediates}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function downloadResult(
  filename: string,
  result: PipelineResult,
  palette: [string, string, string, string],
  paletteName: string,
) {
  // Dynamically import to avoid circular issues
  import("gbcam-extract").then(({ applyPalette }) => {
    const colored = applyPalette(result.grayscale, palette);
    const canvas = document.createElement("canvas");
    canvas.width = colored.width * 2;
    canvas.height = colored.height * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const cloned = new Uint8ClampedArray(colored.data);
    const imgData = new ImageData(cloned, colored.width, colored.height);
    const tmp = document.createElement("canvas");
    tmp.width = colored.width;
    tmp.height = colored.height;
    tmp.getContext("2d")!.putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    const link = document.createElement("a");
    const baseName = filename.replace(/\.[^.]+$/, "");
    const sanitizedPaletteName = sanitizePaletteName(paletteName);
    link.download = `${baseName}_${sanitizedPaletteName}_gb.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}
