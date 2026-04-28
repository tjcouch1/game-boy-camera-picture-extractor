import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage.js";

const STORAGE_KEY = "gbcam-palette-sections-expanded";

export function usePaletteSectionState() {
  const [expanded, setExpanded] = useLocalStorage<string[]>(STORAGE_KEY, []);

  const isExpanded = useCallback(
    (sectionTitle: string): boolean => expanded.includes(sectionTitle),
    [expanded],
  );

  const toggleExpanded = useCallback(
    (sectionTitle: string) => {
      setExpanded((prev) =>
        prev.includes(sectionTitle)
          ? prev.filter((s) => s !== sectionTitle)
          : [...prev, sectionTitle],
      );
    },
    [setExpanded],
  );

  return { isExpanded, toggleExpanded };
}
