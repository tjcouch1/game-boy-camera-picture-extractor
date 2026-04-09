import { useState } from "react";
import type { PipelineResult } from "gbcam-extract";
import { useOpenCV } from "./hooks/useOpenCV.js";
import { LoadingBar } from "./components/LoadingBar.js";
import { ImageInput } from "./components/ImageInput.js";
import { useProcessing } from "./hooks/useProcessing.js";
import { ResultCard } from "./components/ResultCard.js";
import { PalettePicker } from "./components/PalettePicker.js";
import { IntermediateViewer } from "./components/IntermediateViewer.js";

export default function App() {
  const { status, progress, error } = useOpenCV();
  const { processFiles, processing, results, currentStep } = useProcessing();
  const [palette, setPalette] = useState<[string, string, string, string]>([
    "#FFFFFF",
    "#A5A5A5",
    "#525252",
    "#000000",
  ]);
  const [debug, setDebug] = useState(false);

  const handleImagesSelected = (files: File[]) => {
    processFiles(files, debug);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">GB Camera Picture Extractor</h1>

        {status === "loading" && (
          <div className="mb-6">
            <LoadingBar progress={progress} label="Loading OpenCV.js..." />
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

            {processing && (
              <div className="mt-4">
                <LoadingBar progress={-1} label={`Processing: ${currentStep}...`} />
              </div>
            )}

            {results.length > 0 && (
              <>
                <div className="mt-6 mb-4">
                  <PalettePicker selected={palette} onSelect={setPalette} />
                </div>

                {results.length > 1 && (
                  <div className="mb-4">
                    <button
                      onClick={() => {
                        results.forEach((r) => {
                          downloadResult(r.filename, r.result, palette);
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
                        palette={palette}
                      />
                      {r.result.intermediates && (
                        <IntermediateViewer intermediates={r.result.intermediates} />
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
    link.download = filename.replace(/\.[^.]+$/, "") + "_gb.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
}
