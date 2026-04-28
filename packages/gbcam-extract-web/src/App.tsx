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
import { PipelineDebugViewer } from "./components/PipelineDebugViewer.js";
import { sanitizePaletteName } from "./utils/filenames.js";
import type { PaletteEntry } from "./data/palettes.js";
import { CollapsibleInstructions } from "./components/CollapsibleInstructions.js";
import { USER_INSTRUCTIONS_MARKDOWN } from "./generated/UserInstructions.js";
import { useAppSettings } from "./hooks/useAppSettings.js";
import { useTheme } from "next-themes";
import { useFaviconSwap } from "./hooks/useFaviconSwap.js";
import { ModeToggle } from "./components/ModeToggle.js";
import { ChevronDown, Library } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shadcn/components/collapsible";
import { Button } from "@/shadcn/components/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Detect iOS Safari (iPhone/iPad/iPod) — where beforeinstallprompt never fires. */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // "standalone" means already installed as PWA
  const isStandalone = (navigator as any).standalone === true;
  return isIOS && !isStandalone;
}

/** Detect Android Chrome / other browsers that fire beforeinstallprompt. */
function isAlreadyInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
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
  const { settings, updateSetting } = useAppSettings();
  const debug = settings.debug;
  const clipboardEnabled = settings.clipboardEnabled;
  const outputScale = settings.outputScale;
  const previewScale = settings.previewScale;
  const paletteEntry = settings.paletteSelection ?? {
    name: "Down",
    colors: ["#FFFFA5", "#FF9494", "#9494FF", "#000000"],
  };

  const setDebug = (value: boolean) => updateSetting("debug", value);
  const setClipboardEnabled = (value: boolean) =>
    updateSetting("clipboardEnabled", value);
  const setOutputScale = (value: number) => updateSetting("outputScale", value);
  const setPreviewScale = (value: number) =>
    updateSetting("previewScale", value);

  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [showIOSInstallTip, setShowIOSInstallTip] = useState(false);

  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useFaviconSwap();
  const iconSrc =
    mounted && resolvedTheme === "dark" ? "./icon-dark.svg" : "./icon.svg";

  // Handle PWA install prompt
  useEffect(() => {
    // iOS Safari never fires beforeinstallprompt — show a manual tip instead
    if (isIOSSafari() && !isAlreadyInstalled()) {
      setShowIOSInstallTip(true);
      return;
    }

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

  const handlePaletteSelected = (entry: PaletteEntry) =>
    updateSetting("paletteSelection", entry);

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
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="container mx-auto px-4 py-8 max-w-4xl flex-1">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <img src={iconSrc} alt="App Icon" className="size-8" />
            <h1 className="text-2xl font-bold">
              Game Boy Camera Picture Extractor
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
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
        </div>

        {/* iOS install tip — Safari doesn't fire beforeinstallprompt */}
        {showIOSInstallTip && (
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-900/60 border border-blue-700 rounded-lg text-sm text-blue-200">
            <span className="text-lg leading-none mt-0.5">📲</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium mb-0.5">Install as App</p>
              <p className="text-xs text-blue-300">
                Tap the <strong>Share</strong> button (
                <span className="font-mono">⎙</span>) in Safari, then choose{" "}
                <strong>"Add to Home Screen"</strong>.
              </p>
            </div>
            <button
              onClick={() => setShowIOSInstallTip(false)}
              className="shrink-0 text-blue-400 hover:text-blue-200 text-lg leading-none"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Collapsible Instructions */}
        <CollapsibleInstructions markdown={USER_INSTRUCTIONS_MARKDOWN} />

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
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {results.length > 1 && (
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
                  )}
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <span>Output Scale:</span>
                    <select
                      value={outputScale}
                      onChange={(e) =>
                        setOutputScale(parseInt(e.target.value, 10))
                      }
                      className="px-2 py-1 bg-gray-700 rounded text-xs text-white border border-gray-600 focus:border-blue-500 outline-none"
                    >
                      <option value={1}>1x (128x112)</option>
                      <option value={2}>2x (256x224)</option>
                      <option value={3}>3x (384x336)</option>
                      <option value={4}>4x (512x448)</option>
                      <option value={8}>8x (1024x896)</option>
                      <option value={16}>16x (2048x1792)</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <span>Preview Scale:</span>
                    <select
                      value={previewScale}
                      onChange={(e) =>
                        setPreviewScale(parseInt(e.target.value, 10))
                      }
                      className="px-2 py-1 bg-gray-700 rounded text-xs text-white border border-gray-600 focus:border-blue-500 outline-none"
                    >
                      <option value={1}>1x</option>
                      <option value={2}>2x</option>
                      <option value={3}>3x</option>
                      <option value={4}>4x</option>
                      <option value={8}>8x</option>
                      <option value={16}>16x</option>
                    </select>
                  </label>
                </div>

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
                        previewScale={previewScale}
                        onDelete={() => handleDeleteResult(r.filename)}
                      />
                      {(r.result.intermediates || r.result.debug) && (
                        <PipelineDebugViewer
                          intermediates={r.result.intermediates}
                          debug={r.result.debug}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Image History Section */}
            {history.length > 0 && (
              <Collapsible
                open={isHistoryExpanded}
                onOpenChange={setIsHistoryExpanded}
                className="mt-8"
              >
                <CollapsibleTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                    />
                  }
                >
                  <Library data-icon="inline-start" />
                  Image History (
                  {history.reduce(
                    (sum, batch) => sum + batch.results.length,
                    0,
                  )}{" "}
                  images)
                  <ChevronDown
                    className="transition-transform data-[state=open]:rotate-180"
                    data-icon="inline-end"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
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
                              previewScale={previewScale}
                              onDelete={() => deleteFromHistory(batch.id, idx)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </div>
      <footer className="mt-8 border-t border-gray-700 bg-gray-900/50">
        <div className="container mx-auto px-4 py-4 max-w-4xl flex justify-center gap-4">
          <a
            href="./licenses.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Open Source Licenses and Credits
          </a>
        </div>
      </footer>
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
