import { useState, useEffect } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer.js";

const INSTRUCTIONS_STORAGE_KEY = "gbcam-instructions-open";

/**
 * Collapsible instructions panel that persists open/closed state to localStorage
 */
export function CollapsibleInstructions({ markdown }: { markdown: string }) {
  const [isOpen, setIsOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(INSTRUCTIONS_STORAGE_KEY);
      return stored !== "false"; // Default to open
    } catch {
      return true;
    }
  });

  // Persist to localStorage when state changes
  useEffect(() => {
    try {
      localStorage.setItem(INSTRUCTIONS_STORAGE_KEY, String(isOpen));
    } catch {
      // localStorage might not be available (incognito mode, etc)
    }
  }, [isOpen]);

  return (
    <div className="mb-6 border border-gray-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-left font-semibold text-gray-100 flex items-center justify-between transition-colors"
      >
        <span>Instructions</span>
        <span
          className="text-lg transform transition-transform"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="p-4 bg-gray-900 text-gray-300 max-h-96 overflow-y-auto">
          <MarkdownRenderer markdown={markdown} />
        </div>
      )}
    </div>
  );
}
