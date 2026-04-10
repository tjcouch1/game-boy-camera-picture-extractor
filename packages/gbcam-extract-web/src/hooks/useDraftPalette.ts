import { useState, useCallback, useEffect } from "react";

const DRAFT_STORAGE_KEY = "gbcam_draft_palette";

export interface DraftPaletteState {
  colors: [string, string, string, string] | null;
  lastNonDraftPalette: [string, string, string, string] | null;
}

function loadDraftFromStorage(): DraftPaletteState {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load draft palette", e);
  }
  return { colors: null, lastNonDraftPalette: null };
}

function saveDraftToStorage(state: DraftPaletteState) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save draft palette", e);
  }
}

export function useDraftPalette() {
  const [draftState, setDraftState] =
    useState<DraftPaletteState>(loadDraftFromStorage);

  // Auto-save to localStorage whenever state changes
  useEffect(() => {
    saveDraftToStorage(draftState);
  }, [draftState]);

  const initializeDraft = useCallback(
    (fromPalette: [string, string, string, string]) => {
      setDraftState({
        colors: fromPalette,
        lastNonDraftPalette: fromPalette,
      });
    },
    [],
  );

  const updateDraftColors = useCallback(
    (colors: [string, string, string, string]) => {
      setDraftState((prev) => ({
        colors,
        lastNonDraftPalette: prev.lastNonDraftPalette,
      }));
    },
    [],
  );

  const recordNonDraftPalette = useCallback(
    (palette: [string, string, string, string]) => {
      setDraftState((prev) => ({
        colors: prev.colors,
        lastNonDraftPalette: palette,
      }));
    },
    [],
  );

  const clearDraft = useCallback(() => {
    setDraftState((prev) => ({
      colors: null,
      lastNonDraftPalette: prev.lastNonDraftPalette,
    }));
  }, []);

  const hasDraft = draftState.colors !== null;

  return {
    draft: draftState.colors,
    hasDraft,
    lastNonDraftPalette: draftState.lastNonDraftPalette,
    initializeDraft,
    updateDraftColors,
    recordNonDraftPalette,
    clearDraft,
  };
}
