/**
 * Sanitize palette name for use in filenames
 * - Replace spaces with underscores
 * - Remove or replace special characters
 * - Keep alphanumerics, underscores, and hyphens
 */
export function sanitizePaletteName(name: string): string {
  return (
    name
      // Replace spaces with underscores
      .replace(/\s+/g, "_")
      // Remove other special characters, keep alphanumerics, underscores, hyphens
      .replace(/[^a-zA-Z0-9_-]/g, "")
      // Collapse consecutive underscores
      .replace(/_+/g, "_")
      // Trim underscores from edges
      .replace(/^_+|_+$/g, "")
  );
}
