import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessingResult } from "../hooks/useProcessing.js";
import { formatRunDiagnosticsText } from "../utils/imageDiagnostics.js";

interface DebugLogPanelProps {
  results: ProcessingResult[];
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard API not available");
}

async function shareText(text: string): Promise<void> {
  if (!("share" in navigator)) {
    throw new Error("Web Share API not supported");
  }
  await navigator.share({
    title: "Game Boy Camera Extractor — Debug Log",
    text,
  });
}

export function DebugLogPanel({ results }: DebugLogPanelProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shareSupported, setShareSupported] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setShareSupported("share" in navigator);
  }, []);

  const debugText = useMemo(() => {
    const eligible = results
      .filter((r) => r.loadDiagnostics && r.outputDiagnostics)
      .map((r) => ({
        filename: r.filename,
        load: r.loadDiagnostics!,
        output: r.outputDiagnostics!,
        processingTimeMs: r.processingTime,
      }));
    if (eligible.length === 0) return "";
    return formatRunDiagnosticsText(eligible);
  }, [results]);

  const eligibleCount = useMemo(
    () =>
      results.filter((r) => r.loadDiagnostics && r.outputDiagnostics).length,
    [results],
  );

  if (eligibleCount === 0) return null;

  const flash = (msg: string, ms = 2000) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(null), ms);
  };

  const handleCopy = async () => {
    try {
      await copyText(debugText);
      flash("Copied!");
    } catch (err) {
      flash(`Copy failed — select text below and copy manually`);
      // Auto-select the text so the user can long-press copy on mobile
      const node = textRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      console.error("Copy debug log failed:", err);
    }
  };

  const handleShare = async () => {
    try {
      await shareText(debugText);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        flash(`Share failed: ${(err as Error).message}`);
        console.error("Share debug log failed:", err);
      }
    }
  };

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="bg-gray-800/60 border border-gray-700 rounded-lg overflow-hidden"
    >
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700/50 select-none">
        🐛 Debug Log ({eligibleCount} {eligibleCount === 1 ? "image" : "images"})
      </summary>
      <div className="p-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium transition-colors"
          >
            Copy
          </button>
          {shareSupported && (
            <button
              onClick={handleShare}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
            >
              Share
            </button>
          )}
          {feedback && (
            <span className="text-xs text-gray-300">{feedback}</span>
          )}
        </div>
        <pre
          ref={textRef}
          className="text-[11px] leading-snug text-gray-300 bg-gray-900/80 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all select-all"
        >
          {debugText}
        </pre>
      </div>
    </details>
  );
}
