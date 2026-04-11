import { useState, useCallback } from "react";
import type { PipelineResult } from "gbcam-extract";
import { useOpenCV } from "./hooks/useOpenCV.js";
import { useImageHistory } from "./hooks/useImageHistory.js";
import { LoadingBar } from "./components/LoadingBar.js";
import { ImageInput } from "./components/ImageInput.js";
import { useProcessing } from "./hooks/useProcessing.js";
import type { ProcessingProgress } from "./hooks/useProcessing.js";
import { ResultCard } from "./components/ResultCard.js";
import { PalettePicker } from "./components/PalettePicker.js";
import { IntermediateViewer } from "./components/IntermediateViewer.js";
import { sanitizePaletteName } from "./utils/filenames.js";
import type { PaletteEntry } from "./data/palettes.js";

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
  const {
    processFiles,
    processing,
    progress,
    results,
    setResults: setCurrentResults,
  } = useProcessing();
  const {
    history,
    isHistoryExpanded,
    setIsHistoryExpanded,
    archiveResults,
    deleteFromHistory,
    deleteBatch,
    deleteAllHistory,
    updateSettings: updateHistorySettings,
    settings: historySettings,
  } = useImageHistory();
  const [paletteEntry, setPaletteEntry] = useState<PaletteEntry>({
    name: "B + Left",
    colors: ["#FFFFFF", "#A5A5A5", "#525252", "#000000"],
  });
  const [debug, setDebug] = useState(false);

  const handleImagesSelected = (files: File[]) => {
    // Archive current results to history before processing new ones
    if (results.length > 0) {
      archiveResults(results);
      setCurrentResults([]);
    }
    processFiles(files, debug);
  };

  const handleDeleteResult = useCallback(
    (filename: string) => {
      setCurrentResults((prev) => prev.filter((r) => r.filename !== filename));
    },
    [setCurrentResults],
  );

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

            <div className="mt-6 mb-4">
              <PalettePicker
                selected={paletteEntry}
                onSelectWithName={setPaletteEntry}
              />
            </div>

            {results.length > 0 && (
              <>
                {results.length > 1 && (
                  <div className="mb-4">
                    <button
                      onClick={() => {
                        results.forEach((r) => {
                          downloadResult(
                            r.filename,
                            r.result,
                            paletteEntry.colors,
                            paletteEntry.name,
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
                  {results.map((r) => (
                    <div key={r.filename}>
                      <ResultCard
                        result={r.result}
                        filename={r.filename}
                        processingTime={r.processingTime}
                        palette={paletteEntry.colors}
                        paletteName={paletteEntry.name}
                        onDelete={() => handleDeleteResult(r.filename)}
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

            {/* Image History Section */}
            {history.length > 0 && (
              <div className="mt-8">
                <button
                  onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                  className="text-sm font-medium text-gray-300 hover:text-white mb-3 flex items-center gap-1"
                >
                  <span className="text-xs">
                    {isHistoryExpanded ? "v" : ">"}
                  </span>
                  📚 Image History (
                  {history.reduce(
                    (sum, batch) => sum + batch.results.length,
                    0,
                  )}{" "}
                  images)
                </button>

                {isHistoryExpanded && (
                  <div className="space-y-4">
                    <div className="flex gap-2 mb-3">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={historySettings.maxSize}
                        onChange={(e) =>
                          updateHistorySettings({
                            maxSize: Math.max(
                              1,
                              parseInt(e.target.value, 10) || 1,
                            ),
                          })
                        }
                        className="px-2 py-1 bg-gray-700 rounded text-xs text-white border border-gray-600 focus:border-blue-500 outline-none w-16"
                      />
                      <label className="text-xs text-gray-400 flex items-center">
                        max images to keep in history
                      </label>
                      <button
                        onClick={deleteAllHistory}
                        className="ml-auto px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium transition-colors"
                      >
                        Delete All History
                      </button>
                    </div>

                    {history.map((batch) => (
                      <div
                        key={batch.id}
                        className="bg-gray-800/50 rounded-lg p-4"
                      >
                        <div className="text-xs text-gray-500 mb-3">
                          {new Date(batch.timestamp).toLocaleString()} (
                          {batch.results.length} images)
                        </div>
                        <div className="grid gap-3">
                          {batch.results.map((result, idx) => (
                            <ResultCard
                              key={`${batch.id}-${idx}`}
                              result={result.result}
                              filename={result.filename}
                              processingTime={result.processingTime}
                              palette={paletteEntry.colors}
                              paletteName={paletteEntry.name}
                              onDelete={() => deleteFromHistory(batch.id, idx)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
