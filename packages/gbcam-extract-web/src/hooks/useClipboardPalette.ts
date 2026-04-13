import { useState, useEffect } from "react";
import { isPaletteInClipboard } from "../utils/paletteClipboard.js";

/**
 * Hook to track whether clipboard contains a valid palette.
 * Updates whenever the component mounts or the user might change the clipboard.
 */
export function useClipboardPaletteCheck(enabled: boolean = false) {
  const [hasClipboardPalette, setHasClipboardPalette] = useState(false);

  // Check clipboard on mount and when enabled changes
  useEffect(() => {
    if (!enabled) {
      setHasClipboardPalette(false);
      return;
    }

    const checkClipboard = async () => {
      const hasPalette = await isPaletteInClipboard();
      setHasClipboardPalette(hasPalette);
    };

    checkClipboard();

    // Check clipboard every 500ms to detect changes from other windows/tabs
    const interval = setInterval(checkClipboard, 500);

    return () => clearInterval(interval);
  }, [enabled]);

  return { hasClipboardPalette };
}
