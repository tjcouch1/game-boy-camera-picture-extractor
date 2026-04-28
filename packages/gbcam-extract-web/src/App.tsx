import { useState, useCallback, useEffect } from "react";
import type { PipelineResult } from "gbcam-extract";
import { useOpenCV } from "./hooks/useOpenCV.js";
import { useImageHistory } from "./hooks/useImageHistory.js";
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
import {
  ChevronDown,
  Library,
  Smartphone,
  X,
  AlertTriangle,
  ImageIcon,
  Download as DownloadIcon,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shadcn/components/collapsible";
import { Button } from "@/shadcn/components/button";
import { Card, CardContent } from "@/shadcn/components/card";
import { Separator } from "@/shadcn/components/separator";
import { Checkbox } from "@/shadcn/components/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/shadcn/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/components/select";
import { Input } from "@/shadcn/components/input";
import { Toaster } from "@/shadcn/components/sonner";
import { Alert, AlertDescription, AlertTitle } from "@/shadcn/components/alert";
import { Progress } from "@/shadcn/components/progress";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shadcn/components/empty";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shadcn/components/dialog";
import { useServiceWorker } from "./hooks/useServiceWorker.js";

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
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          Image {progress.currentImageProgress.index + 1} of{" "}
          {progress.totalImages}: {progress.currentImageProgress.filename}
        </span>
        <span>{progress.overallProgress}%</span>
      </div>
      <Progress value={progress.overallProgress} />
      <div className="text-xs text-muted-foreground">
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
  const { updateAvailable, reload } = useServiceWorker();
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
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Toaster richColors position="bottom-center" />
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
              <Button
                onClick={handleInstallApp}
                title="Install this app on your device"
              >
                <DownloadIcon data-icon="inline-start" />
                Install App
              </Button>
            )}
          </div>
        </div>

        {/* iOS install tip — Safari doesn't fire beforeinstallprompt */}
        {showIOSInstallTip && (
          <Alert className="mb-4">
            <Smartphone />
            <AlertTitle>Install as App</AlertTitle>
            <AlertDescription>
              Tap the <strong>Share</strong> button (
              <span className="font-mono">⎙</span>) in Safari, then choose{" "}
              <strong>"Add to Home Screen"</strong>.
            </AlertDescription>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowIOSInstallTip(false)}
              aria-label="Dismiss"
              className="ms-auto"
            >
              <X />
            </Button>
          </Alert>
        )}

        {updateAvailable && (
          <Alert className="mb-4">
            <AlertTitle>App updated</AlertTitle>
            <AlertDescription>
              Refresh to get the latest version.
            </AlertDescription>
            <Button
              variant="secondary"
              size="sm"
              onClick={reload}
              className="ms-auto"
            >
              Refresh
            </Button>
          </Alert>
        )}

        {/* Collapsible Instructions */}
        <CollapsibleInstructions markdown={USER_INSTRUCTIONS_MARKDOWN} />

        {status === "loading" && (
          <div className="mb-6 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              Loading OpenCV.js...
            </p>
            <Progress value={cvProgress} />
          </div>
        )}

        {status === "error" && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle />
            <AlertTitle>Failed to load OpenCV</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {status === "ready" && (
          <>
            <FieldGroup className="mb-6 flex-row flex-wrap items-center gap-4">
              <Field orientation="horizontal" className="w-auto gap-2">
                <Checkbox
                  id="debug-mode"
                  checked={debug}
                  onCheckedChange={(v) => setDebug(v === true)}
                />
                <FieldLabel htmlFor="debug-mode">Debug mode</FieldLabel>
              </Field>
              <Field orientation="horizontal" className="w-auto gap-2">
                <Checkbox
                  id="clipboard-enabled"
                  checked={clipboardEnabled}
                  onCheckedChange={(v) => setClipboardEnabled(v === true)}
                />
                <FieldLabel htmlFor="clipboard-enabled">
                  Enable Copy/Paste Palettes
                </FieldLabel>
              </Field>
            </FieldGroup>

            <ImageInput
              onImagesSelected={handleImagesSelected}
              disabled={processing}
            />

            {processing && <ProgressDisplay progress={progress} />}

            {!processing && results.length === 0 && history.length === 0 && (
              <Empty className="my-6">
                <EmptyHeader>
                  <ImageIcon className="size-10 text-muted-foreground" />
                  <EmptyTitle>No images yet</EmptyTitle>
                  <EmptyDescription>
                    Drop a phone photo of a Game Boy Camera image to get
                    started.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}

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
                    <Button
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
                    >
                      Download All ({results.length})
                    </Button>
                  )}
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <FieldLabel htmlFor="output-scale">
                      Output Scale:
                    </FieldLabel>
                    <Select
                      value={String(outputScale)}
                      onValueChange={(v) => {
                        if (typeof v === "string")
                          setOutputScale(parseInt(v, 10));
                      }}
                    >
                      <SelectTrigger id="output-scale" className="w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="1">1x (128x112)</SelectItem>
                          <SelectItem value="2">2x (256x224)</SelectItem>
                          <SelectItem value="3">3x (384x336)</SelectItem>
                          <SelectItem value="4">4x (512x448)</SelectItem>
                          <SelectItem value="8">8x (1024x896)</SelectItem>
                          <SelectItem value="16">16x (2048x1792)</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <FieldLabel htmlFor="preview-scale">
                      Preview Scale:
                    </FieldLabel>
                    <Select
                      value={String(previewScale)}
                      onValueChange={(v) => {
                        if (typeof v === "string")
                          setPreviewScale(parseInt(v, 10));
                      }}
                    >
                      <SelectTrigger id="preview-scale" className="w-fit">
                        <span className="flex flex-1 text-start">
                          {previewScale}x
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="1">1x (128x112)</SelectItem>
                          <SelectItem value="2">2x (256x224)</SelectItem>
                          <SelectItem value="3">3x (384x336)</SelectItem>
                          <SelectItem value="4">4x (512x448)</SelectItem>
                          <SelectItem value="8">8x (1024x896)</SelectItem>
                          <SelectItem value="16">16x (2048x1792)</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
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
                      <Field orientation="horizontal" className="w-auto gap-2">
                        <Input
                          id="history-max-size"
                          type="number"
                          min={1}
                          max={100}
                          value={historySettings.maxSize}
                          onChange={(e) =>
                            updateHistorySettings({
                              maxSize: Math.max(
                                1,
                                parseInt(e.target.value, 10) || 1,
                              ),
                            })
                          }
                          className="w-16"
                        />
                        <FieldLabel htmlFor="history-max-size">
                          max images to keep in history
                        </FieldLabel>
                      </Field>
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button
                              variant="destructive"
                              size="sm"
                              className="ms-auto"
                            />
                          }
                        >
                          Delete All History
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete all history?</DialogTitle>
                            <DialogDescription>
                              This will permanently remove all archived image
                              batches. This action cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose
                              render={<Button variant="secondary" />}
                            >
                              Cancel
                            </DialogClose>
                            <DialogClose
                              render={
                                <Button
                                  variant="destructive"
                                  onClick={deleteAllHistory}
                                />
                              }
                            >
                              Delete All
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {history.map((batch) => (
                      <Card key={batch.id} className="bg-muted/40 p-4">
                        <CardContent className="p-0">
                          <div className="text-xs text-muted-foreground mb-3">
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
                                onDelete={() =>
                                  deleteFromHistory(batch.id, idx)
                                }
                              />
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </div>
      <Separator className="mt-8" />
      <footer className="bg-background/50">
        <div className="container mx-auto px-4 py-4 max-w-4xl flex justify-center gap-4">
          <a
            href="./licenses.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
