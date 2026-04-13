import { useState, useCallback, useEffect } from "react";
import type { PipelineResult } from "gbcam-extract";
import { reconstructPipelineResult } from "../utils/deserializeResults.js";

export interface ProcessingResult {
  result: PipelineResult;
  filename: string;
  processingTime: number;
}

export interface ImageHistoryBatch {
  id: string;
  timestamp: number;
  results: ProcessingResult[];
}

export interface HistorySettings {
  maxSize: number;
}

const HISTORY_STORAGE_KEY = "gbcam-image-history";
const HISTORY_SETTINGS_KEY = "gbcam-history-settings";
const DEFAULT_MAX_SIZE = 10;
const MAX_BATCH_SIZE = 10; // Don't store more than 10 images per batch

function generateId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadHistoryFromStorage(): ImageHistoryBatch[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Reconstruct PipelineResult objects with proper Uint8ClampedArray data
      return parsed.map((batch: any) => ({
        ...batch,
        results: batch.results.map((item: any) => ({
          ...item,
          result: reconstructPipelineResult(item.result) || item.result,
        })),
      }));
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

function loadSettingsFromStorage(): HistorySettings {
  try {
    const stored = localStorage.getItem(HISTORY_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { maxSize: DEFAULT_MAX_SIZE };
}

function saveHistoryToStorage(history: ImageHistoryBatch[]) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function saveSettingsToStorage(settings: HistorySettings) {
  localStorage.setItem(HISTORY_SETTINGS_KEY, JSON.stringify(settings));
}

export function useImageHistory() {
  const [history, setHistory] = useState<ImageHistoryBatch[]>(
    loadHistoryFromStorage,
  );
  const [settings, setSettings] = useState<HistorySettings>(
    loadSettingsFromStorage,
  );
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  // Save history whenever it changes
  useEffect(() => {
    saveHistoryToStorage(history);
  }, [history]);

  // Save settings whenever they change
  useEffect(() => {
    saveSettingsToStorage(settings);
  }, [settings]);

  // Add current results to history (moves them from current to history)
  const archiveResults = useCallback(
    (results: ProcessingResult[]) => {
      if (results.length === 0) return;

      const newBatch: ImageHistoryBatch = {
        id: generateId(),
        timestamp: Date.now(),
        results: results.slice(0, MAX_BATCH_SIZE), // Limit batch size
      };

      setHistory((prev) => {
        let updated = [newBatch, ...prev];

        // Calculate total number of images
        let totalImages = updated.reduce(
          (sum, batch) => sum + batch.results.length,
          0,
        );

        // Remove oldest batches if total exceeds max size
        while (totalImages > settings.maxSize && updated.length > 0) {
          const lastBatch = updated[updated.length - 1];
          totalImages -= lastBatch.results.length;
          updated = updated.slice(0, -1);
        }

        return updated;
      });
    },
    [settings],
  );

  // Delete a specific result from history
  const deleteFromHistory = useCallback(
    (batchId: string, resultIndex: number) => {
      setHistory(
        (prev) =>
          prev
            .map((batch) => {
              if (batch.id === batchId) {
                return {
                  ...batch,
                  results: batch.results.filter((_, i) => i !== resultIndex),
                };
              }
              return batch;
            })
            .filter((batch) => batch.results.length > 0), // Remove empty batches
      );
    },
    [],
  );

  // Delete all results from a specific batch
  const deleteBatch = useCallback((batchId: string) => {
    setHistory((prev) => prev.filter((batch) => batch.id !== batchId));
  }, []);

  // Delete all history
  const deleteAllHistory = useCallback(() => {
    setHistory([]);
  }, []);

  // Update history settings
  const updateSettings = useCallback(
    (newSettings: Partial<HistorySettings>) => {
      setSettings((prev) => ({ ...prev, ...newSettings }));
    },
    [],
  );

  // Prune history based on current max size
  const pruneHistory = useCallback(() => {
    setHistory((prev) => {
      let updated = [...prev];
      let totalImages = updated.reduce(
        (sum, batch) => sum + batch.results.length,
        0,
      );

      while (totalImages > settings.maxSize && updated.length > 0) {
        const lastBatch = updated[updated.length - 1];
        totalImages -= lastBatch.results.length;
        updated = updated.slice(0, -1);
      }

      return updated;
    });
  }, [settings]);

  return {
    history,
    settings,
    isHistoryExpanded,
    setIsHistoryExpanded,
    archiveResults,
    deleteFromHistory,
    deleteBatch,
    deleteAllHistory,
    updateSettings,
    pruneHistory,
  };
}
