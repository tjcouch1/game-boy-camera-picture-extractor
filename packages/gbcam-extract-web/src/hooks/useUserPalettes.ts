import { useState, useCallback, useEffect } from "react";
import type { PaletteEntry } from "../data/palettes.js";

const STORAGE_KEY = "gbcam-user-palettes";

function loadFromStorage(): PaletteEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToStorage(palettes: PaletteEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));
}

export function useUserPalettes() {
  const [palettes, setPalettes] = useState<PaletteEntry[]>(loadFromStorage);

  useEffect(() => {
    saveToStorage(palettes);
  }, [palettes]);

  const addPalette = useCallback((entry: PaletteEntry) => {
    setPalettes((prev) => [...prev, entry]);
  }, []);

  const removePalette = useCallback((index: number) => {
    setPalettes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return { palettes, addPalette, removePalette };
}
