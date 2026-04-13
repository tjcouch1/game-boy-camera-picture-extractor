import { useState, useCallback, useEffect } from "react";
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

const APP_SETTINGS_KEY = "gbcam-app-settings";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

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
  const [debug, setDebugInternal] = useState(false);
  const [clipboardEnabled, setClipboardEnabledInternal] = useState(false);
  const [outputScale, setOutputScaleInternal] = useState(1);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  const setDebug = useCallback((value: boolean) => {
    setDebugInternal(value);
    // Save to localStorage immediately
    const stored = localStorage.getItem(APP_SETTINGS_KEY);
    const currentSettings = stored ? JSON.parse(stored) : {};
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ ...currentSettings, debug: value }),
    );
  }, []);

  const setClipboardEnabled = useCallback((value: boolean) => {
    setClipboardEnabledInternal(value);
    // Save to localStorage immediately
    const stored = localStorage.getItem(APP_SETTINGS_KEY);
    const currentSettings = stored ? JSON.parse(stored) : {};
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ ...currentSettings, clipboardEnabled: value }),
    );
  }, []);

  const setOutputScale = useCallback((value: number) => {
    setOutputScaleInternal(value);
    // Save to localStorage immediately
    const stored = localStorage.getItem(APP_SETTINGS_KEY);
    const currentSettings = stored ? JSON.parse(stored) : {};
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ ...currentSettings, outputScale: value }),
    );
  }, []);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(APP_SETTINGS_KEY);
      if (stored) {
        const {
          debug: storedDebug,
          clipboardEnabled: storedClipboard,
          outputScale: storedOutputScale,
          paletteSelection: storedPaletteSelection,
        } = JSON.parse(stored);
        if (typeof storedDebug === "boolean") setDebugInternal(storedDebug);
        if (typeof storedClipboard === "boolean")
          setClipboardEnabledInternal(storedClipboard);
        if (typeof storedOutputScale === "number")
          setOutputScaleInternal(storedOutputScale);
        if (storedPaletteSelection) {
          setPaletteEntry(storedPaletteSelection);
        }
      }
    } catch (e) {
      console.error("Error loading app settings from storage:", e);
    }
  }, []);

  // Handle PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setInstallPrompt(promptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      console.log("App installed successfully");
      setInstallPrompt(null);
      setIsInstallable(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handlePaletteSelected = (entry: PaletteEntry) => {
    setPaletteEntry(entry);
    // Save selection to localStorage
    const stored = localStorage.getItem(APP_SETTINGS_KEY);
    const currentSettings = stored ? JSON.parse(stored) : {};
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ ...currentSettings, paletteSelection: entry }),
    );
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") {
        console.log("User accepted install prompt");
      }
      setInstallPrompt(null);
      setIsInstallable(false);
    } catch (err) {
      console.error("Install prompt failed:", err);
    }
  };

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
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">GB Camera Picture Extractor</h1>
          {isInstallable && (
            <button
              onClick={handleInstallApp}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
              title="Install this app on your device"
            >
              Install App
            </button>
          )}
        </div>

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
            <div className="mb-6 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={debug}
                  onChange={(e) => setDebug(e.target.checked)}
                  className="rounded"
                />
                Debug mode
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clipboardEnabled}
                  onChange={(e) => setClipboardEnabled(e.target.checked)}
                  className="rounded"
                />
                Enable Copy/Paste Palettes
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <span>Output Scale:</span>
                <select
                  value={outputScale}
                  onChange={(e) => setOutputScale(parseInt(e.target.value, 10))}
                  className="px-2 py-1 bg-gray-700 rounded text-xs text-white border border-gray-600 focus:border-blue-500 outline-none"
                >
                  <option value={1}>1x (128x112)</option>
                  <option value={2}>2x (256x224)</option>
                  <option value={3}>3x (384x336)</option>
                  <option value={4}>4x (512x448)</option>
                </select>
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
                onSelectWithName={handlePaletteSelected}
                clipboardEnabled={clipboardEnabled}
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
                            outputScale,
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
                        outputScale={outputScale}
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
                              outputScale={outputScale}
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
  outputScale: number = 1,
) {
  // Dynamically import to avoid circular issues
  import("gbcam-extract").then(({ applyPalette }) => {
    try {
      // Validate input before processing
      if (!result.grayscale || !result.grayscale.data) {
        console.error("Cannot download: invalid image data");
        return;
      }

      const colored = applyPalette(result.grayscale, palette);

      if (!colored || !colored.data || colored.data.length === 0) {
        console.error("Failed to apply palette for download");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = colored.width * outputScale;
      canvas.height = colored.height * outputScale;
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
    } catch (err) {
      console.error("Error downloading image:", err);
    }
  });
}
