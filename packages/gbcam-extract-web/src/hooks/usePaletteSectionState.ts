import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "gbcam-palette-sections-expanded";

export function usePaletteSectionState() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
    return new Set();
  });

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(expandedSections)),
    );
  }, [expandedSections]);

  const isExpanded = useCallback(
    (sectionTitle: string): boolean => {
      return expandedSections.has(sectionTitle);
    },
    [expandedSections],
  );

  const toggleExpanded = useCallback((sectionTitle: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionTitle)) {
        next.delete(sectionTitle);
      } else {
        next.add(sectionTitle);
      }
      return next;
    });
  }, []);

  return { isExpanded, toggleExpanded };
}
