import { useState, useEffect } from "react";
import { isPaletteInClipboard } from "../utils/paletteClipboard.js";

/**
 * Hook to track whether clipboard contains a valid palette.
 * On mobile, checks are less frequent to avoid permission issues.
 * Updates on mount, when enabled changes, and when user focuses the window.
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
      try {
        const hasPalette = await isPaletteInClipboard();
        setHasClipboardPalette(hasPalette);
      } catch (err) {
        // Silent fail - just keep current state if permission denied
        console.debug("Clipboard check failed:", err);
      }
    };

    // Check immediately on enable
    checkClipboard();

    // Detect if we're on mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // On mobile, only check when window regains focus (less aggressive)
    // On desktop, check periodically to catch clipboard changes
    const checkInterval = isMobile ? 2000 : 500; // 2s on mobile, 500ms on desktop
    const interval = setInterval(checkClipboard, checkInterval);

    // Also check when window regains focus (important for mobile)
    const handleFocus = () => {
      checkClipboard();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled]);

  return { hasClipboardPalette };
}
