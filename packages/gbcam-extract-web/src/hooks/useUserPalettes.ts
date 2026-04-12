import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "gbcam-user-palettes";
const STORAGE_VERSION = "1";
const STORAGE_VERSION_KEY = "gbcam-user-palettes-version";

export interface UserPaletteEntry {
  id: string;
  name: string;
  colors: [string, string, string, string];
  isEditing?: boolean;
  savedColors?: [string, string, string, string];
  savedName?: string;
}

function generateId(): string {
  return `palette-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadFromStorage(): UserPaletteEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const version = localStorage.getItem(STORAGE_VERSION_KEY);

    if (!stored || version !== STORAGE_VERSION) {
      return [];
    }

    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function saveToStorage(palettes: UserPaletteEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));
  localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
}

export function useUserPalettes() {
  const [palettes, setPalettes] = useState<UserPaletteEntry[]>(loadFromStorage);

  useEffect(() => {
    saveToStorage(palettes);
  }, [palettes]);

  // Create a new palette in edit mode with auto-generated unique name
  const createPaletteInEditMode = useCallback(
    (fromName: string, fromColors: [string, string, string, string]) => {
      // Check if fromName already ends with " custom #" pattern
      const customPatternMatch = fromName.match(/ custom (\d+)$/);
      let baseName: string;
      let nextNumber: number;

      if (customPatternMatch) {
        // Extract base name and use the next number after the current one
        baseName = fromName.substring(
          0,
          fromName.length - customPatternMatch[0].length,
        );
        const currentNumber = parseInt(customPatternMatch[1], 10);
        nextNumber = currentNumber + 1;
      } else {
        // Use fromName as base, start numbering at 1
        baseName = fromName;
        // Find the highest number for "<baseName> custom #" pattern
        const pattern = `${baseName} custom`;
        const existingNumbers = palettes
          .map((p) => {
            if (p.name.startsWith(pattern)) {
              const match = p.name.match(new RegExp(`^${pattern} (\\d+)$`));
              return match ? parseInt(match[1], 10) : 0;
            }
            return 0;
          })
          .filter((n) => n > 0);
        nextNumber =
          existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
      }

      const newPalette: UserPaletteEntry = {
        id: generateId(),
        name: `${baseName} custom ${nextNumber}`,
        colors: [...fromColors],
        isEditing: true,
      };

      setPalettes((prev) => [...prev, newPalette]);
      return newPalette.id;
    },
    [palettes],
  );

  // Update a palette's properties
  const updatePalette = useCallback(
    (id: string, changes: Partial<UserPaletteEntry>) => {
      setPalettes((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...changes } : p)),
      );
    },
    [],
  );

  // Save a palette and exit edit mode
  const savePalette = useCallback((id: string) => {
    setPalettes((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              isEditing: false,
              savedColors: undefined,
              savedName: undefined,
            }
          : p,
      ),
    );
  }, []);

  // Cancel editing and restore previous values (only for previously saved palettes)
  const cancelPaletteEdit = useCallback((id: string) => {
    setPalettes((prev) =>
      prev.map((p) => {
        if (p.id === id && p.savedName && p.savedColors) {
          return {
            ...p,
            name: p.savedName,
            colors: p.savedColors,
            isEditing: false,
            savedName: undefined,
            savedColors: undefined,
          };
        }
        return p;
      }),
    );
  }, []);

  // Delete a palette permanently
  const deletePalette = useCallback((id: string) => {
    setPalettes((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Start editing a palette (used when clicking edit button)
  const startEditingPalette = useCallback((id: string) => {
    setPalettes((prev) =>
      prev.map((p) => {
        if (p.id === id) {
          return {
            ...p,
            isEditing: true,
            savedName: p.name,
            savedColors: [...p.colors],
          };
        }
        return p;
      }),
    );
  }, []);

  return {
    palettes,
    createPaletteInEditMode,
    updatePalette,
    savePalette,
    cancelPaletteEdit,
    deletePalette,
    startEditingPalette,
  };
}
