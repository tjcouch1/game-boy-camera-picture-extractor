import { useState, useCallback, useEffect } from "react";
import type { PipelineResult } from "gbcam-extract";
import {
  serializePipelineResult,
  deserializePipelineResult,
  isSerializedPipelineResult,
} from "../utils/serialization.js";

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
      // Return the raw parsed data - deserialization happens async in useEffect
      return parsed;
    }
  } catch (e) {
    console.error("Error parsing history from storage:", e);
  }
  return [];
}

async function deserializeHistoryBatches(
  batches: ImageHistoryBatch[],
): Promise<ImageHistoryBatch[]> {
  return Promise.all(
    batches.map(async (batch) => ({
      ...batch,
      results: await Promise.all(
        batch.results.map(async (item: any) => ({
          ...item,
          result: isSerializedPipelineResult(item.result)
            ? await deserializePipelineResult(item.result)
            : item.result,
        })),
      ),
    })),
  );
}

function loadSettingsFromStorage(): HistorySettings {
  try {
    const stored = localStorage.getItem(HISTORY_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Error parsing history settings from storage:", e);
  }
  return { maxSize: DEFAULT_MAX_SIZE };
}

function saveHistoryToStorage(history: ImageHistoryBatch[]) {
  // Serialize before storing to use compact base64 representation
  const serialized = history.map((batch) => ({
    ...batch,
    results: batch.results.map((item) => ({
      ...item,
      result: serializePipelineResult(item.result),
    })),
  }));
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(serialized));
}

function saveSettingsToStorage(settings: HistorySettings) {
  localStorage.setItem(HISTORY_SETTINGS_KEY, JSON.stringify(settings));
}

export function useImageHistory() {
  const [history, setHistory] = useState<ImageHistoryBatch[]>([]);
  const [settings, setSettings] = useState<HistorySettings>(
    loadSettingsFromStorage,
  );
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  // Load history from storage on mount
  useEffect(() => {
    let isMounted = true;
    const rawBatches = loadHistoryFromStorage();
    deserializeHistoryBatches(rawBatches)
      .then((deserialized) => {
        if (isMounted) {
          setHistory(deserialized);
          setIsHistoryLoaded(true);
          // Save the loaded history back to storage to ensure consistency
          saveHistoryToStorage(deserialized);
        }
      })
      .catch(() => {
        // If loading fails, mark as loaded and clear storage
        if (isMounted) {
          setHistory([]);
          setIsHistoryLoaded(true);
          localStorage.removeItem(HISTORY_STORAGE_KEY);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Save history whenever it changes (only after initial load)
  useEffect(() => {
    if (isHistoryLoaded) {
      saveHistoryToStorage(history);
    }
  }, [history, isHistoryLoaded]);

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
